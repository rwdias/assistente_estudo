// Edge Function: reescreve uma pergunta "dominada" para forçar recall ativo.
// Entrada:  { modelo, pergunta: { enunciado, dificuldade, opcoes, topico? },
//             quantidade? }
// Saída:    quantidade > 1 -> { variantes: [{ enunciado, opcoes }] }
//           caso contrário -> { enunciado, dificuldade, opcoes, topico }
//
// O modo "variantes" existe pela quota: 1 chamada devolve várias versões, que
// o app grava em pergunta_variantes e passa a girar sem custo.

import {
  chamarProvedor,
  consumirQuota,
  corsHeaders,
  DIFICULDADES,
  ErroProvedorIA,
  PERGUNTA_SCHEMA,
  type PerguntaIA,
  promptReformulacao,
  promptVariantes,
  respostaJson,
  usuarioAutenticado,
  VARIANTES_SCHEMA,
} from "../_shared/comum.ts";

const MAX_ENUNCIADO = 4_000;
const MAX_OPCAO = 1_000;
const MAX_OPCOES = 8;
const MAX_VARIANTES = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return respostaJson(req, { erro: "Método não suportado." }, 405);
  }

  if (!(await usuarioAutenticado(req))) {
    return respostaJson(req, { erro: "Não autenticado." }, 401);
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return respostaJson(req, { erro: "Corpo inválido." }, 400);
  }

  const modelo = String(corpo.modelo ?? "");
  const perguntaBruta = corpo.pergunta as PerguntaIA | undefined;
  // quantidade > 1 = modo variantes (grava várias versões de uma vez)
  const quantidade = Math.min(
    Math.max(Math.trunc(Number(corpo.quantidade ?? 1)) || 1, 1),
    MAX_VARIANTES,
  );

  if (
    !perguntaBruta ||
    typeof perguntaBruta.enunciado !== "string" ||
    !Array.isArray(perguntaBruta.opcoes)
  ) {
    return respostaJson(req, { erro: "Pergunta inválida." }, 400);
  }

  if (
    perguntaBruta.enunciado.length > MAX_ENUNCIADO ||
    perguntaBruta.opcoes.length < 2 ||
    perguntaBruta.opcoes.length > MAX_OPCOES ||
    perguntaBruta.opcoes.some(
      (o) => typeof o.texto !== "string" || o.texto.length > MAX_OPCAO,
    )
  ) {
    return respostaJson(req, { erro: "Pergunta fora dos limites aceitos." }, 400);
  }

  const pergunta: PerguntaIA = {
    enunciado: perguntaBruta.enunciado,
    dificuldade: DIFICULDADES.includes(perguntaBruta.dificuldade)
      ? perguntaBruta.dificuldade
      : "Média",
    opcoes: perguntaBruta.opcoes.map((o) => ({
      texto: o.texto,
      correta: Boolean(o.correta),
    })),
    topico: perguntaBruta.topico ?? null,
  };

  if (!(await consumirQuota(req))) {
    return respostaJson(
      req,
      { erro: "Limite diário de chamadas de IA atingido. Tente novamente amanhã." },
      429,
    );
  }

  try {
    if (quantidade > 1) {
      const dados = (await chamarProvedor(
        modelo,
        null,
        promptVariantes(pergunta, quantidade),
        VARIANTES_SCHEMA,
        "variantes_pergunta",
      )) as { variantes: { enunciado: string; opcoes: PerguntaIA["opcoes"] }[] };

      // Guarda-corpo: a variante só serve se preservar a estrutura da questão
      // (mesmo nº de alternativas e mesmo nº de corretas). Variante fora disso
      // ensinaria coisa errada — melhor descartar do que gravar.
      const nCorretas = pergunta.opcoes.filter((o) => o.correta).length;
      const validas = (dados.variantes ?? []).filter((v) =>
        typeof v.enunciado === "string" &&
        v.enunciado.trim().length > 0 &&
        Array.isArray(v.opcoes) &&
        v.opcoes.length === pergunta.opcoes.length &&
        v.opcoes.every((o) => typeof o.texto === "string" && o.texto.trim()) &&
        v.opcoes.filter((o) => o.correta === true).length === nCorretas
      );

      if (validas.length === 0) {
        return respostaJson(
          req,
          { erro: "A IA não gerou variantes válidas. Tente outro modelo." },
          502,
        );
      }

      return respostaJson(req, { variantes: validas.slice(0, quantidade) });
    }

    const dados = await chamarProvedor(
      modelo,
      null,
      promptReformulacao(pergunta),
      PERGUNTA_SCHEMA,
      "pergunta_reformulada",
    );

    return respostaJson(req, dados);
  } catch (erro) {
    if (erro instanceof ErroProvedorIA) {
      return respostaJson(req, { erro: erro.message }, 502);
    }
    console.error("erro inesperado na reformulação:", (erro as Error).message);
    return respostaJson(req, { erro: "Erro interno." }, 500);
  }
});
