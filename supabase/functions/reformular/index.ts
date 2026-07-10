// Edge Function: reescreve uma pergunta "dominada" para forçar recall ativo.
// Entrada:  { modelo, pergunta: { enunciado, dificuldade, opcoes, topico? } }
// Saída:    { enunciado, dificuldade, opcoes, topico }

import {
  chamarProvedor,
  consumirQuota,
  corsHeaders,
  DIFICULDADES,
  ErroProvedorIA,
  PERGUNTA_SCHEMA,
  type PerguntaIA,
  promptReformulacao,
  respostaJson,
  usuarioAutenticado,
} from "../_shared/comum.ts";

const MAX_ENUNCIADO = 4_000;
const MAX_OPCAO = 1_000;
const MAX_OPCOES = 8;

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
