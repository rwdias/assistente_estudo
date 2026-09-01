// Edge Function: extrai perguntas de múltipla escolha de um texto colado.
// Entrada:  { modelo, texto, assunto, dificuldade_padrao? }
// Saída:    { perguntas: [{ enunciado, dificuldade, opcoes, topico }] }

import {
  chamarProvedor,
  consumirQuota,
  corsHeaders,
  DIFICULDADES,
  ErroProvedorIA,
  EXERCICIOS_MATH_SCHEMA,
  EXTRACAO_SCHEMA,
  FLASHCARDS_SCHEMA,
  promptExtracao,
  promptFlashcards,
  promptFlashcardsMath,
  respostaJson,
  usuarioAutenticado,
} from "../_shared/comum.ts";

const MAX_TEXTO = 20_000;
const MAX_CONTEXTO = 10_000;
const MAX_ASSUNTO = 150;
// Teto de itens por extração. Alto para caber slides densos (dezenas de
// conceitos) sem cortar a cobertura; o custo real só aparece se a IA gerar tudo.
const MAX_PERGUNTAS = 100;

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
  const texto = String(corpo.texto ?? "");
  const assunto = String(corpo.assunto ?? "");
  const dificuldadePadrao = String(corpo.dificuldade_padrao ?? "Média");
  const tipo = String(corpo.tipo ?? "pergunta");
  const contexto = String(corpo.contexto ?? "");
  // Matéria matemática: flashcards com fórmula em LaTeX + resolução passo a passo.
  const matematica = corpo.matematica === true;
  // Tópicos que já existem na matéria (subdivisões). O front envia para a IA
  // REUTILIZAR rótulos existentes em vez de inventar sinônimos/variações — é o
  // que conteem a fragmentação da taxonomia. Cap defensivo no tamanho.
  const topicosExistentes = Array.isArray(corpo.topicos_existentes)
    ? (corpo.topicos_existentes as unknown[])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 200)
    : [];

  // 'exercicio' = ingestão de lista (livro/lista com gabarito): exercícios com
  // resolução, resposta e `verificacao` (o que o código confere).
  if (!["pergunta", "flashcard", "exercicio"].includes(tipo)) {
    return respostaJson(req, { erro: "Tipo inválido." }, 400);
  }
  if (!texto.trim()) {
    return respostaJson(req, { erro: "Cole algum texto primeiro." }, 400);
  }
  if (texto.length > MAX_TEXTO) {
    return respostaJson(
      req,
      { erro: `Texto grande demais (máximo ${MAX_TEXTO} caracteres).` },
      400,
    );
  }
  if (contexto.length > MAX_CONTEXTO) {
    return respostaJson(
      req,
      { erro: `Contexto grande demais (máximo ${MAX_CONTEXTO} caracteres).` },
      400,
    );
  }
  if (!assunto.trim() || assunto.length > MAX_ASSUNTO) {
    return respostaJson(req, { erro: "Assunto inválido." }, 400);
  }
  if (!DIFICULDADES.includes(dificuldadePadrao)) {
    return respostaJson(req, { erro: "Dificuldade inválida." }, 400);
  }

  if (!(await consumirQuota(req))) {
    return respostaJson(
      req,
      { erro: "Limite diário de chamadas de IA atingido. Tente novamente amanhã." },
      429,
    );
  }

  try {
    if (tipo === "exercicio") {
      // Lista de exercícios: enunciado + resolução + resposta + verificacao.
      const system = promptFlashcardsMath(assunto, dificuldadePadrao, MAX_PERGUNTAS, contexto, topicosExistentes);
      const dados = (await chamarProvedor(
        modelo,
        system,
        texto,
        EXERCICIOS_MATH_SCHEMA,
        "extracao_exercicios",
      )) as { exercicios: unknown[] };

      return respostaJson(req, { exercicios: dados.exercicios.slice(0, MAX_PERGUNTAS) });
    }

    if (tipo === "flashcard") {
      // Flashcards de CONCEITO (anotações/slides/apostila) — sempre pelo
      // promptFlashcards, que cobre o material de forma exaustiva. Em matéria de
      // exatas, `matematica=true` liga as regras de LaTeX. (O promptFlashcardsMath,
      // orientado a EXERCÍCIOS numerados, fica só para a ingestão de LISTAS.)
      const system = promptFlashcards(
        assunto, dificuldadePadrao, MAX_PERGUNTAS, contexto, topicosExistentes, matematica,
      );
      const dados = (await chamarProvedor(
        modelo,
        system,
        texto,
        FLASHCARDS_SCHEMA,
        "extracao_flashcards",
      )) as { flashcards: unknown[] };

      return respostaJson(req, { flashcards: dados.flashcards.slice(0, MAX_PERGUNTAS) });
    }

    const system = promptExtracao(assunto, dificuldadePadrao, MAX_PERGUNTAS, topicosExistentes);
    const dados = (await chamarProvedor(
      modelo,
      system,
      texto,
      EXTRACAO_SCHEMA,
      "extracao_perguntas",
    )) as { perguntas: unknown[] };

    return respostaJson(req, { perguntas: dados.perguntas.slice(0, MAX_PERGUNTAS) });
  } catch (erro) {
    if (erro instanceof ErroProvedorIA) {
      return respostaJson(req, { erro: erro.message }, 502);
    }
    console.error("erro inesperado na extração:", (erro as Error).message);
    return respostaJson(req, { erro: "Erro interno." }, 500);
  }
});
