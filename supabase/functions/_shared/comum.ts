// Código compartilhado das Edge Functions do Study Rats.
//
// Segurança:
// - CORS com allowlist explícita (GitHub Pages + dev local), nunca "*".
// - Limites de tamanho de entrada antes de tocar nas APIs de IA.
// - Quota diária consumida via RPC `consumir_quota_ia` COM o JWT do
//   chamador (auth.uid() resolve para o usuário real).
// - Chaves de IA só via Deno.env (supabase secrets) e nunca ecoadas.

const ORIGENS_PERMITIDAS = [
  "https://rwdias.github.io",
  "http://localhost:8001",
  "http://127.0.0.1:8001",
  "http://localhost:4507",
];

export function corsHeaders(req: Request): Record<string, string> {
  const origem = req.headers.get("Origin") ?? "";
  // Origem fora da allowlist (ou ausente, ex.: curl) não recebe headers de
  // liberação — o preflight falha e o navegador bloqueia a chamada.
  if (!ORIGENS_PERMITIDAS.includes(origem)) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function respostaJson(req: Request, corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

// Com as API keys novas (sb_publishable_*), o gateway NÃO verifica o JWT —
// a autenticação precisa ser confirmada aqui dentro, antes de qualquer coisa.
export async function usuarioAutenticado(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  const resposta = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: auth },
  });

  return resposta.ok;
}

