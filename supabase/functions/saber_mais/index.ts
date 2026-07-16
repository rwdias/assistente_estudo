// Edge Function: gera um complemento de aprofundamento ("Saber mais") para uma
// questão de múltipla escolha. Só a GERAÇÃO por IA mora aqui (quota + provedor);
// a persistência/cache (≤ 3 complementos) fica na função SQL
// `adicionar_saber_mais`, chamada pelo front-end — mesmo padrão de extrair.
// Entrada:  { modelo, pergunta: { enunciado, opcoes[] }, anteriores?: string[] }
// Saída:    { saber_mais: string }

import {
  chamarProvedor,
  consumirQuota,
  corsHeaders,
  ErroProvedorIA,
  type PerguntaIA,
  promptSaberMais,
  respostaJson,
  SABER_MAIS_SCHEMA,
  usuarioAutenticado,
} from "../_shared/comum.ts";

const MAX_ENUNCIADO = 4_000;
const MAX_OPCAO = 1_000;
const MAX_OPCOES = 8;
const MAX_ANTERIORES = 3;
const MAX_ANTERIOR = 6_000;

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
  const anterioresBrutas = Array.isArray(corpo.anteriores) ? corpo.anteriores : [];

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

  const anteriores = anterioresBrutas
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .slice(0, MAX_ANTERIORES)
    .map((t) => t.slice(0, MAX_ANTERIOR));

  if (anteriores.length >= MAX_ANTERIORES) {
    return respostaJson(
      req,
      { erro: "Limite de complementos atingido para esta questão." },
      400,
    );
  }

  const pergunta: PerguntaIA = {
    enunciado: perguntaBruta.enunciado,
    dificuldade: "Média",
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
    const dados = (await chamarProvedor(
      modelo,
      null,
      promptSaberMais(pergunta, anteriores),
      SABER_MAIS_SCHEMA,
      "saber_mais",
    )) as { saber_mais: string };

    const texto = (dados.saber_mais ?? "").trim();
    if (!texto) throw new ErroProvedorIA("A IA não retornou conteúdo.");

    return respostaJson(req, { saber_mais: texto });
  } catch (erro) {
    if (erro instanceof ErroProvedorIA) {
      return respostaJson(req, { erro: erro.message }, 502);
    }
    console.error("erro inesperado no saber mais:", (erro as Error).message);
    return respostaJson(req, { erro: "Erro interno." }, 500);
  }
});
