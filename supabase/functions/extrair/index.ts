import { recorteBacen, limiteBacen, contextoPadraoBacen } from "../_shared/bacen.ts";
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
  restComoUsuario,
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

  // Consulta de contexto: sem chamada ao modelo e sem consumo de quota.
  // A mesma fonte abastece a caixa editável e a geração pelo leitor.
  let materia: { nome: string; tipo: string; contexto_ia: string | null;
    trilhas: { nome: string } | null } | null = null;
  if (corpo.acao === "contexto_flashcards" || (corpo.tipo === "flashcard" && corpo.materia_id != null)) {
    const id = Number(corpo.materia_id);
    if (!Number.isSafeInteger(id) || id <= 0)
      return respostaJson(req, { erro: "Matéria inválida." }, 400);
    try {
      const resposta = await restComoUsuario(req,
        `materias?id=eq.${id}&select=nome,tipo,contexto_ia,trilhas(nome)`);
      if (!resposta.ok) throw new Error("Consulta indisponível");
      [materia] = await resposta.json();
    } catch {
      return respostaJson(req, { erro: "Não foi possível carregar o contexto da matéria." }, 502);
    }
    if (!materia) return respostaJson(req, { erro: "Matéria não encontrada." }, 404);
    if (corpo.acao === "contexto_flashcards") {
      const padrao = contextoPadraoBacen(materia.nome, materia.trilhas?.nome || "");
      return respostaJson(req, { contexto: materia.contexto_ia ?? padrao ?? "",
        padrao: materia.contexto_ia == null && padrao != null });
    }
  }

  const modelo = String(corpo.modelo ?? "");
  const texto = String(corpo.texto ?? "");
  let assunto = String(corpo.assunto ?? "");
  const dificuldadePadrao = String(corpo.dificuldade_padrao ?? "Média");
  const tipo = String(corpo.tipo ?? "pergunta");
  let contexto = String(corpo.contexto ?? "");
  // Matéria matemática: flashcards com fórmula em LaTeX + resolução passo a passo.
  let matematica = corpo.matematica === true;
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

  const recorte = materia ? recorteBacen(materia.nome, materia.trilhas?.nome || "") : null;
  const contextoPadrao = materia ? contextoPadraoBacen(materia.nome, materia.trilhas?.nome || "") : null;
  if (materia) {
    assunto = materia.nome;
    matematica = materia.tipo === "matematica";
    if (corpo.contexto == null) contexto = materia.contexto_ia ?? contextoPadrao ?? "";
    if (contexto.length > MAX_CONTEXTO)
      return respostaJson(req, { erro: "Contexto da matéria grande demais." }, 400);
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
      // BACEN usa seleção enxuta; as demais matérias preservam sua cobertura.
      // Só o padrão aplica o teto seletivo fixo. Edições do usuário podem
      // alterar a quantidade, dentro do teto técnico geral de 100.
      const limite = recorte && contexto.trim() === contextoPadrao?.trim()
        ? limiteBacen(corpo.paginas_selecionadas) : MAX_PERGUNTAS;
      const system = promptFlashcards(
        assunto, dificuldadePadrao, limite, contexto, topicosExistentes, matematica, recorte,
      );
      const dados = (await chamarProvedor(
        modelo,
        system,
        texto,
        FLASHCARDS_SCHEMA,
        "extracao_flashcards",
      )) as { flashcards: unknown[] };

      return respostaJson(req, { flashcards: dados.flashcards.slice(0, limite) });
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