// Chamada PostgREST/RPC repassando o JWT do chamador — o RLS do dono se
// aplica exatamente como se o front tivesse chamado. Uso interno das Edge
// Functions que precisam ler/gravar dados do próprio usuário no servidor.
export function restComoUsuario(
  req: Request,
  caminho: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return fetch(`${url}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: anon,
      Authorization: req.headers.get("Authorization") ?? "",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
}

export async function consumirQuota(req: Request): Promise<boolean> {
  const limite = parseInt(Deno.env.get("IA_QUOTA_DIARIA") ?? "20", 10);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  const resposta = await fetch(`${url}/rest/v1/rpc/consumir_quota_ia`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: req.headers.get("Authorization") ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_limite: limite }),
  });

  if (!resposta.ok) return false;
  return (await resposta.json()) === true;
}

// ---------- schemas / prompts (porta fiel de src/llm/schemas.py) ----------

export const DIFICULDADES = ["Fácil", "Média", "Difícil"];

const OPCAO_SCHEMA = {
  type: "object",
  properties: {
    texto: { type: "string" },
    correta: { type: "boolean" },
  },
  required: ["texto", "correta"],
  additionalProperties: false,
};

export const PERGUNTA_SCHEMA = {
  type: "object",
  properties: {
    enunciado: { type: "string" },
    dificuldade: { type: "string", enum: DIFICULDADES },
    opcoes: { type: "array", items: OPCAO_SCHEMA },
    topico: { type: ["string", "null"] },
  },
  required: ["enunciado", "dificuldade", "opcoes", "topico"],
  additionalProperties: false,
};

// Igual ao PERGUNTA_SCHEMA, mais o "saber_mais": a explicação/justificativa
// que já vem no texto colado (por que a correta é certa e as outras não).
// Fica separado para não afetar o schema da reformulação.
const PERGUNTA_EXTRACAO_SCHEMA = {
  type: "object",
  properties: {
    enunciado: { type: "string" },
    dificuldade: { type: "string", enum: DIFICULDADES },
    opcoes: { type: "array", items: OPCAO_SCHEMA },
    topico: { type: ["string", "null"] },
    saber_mais: { type: ["string", "null"] },
  },
  required: ["enunciado", "dificuldade", "opcoes", "topico", "saber_mais"],
  additionalProperties: false,
};

export const EXTRACAO_SCHEMA = {
  type: "object",
  properties: {
    perguntas: { type: "array", items: PERGUNTA_EXTRACAO_SCHEMA },
  },
  required: ["perguntas"],
  additionalProperties: false,
};

// Variantes: várias reescritas do MESMO conceito numa única chamada. A quota
// é de poucas chamadas por dia, então 1 chamada precisa render várias versões
// — elas ficam gravadas em pergunta_variantes e giram de graça depois.
const VARIANTE_SCHEMA = {
  type: "object",
  properties: {
    enunciado: { type: "string" },
    opcoes: { type: "array", items: OPCAO_SCHEMA },
  },
  required: ["enunciado", "opcoes"],
  additionalProperties: false,
};

export const VARIANTES_SCHEMA = {
  type: "object",
  properties: {
    variantes: { type: "array", items: VARIANTE_SCHEMA },
  },
  required: ["variantes"],
  additionalProperties: false,
};

const FLASHCARD_SCHEMA = {
  type: "object",
  properties: {
    frente: { type: "string" },
    verso: { type: "string" },
    dificuldade: { type: "string", enum: DIFICULDADES },
    topico: { type: ["string", "null"] },
  },
  required: ["frente", "verso", "dificuldade", "topico"],
  additionalProperties: false,
};

export const FLASHCARDS_SCHEMA = {
  type: "object",
  properties: {
    flashcards: { type: "array", items: FLASHCARD_SCHEMA },
  },
  required: ["flashcards"],
  additionalProperties: false,
};

// Flashcard MATEMÁTICO: além de frente/verso, traz a `resposta` final (curta) e
// a `verificacao` — a descrição do que é CALCULÁVEL, para o código conferir
// (a IA traduz, o código calcula; ver web/js/conferir.js). Campos sempre
// presentes (nullable) por exigência dos schemas estritos dos provedores.
const ATOMO_SCHEMA = {
  type: "object",
  properties: {
    simbolo: { type: "string" },
    // conta a ser avaliada pelo código (ex.: "3+2=7") OU...
    aritmetica: { type: ["string", "null"] },
    // ...valor "V"/"F" dado pela IA (fato do mundo ou atribuição dada).
    valor: { type: ["string", "null"] },
  },
  required: ["simbolo", "aritmetica", "valor"],
  additionalProperties: false,
};
const RESTRICAO_SCHEMA = {
  type: "object",
  properties: {
    expressao: { type: "string" },
    valor: { type: "string", enum: ["V", "F"] },
  },
  required: ["expressao", "valor"],
  additionalProperties: false,
};
// Uma verificação por SUBITEM (a, b, c…) da questão: rótulo + a resposta que a
// IA deu para o subitem + a descrição do que o código calcula para conferir.
const SUBVERIFICACAO_SCHEMA = {
  type: "object",
  properties: {
    rotulo: { type: "string" },                 // "a", "b", "c"...
    resposta: { type: ["string", "null"] },      // resposta da IA para o subitem
    tipo: { type: "string", enum: ["numerico", "logica_valor", "logica_incognita", "nenhuma"] },
    expressao: { type: ["string", "null"] },
    atomos: { type: ["array", "null"], items: ATOMO_SCHEMA },
    restricoes: { type: ["array", "null"], items: RESTRICAO_SCHEMA },
    incognitas: { type: ["array", "null"], items: { type: "string" } },
  },
  required: ["rotulo", "resposta", "tipo", "expressao", "atomos", "restricoes", "incognitas"],
  additionalProperties: false,
};
// Exercício = a QUESTÃO NUMERADA INTEIRA (todos os subitens juntos). A
// `verificacoes` lista um item por subitem, para o código conferir cada um.
const EXERCICIO_SCHEMA = {
  type: "object",
  properties: {
    frente: { type: "string" },       // enunciado completo (com os subitens)
    verso: { type: "string" },        // resolução de todos os subitens
    dificuldade: { type: "string", enum: DIFICULDADES },
    topico: { type: ["string", "null"] },
    verificacoes: { type: "array", items: SUBVERIFICACAO_SCHEMA },
  },
  required: ["frente", "verso", "dificuldade", "topico", "verificacoes"],
  additionalProperties: false,
};
export const EXERCICIOS_MATH_SCHEMA = {
  type: "object",
  properties: {
    exercicios: { type: "array", items: EXERCICIO_SCHEMA },
  },
  required: ["exercicios"],
  additionalProperties: false,
};

export const SABER_MAIS_SCHEMA = {
  type: "object",
  properties: {
    saber_mais: { type: "string" },
  },
  required: ["saber_mais"],
  additionalProperties: false,
};

export function promptSaberMais(pergunta: PerguntaIA, anteriores: string[]): string {
  const opcoesTexto = pergunta.opcoes
    .map((o) => `- ${o.texto} (${o.correta ? "CORRETA" : "incorreta"})`)
    .join("\n");

  const continuacao = anteriores.length
    ? "\n\nATENÇÃO — isto é uma CONTINUAÇÃO. A pessoa já leu a(s) explicação(ões) " +
      "abaixo e disse \"ainda não entendi\". Continue de onde parou: reexplique " +
      "de OUTRO jeito, mais simples e concreto (outra analogia, um exemplo passo " +
      "a passo, ou quebrando em partes menores). NÃO repita o que já foi dito e " +
      "NÃO comece recapitulando; emende naturalmente, como quem continua a " +
      "conversa. Não use rótulos, números nem títulos como \"Complemento 2\".\n" +
      "-----\n" + anteriores.join("\n\n") + "\n-----\n"
    : "";

  return (
    "Você é um tutor de estudos. Dada a questão de múltipla escolha abaixo, " +
    "escreva uma explicação CURTA (\"Saber mais\") em português do Brasil.\n\n" +
    "Vá direto ao essencial: o conceito central e por que a alternativa " +
    "correta é a certa. Só comente uma distratora se for pegadinha comum. " +
    "Não repita o enunciado, não faça introdução (\"Nesta questão...\") nem " +
    "frase de encerramento.\n\n" +
    "Formatação: Markdown enxuto — **negrito** só em 1 ou 2 termos-chave. Sem " +
    "títulos, sem listas longas, sem blocos de código. NO MÁXIMO 2 parágrafos " +
    "curtos, idealmente 1. Se 2 ou 3 frases bastarem, use só isso." +
    continuacao +
    "\n\nQuestão:\n" +
    `Enunciado: ${pergunta.enunciado}\n` +
    "Alternativas:\n" +
    `${opcoesTexto}\n\n` +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

// Bloco de instrução de TÓPICO, compartilhado pelos três prompts de ingestão.
// Existe para conter a fragmentação da taxonomia — o problema de o mesmo tema
// virar N rótulos ("S3", "Amazon S3", "S3 Versioning") ou específico demais.
// Duas regras: (1) REUTILIZAR um tópico que já existe na matéria (com a grafia
// exata) sempre que a questão couber, criando novo só quando inédito; e (2)
// granularidade de SERVIÇO/CONCEITO principal, nunca de sub-recurso/feature.
// `topicosExistentes` é a lista atual de subdivisões da matéria (o front envia).
export function blocoTopico(assunto: string, topicosExistentes: string[]): string {
  const lista = (topicosExistentes || [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 200); // teto defensivo: não estourar o tamanho do prompt

  const jaExistem = lista.length
    ? "TÓPICOS QUE JÁ EXISTEM nesta matéria — REUTILIZE um destes, com a grafia " +
      "EXATA, sempre que a questão se encaixar em algum; só crie um novo se " +
      "NENHUM servir:\n- " + lista.join("\n- ") + "\n\n"
    : "";

  return (
    jaExistem +
    `- "topico": o TEMA principal da questão dentro de "${assunto}", curto e ` +
    "GENÉRICO — no nível de SERVIÇO/CONCEITO, JAMAIS de sub-recurso ou feature. " +
    'Ex.: "S3" (não "S3 Versioning"), "IAM" (não "IAM Roles"), "SageMaker" ' +
    '(não "SageMaker Endpoints"). Prefira 1–2 palavras. Se um tópico da lista ' +
    "acima couber, use-o com a grafia EXATA; senão crie um novo seguindo essa " +
    "mesma granularidade genérica. null só se realmente não der para determinar.\n"
  );
}

export function promptExtracao(
  assunto: string,
  dificuldadePadrao: string,
  maxPerguntas: number,
  topicosExistentes: string[] = [],
): string {
  return (
    "Você é um assistente que extrai questões de múltipla escolha de um " +
    "texto bruto colado pelo usuário. O texto pode conter uma ou várias " +
    "questões, em qualquer formato (com ou sem a resposta correta " +
    "marcada, com ou sem numeração, texto de prova real colado sem " +
    "formatação, etc).\n\n" +
    `Para cada questão encontrada, no máximo ${maxPerguntas}, produza:\n` +
    '- "enunciado": o enunciado COMPLETO da questão. Preserve TODO o texto ' +
    "que antecede a pergunta (o cenário/caso, dados, requisitos e contexto) " +
    "exatamente como está — NÃO resuma, encurte nem reescreva. Remova apenas " +
    "as alternativas e as marcações de gabarito/explicação. O enunciado deve " +
    "conter o parágrafo de contexto seguido da frase final da pergunta.\n" +
    '- "opcoes": lista das alternativas, cada uma com "texto" e ' +
    '"correta" (true/false). Você deve decidir quais alternativas são ' +
    "corretas usando seu conhecimento sobre o assunto, mesmo que o texto " +
    "original não indique isso explicitamente ou indique errado. " +
    "Na grande maioria das questões, EXATAMENTE UMA alternativa é " +
    "correta — mas se o enunciado deixar claro que aceita mais de uma " +
    'resposta (ex.: "assinale a(s) alternativa(s) correta(s)", "marque ' +
    'todas as afirmações verdadeiras", "quais das opções abaixo estão ' +
    'certas"), marque "correta": true em TODAS as alternativas ' +
    "realmente corretas — pode ser mais de uma.\n" +
    '- "dificuldade": "Fácil", "Média" ou "Difícil". Se não for ' +
    `possível inferir, use "${dificuldadePadrao}".\n` +
    blocoTopico(assunto, topicosExistentes) +
    '- "saber_mais": se o texto original trouxer explicação/comentário/' +
    "gabarito comentado sobre a questão (por que a alternativa correta é " +
    "certa e/ou por que as outras estão erradas), copie esse conteúdo aqui, " +
    "organizado e sem cortar informação relevante. Se o texto NÃO trouxer " +
    "nenhuma explicação, use null. Não invente: só preencha com o que estiver " +
    "no texto.\n\n" +
    `Assunto geral das perguntas: ${assunto}.\n` +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

export function promptSaberMaisFlashcard(
  frente: string,
  verso: string,
  anteriores: string[],
): string {
  const continuacao = anteriores.length
    ? "\n\nATENÇÃO — isto é uma CONTINUAÇÃO. A pessoa já leu a(s) explicação(ões) " +
      "abaixo e disse \"ainda não entendi\". Continue de onde parou: reexplique " +
      "de OUTRO jeito, mais simples e concreto (outra analogia, exemplo passo a " +
      "passo, ou quebrando em partes menores). NÃO repita o que já foi dito e " +
      "NÃO comece recapitulando; emende naturalmente. Não use rótulos, números " +
      "nem títulos.\n-----\n" + anteriores.join("\n\n") + "\n-----\n"
    : "";

  return (
    "Você é um tutor de estudos. Dado o flashcard abaixo (frente e verso), " +
    "escreva uma explicação CURTA (\"Saber mais\") em português do Brasil.\n\n" +
    "Aprofunde só o essencial do conceito da resposta — um exemplo ou " +
    "pegadinha comum, se ajudar. Não repita o verso, não faça introdução nem " +
    "frase de encerramento.\n\n" +
    "Formatação: Markdown enxuto — **negrito** só em 1 ou 2 termos-chave. Sem " +
    "títulos, sem listas longas, sem blocos de código. NO MÁXIMO 2 parágrafos " +
    "curtos, idealmente 1. Se 2 ou 3 frases bastarem, use só isso." +
    continuacao +
    "\n\nFlashcard:\n" +
    `Frente: ${frente}\n` +
    `Verso: ${verso}\n\n` +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

export function promptFlashcards(
  assunto: string,
  dificuldadePadrao: string,
  maxFlashcards: number,
  contexto: string,
  topicosExistentes: string[] = [],
  matematica = false,
): string {
  const blocoContexto = contexto.trim()
    ? "\n\nCONTEXTO DA MATÉRIA (siga rigorosamente o estilo, o vocabulário e o " +
      "recorte de conteúdo descritos abaixo — ex.: edital da prova):\n" +
      "-----\n" + contexto.trim() + "\n-----\n"
    : "";

  // Matéria de exatas: fórmulas em LaTeX (o app renderiza em MathML). Diferente
  // do prompt de EXERCÍCIOS (promptFlashcardsMath): aqui são cards de CONCEITO,
  // não questões numeradas — é o que serve para slides/apostila.
  const blocoMath = matematica
    ? "\nNOTAÇÃO (matéria de exatas):\n" +
      "- Envolva em cifrões $...$ TODA expressão, símbolo ou fórmula, na frente e " +
      "no verso. Nunca deixe símbolo matemático solto.\n" +
      "- Use COMANDOS LaTeX, não Unicode: $\\neg$ $\\land$ $\\lor$ $\\to$ " +
      "$\\leftrightarrow$ raiz $\\sqrt{\\;}$ fração $\\frac{a}{b}$ potência x^{n} " +
      "vezes $\\cdot$ diferente $\\neq$ $\\leq$ $\\geq$ somatório $\\sum$ integral $\\int$.\n" +
      "- Toda fórmula vem com o significado de cada símbolo e as unidades quando houver.\n"
    : "";

  return (
    "Você cria flashcards de estudo (estilo Anki) a partir de um material colado " +
    "pelo usuário (anotações, apostila, SLIDES, edital, etc.).\n\n" +
    "COBERTURA EXAUSTIVA — a regra MAIS IMPORTANTE: percorra o material do INÍCIO " +
    "ao FIM e crie flashcards para CADA conceito, definição, fórmula, teorema, " +
    "propriedade, classificação, termo e exemplo que aparecer — inclusive os " +
    "secundários. NÃO resuma, NÃO selecione só os \"principais\", NÃO pule seções " +
    "nem slides. Um mesmo conceito pode virar VÁRIOS cards. Na dúvida entre incluir " +
    "ou não algo, INCLUA — é melhor cards demais do que faltar conteúdo. Slides " +
    "costumam ter muitos itens curtos: cada tópico/bullet com informação nova vira " +
    "pelo menos um card.\n\n" +
    `Gere QUANTOS flashcards forem necessários para cobrir tudo (até ${maxFlashcards}). ` +
    "Cada card:\n" +
    '- "frente": pergunta curta, termo ou lacuna que force recall ativo de UM ' +
    "conceito (nunca mais de um por card).\n" +
    '- "verso": a resposta direta e concisa — inclua a fórmula/relação quando o ' +
    "conceito tiver uma.\n" +
    '- "dificuldade": "Fácil", "Média" ou "Difícil". Se não der para inferir, ' +
    `use "${dificuldadePadrao}".\n` +
    blocoTopico(assunto, topicosExistentes) +
    blocoMath +
    blocoContexto +
    `\nAssunto geral: ${assunto}.\n` +
    "Se o material tiver mais conteúdo do que cabe no limite, prefira COBRIR mais " +
    "conceitos com cards mais enxutos a aprofundar poucos.\n" +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

// Flashcards de MATEMÁTICA a partir de exercícios de livro (com as respostas).
// Diferenças do promptFlashcards normal: fórmulas em LaTeX (o app renderiza em
// MathML) e o verso traz a resolução ELABORADA passo a passo — sempre — mas
// ancorada na resposta que veio no material (a resposta ser conhecida evita a
// IA "inventar" o resultado). Cada exercício vira um card (frente = enunciado,
// verso = passo a passo + resposta final).
export function promptFlashcardsMath(
  assunto: string,
  dificuldadePadrao: string,
  maxFlashcards: number,
  contexto: string,
  topicosExistentes: string[] = [],
): string {
  const blocoContexto = contexto.trim()
    ? "\n\nCONTEXTO DA MATÉRIA (siga o recorte/estilo descrito — ex.: ementa):\n" +
      "-----\n" + contexto.trim() + "\n-----\n"
    : "";

  return (
    "Você monta EXERCÍCIOS de MATEMÁTICA a partir de listas/livros colados pelo " +
    "usuário (enunciados e, quase sempre, as respostas/gabarito).\n\n" +
    "IMPORTANTE: um exercício = UMA QUESTÃO NUMERADA INTEIRA. Mantenha TODOS os " +
    "subitens (a, b, c, …) da mesma questão JUNTOS no mesmo exercício — NÃO crie " +
    "um exercício por subitem.\n\n" +
    `Para cada questão numerada, no máximo ${maxFlashcards}, produza:\n` +
    '- "frente": o ENUNCIADO completo da questão, com todos os subitens.\n' +
    '- "verso": a RESOLUÇÃO de CADA subitem, ELABORADA por você. Comece cada ' +
    "subitem com seu rótulo (ex.: \"a) …\"). Se o material trouxer as respostas, " +
    "chegue EXATAMENTE nelas (gabarito — não se contradiga). Cada passo em uma " +
    "linha (quebras normais, NUNCA barras invertidas soltas).\n" +
    '- "dificuldade": "Fácil", "Média" ou "Difícil" (se incerto, ' +
    `"${dificuldadePadrao}").\n` +
    blocoTopico(assunto, topicosExistentes) +
    '- "verificacoes": uma LISTA com UM item por subitem da questão. Cada item ' +
    "tem \"rotulo\" (\"a\", \"b\", …), \"resposta\" (a resposta CURTA daquele " +
    "subitem, ex.: \"F\", \"V(p)=F\", \"$p \\land q$\") e a descrição do que o " +
    "CÓDIGO calcula para conferir (assim erros de conta são pegos). Tipo do subitem:\n" +
    "   • Achar V ou F de uma proposição → tipo \"logica_valor\". \"expressao\" = " +
    "a proposição com SÍMBOLOS de átomo (letras) e operadores ASCII (& = E, " +
    "| = OU, ~ = NÃO, > = SE-ENTÃO, = = SE-E-SÓ-SE). \"atomos\" = lista, um por " +
    "letra: se o átomo é uma CONTA, ponha \"aritmetica\" (ex.: \"3+2=7\") e " +
    "\"valor\":null; se é um FATO do mundo ou um valor DADO no enunciado, ponha " +
    "\"valor\" (\"V\"/\"F\") e \"aritmetica\":null.\n" +
    "     Ex.: \"3+2=7 e 5+5=10\" → expressao \"a & b\", atomos [{simbolo:\"a\"," +
    "aritmetica:\"3+2=7\",valor:null},{simbolo:\"b\",aritmetica:\"5+5=10\",valor:null}].\n" +
    "     Ex. dado: \"$p \\land \\neg q$, com $V(p)=V, V(q)=F$\" → expressao " +
    "\"p & ~q\", atomos [{simbolo:\"p\",aritmetica:null,valor:\"V\"},{simbolo:\"q\"," +
    "aritmetica:null,valor:\"F\"}].\n" +
    "   • Determinar V(p)/V(q) a partir de condições → tipo \"logica_incognita\". " +
    "\"restricoes\" = lista de {expressao (em p,q,...), valor \"V\"/\"F\"}; " +
    "\"incognitas\" = [\"p\"] ou [\"p\",\"q\"].\n" +
    "     Ex.: \"$V(q)=F$ e $V(p\\lor q)=F$, achar $V(p)$\" → restricoes " +
    "[{expressao:\"q\",valor:\"F\"},{expressao:\"p|q\",valor:\"F\"}], incognitas [\"p\"].\n" +
    "   • Resposta é um NÚMERO → tipo \"numerico\", \"expressao\" = a conta (ex.: \"2+7\").\n" +
    "   • NÃO calculável → tipo \"nenhuma\" e os demais campos null. Entra AQUI: " +
    "traduzir p/ português ou p/ símbolos, interpretar, provar, desenhar, E " +
    "TAMBÉM toda questão cujos átomos NÃO têm valor V/F determinável (nem dado no " +
    "enunciado, nem de uma conta). Ex.: \"p: Está frio; escreva ¬p em palavras\" " +
    "→ \"nenhuma\" (não há V/F a calcular). Só use logica_valor/logica_incognita " +
    "quando de fato houver V/F a apurar. Em \"nenhuma\", a \"resposta\" é a " +
    "resposta curta REAL do subitem (a tradução, o símbolo, o valor pedido) — " +
    "NUNCA um \"V\"/\"F\" inventado.\n" +
    "   Na verificacao use a sintaxe ASCII dos operadores (& | ~ > =), NÃO LaTeX. " +
    "Preencha com null todo campo não usado.\n\n" +
    "REGRAS DE MATEMÁTICA (essenciais):\n" +
    "- Envolva em cifrões $...$ TODA expressão simbólica na frente/verso/resposta. " +
    "Ex.: \"Traduza $p \\leftrightarrow \\neg q$\". Nunca deixe símbolo solto.\n" +
    "- Use COMANDOS LaTeX, não Unicode: negação $\\neg$, E $\\land$, OU $\\lor$, " +
    "se-então $\\to$, sse $\\leftrightarrow$, raiz $\\sqrt{\\;}$, fração " +
    "$\\frac{a}{b}$, potência x^{n}, vezes $\\cdot$, diferente $\\neq$.\n" +
    "- Um exercício por QUESTÃO (subitens juntos); não invente questões fora do " +
    "texto; sem HTML." +
    blocoContexto +
    `\nAssunto geral: ${assunto}.\n` +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

export interface PerguntaIA {
  enunciado: string;
  dificuldade: string;
  opcoes: { texto: string; correta: boolean }[];
  topico: string | null;
}

export function promptReformulacao(pergunta: PerguntaIA): string {
  const opcoesTexto = pergunta.opcoes
    .map((o) => `- ${o.texto} (${o.correta ? "CORRETA" : "incorreta"})`)
    .join("\n");
  const numCorretas = pergunta.opcoes.filter((o) => o.correta).length;
  const regraCorretas = numCorretas > 1
    ? `- Esta questão tem mais de uma alternativa correta: exatamente ` +
      `${numCorretas} alternativas devem ter "correta": true, testando os ` +
      "mesmos conceitos que eram as respostas corretas originais — não " +
      "troque quais fatos são corretos.\n"
    : '- Exatamente uma alternativa deve ter "correta": true, e ela deve ' +
      "testar o mesmo conceito que era a resposta correta original — não " +
      "troque qual é o fato correto.\n";

  return (
    "Reescreva a pergunta de múltipla escolha abaixo, mudando a redação " +
    "do enunciado e das alternativas (parafraseando, trocando exemplos, " +
    "mudando a ordem das alternativas), mas mantendo exatamente o mesmo " +
    "conceito testado e a mesma resposta correta.\n\n" +
    "Regras:\n" +
    `- O número de alternativas deve continuar o mesmo: ${pergunta.opcoes.length}.\n` +
    regraCorretas +
    "- Não copie o enunciado nem as alternativas originais literalmente; " +
    "mude a redação.\n" +
    `- Mantenha a mesma dificuldade ("${pergunta.dificuldade}") e o ` +
    `mesmo tópico ("${pergunta.topico ?? "geral"}").\n\n` +
    "Pergunta original:\n" +
    `Enunciado: ${pergunta.enunciado}\n` +
    "Alternativas:\n" +
    `${opcoesTexto}\n\n` +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

// Gera N reescritas do mesmo conceito numa única chamada. Cada variante deve
// atacar o conceito por um ângulo diferente — se as N forem paráfrases quase
// iguais, o efeito de "desacostumar o cérebro" se perde.
export function promptVariantes(pergunta: PerguntaIA, quantidade: number): string {
  const opcoesTexto = pergunta.opcoes
    .map((o) => `- ${o.texto} (${o.correta ? "CORRETA" : "incorreta"})`)
    .join("\n");
  const numCorretas = pergunta.opcoes.filter((o) => o.correta).length;

  return (
    `Gere ${quantidade} VERSÕES DIFERENTES da questão de múltipla escolha ` +
    "abaixo. O objetivo é treinar a mesma pessoa que já acertou a questão " +
    "original várias vezes: ela precisa recuperar o CONCEITO, e não " +
    "reconhecer o formato decorado.\n\n" +
    "Regras:\n" +
    "- Todas as versões testam EXATAMENTE o mesmo conceito e mantêm os " +
    "mesmos fatos como corretos. Não mude o que é verdadeiro.\n" +
    `- Cada versão deve ter ${pergunta.opcoes.length} alternativas, sendo ` +
    `${numCorretas} correta(s) — o mesmo que o original.\n` +
    "- Varie o ÂNGULO entre as versões, não só as palavras. Por exemplo: uma " +
    "versão como caso prático/cenário aplicado; outra invertendo a pergunta " +
    "(pedir a exceção, o que NÃO se aplica — deixando isso explícito no " +
    "enunciado); outra trocando o exemplo/contexto por um equivalente.\n" +
    "- Não copie o enunciado nem as alternativas originais literalmente.\n" +
    "- Os distratores devem ser plausíveis e errados pelo mesmo motivo " +
    "conceitual dos distratores originais.\n" +
    "- NÃO cite letras nem posições ('a alternativa A', 'todas as " +
    "anteriores'): a ordem é embaralhada na hora de exibir.\n" +
    `- Mantenha a dificuldade ("${pergunta.dificuldade}") e o tópico ` +
    `("${pergunta.topico ?? "geral"}").\n\n` +
    "Questão original:\n" +
    `Enunciado: ${pergunta.enunciado}\n` +
    "Alternativas:\n" +
    `${opcoesTexto}\n\n` +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

// ---------- provedores ----------

export class ErroProvedorIA extends Error {}

type ConfigProvedor = {
  envChave: string;
  envModelo: string;
  modeloPadrao: string;
  baseUrl: string;
};

const PROVEDORES: Record<string, ConfigProvedor> = {
  ChatGPT: {
    envChave: "OPENAI_API_KEY",
    envModelo: "OPENAI_MODEL",
    modeloPadrao: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
  },
  Grok: {
    envChave: "XAI_API_KEY",
    envModelo: "XAI_MODEL",
    modeloPadrao: "grok-4.3",
    baseUrl: "https://api.x.ai/v1",
  },
  Claude: {
    envChave: "ANTHROPIC_API_KEY",
    envModelo: "ANTHROPIC_MODEL",
    modeloPadrao: "claude-sonnet-5",
    baseUrl: "https://api.anthropic.com/v1",
  },
};

async function chamarCompatOpenAI(
  config: ConfigProvedor,
  chave: string,
  system: string | null,
  mensagem: string,
  schema: unknown,
  nomeSchema: string,
): Promise<unknown> {
  const mensagens = [];
  if (system) mensagens.push({ role: "system", content: system });
  mensagens.push({ role: "user", content: mensagem });

  const resposta = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get(config.envModelo) || config.modeloPadrao,
      messages: mensagens,
      // Teto alto de saída: extrações grandes (slides com dezenas de conceitos)
      // não podem ser truncadas no meio da lista de flashcards.
      max_tokens: 16384,
      response_format: {
        type: "json_schema",
        json_schema: { name: nomeSchema, schema, strict: true },
      },
    }),
  });

  if (!resposta.ok) {
    throw new ErroProvedorIA(`Erro na API do provedor (HTTP ${resposta.status}).`);
  }

  const dados = await resposta.json();
  const texto = dados.choices?.[0]?.message?.content;
  if (!texto) throw new ErroProvedorIA("A resposta do provedor não contém JSON.");
  return JSON.parse(texto);
}

async function chamarAnthropic(
  config: ConfigProvedor,
  chave: string,
  system: string | null,
  mensagem: string,
  schema: unknown,
): Promise<unknown> {
  const corpo: Record<string, unknown> = {
    model: Deno.env.get(config.envModelo) || config.modeloPadrao,
    max_tokens: 8192,
    messages: [{ role: "user", content: mensagem }],
    output_config: { format: { type: "json_schema", schema } },
  };
  if (system) corpo.system = system;

  const resposta = await fetch(`${config.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": chave,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    throw new ErroProvedorIA(`Erro na API do provedor (HTTP ${resposta.status}).`);
  }

  const dados = await resposta.json();
  const texto = dados.content?.[0]?.text;
  if (!texto) throw new ErroProvedorIA("A resposta do provedor não contém JSON.");
  return JSON.parse(texto);
}

export async function chamarProvedor(
  modelo: string,
  system: string | null,
  mensagem: string,
  schema: unknown,
  nomeSchema: string,
): Promise<unknown> {
  const config = PROVEDORES[modelo];
  if (!config) throw new ErroProvedorIA(`Provedor desconhecido: ${modelo}`);

  const chave = Deno.env.get(config.envChave);
  if (!chave) {
    throw new ErroProvedorIA(
      `O provedor ${modelo} não está configurado neste servidor.`,
    );
  }

  if (modelo === "Claude") {
    return await chamarAnthropic(config, chave, system, mensagem, schema);
  }
  return await chamarCompatOpenAI(config, chave, system, mensagem, schema, nomeSchema);
}
