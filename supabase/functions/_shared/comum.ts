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
    "Você é um tutor de estudos conversando com um aluno. Dada a questão de " +
    "múltipla escolha abaixo, escreva uma explicação (\"Saber mais\") em " +
    "português do Brasil, clara e didática, como se estivesse falando com a " +
    "pessoa.\n\n" +
    "A explicação deve:\n" +
    "- esclarecer o conceito central por trás da questão;\n" +
    "- deixar claro por que a alternativa correta é a certa e por que as " +
    "outras não servem;\n" +
    "- trazer contexto útil (exemplos, quando usar, comparações, pegadinhas).\n\n" +
    "Regras de formatação: use Markdown enxuto — **negrito** para termos-chave, " +
    "listas com \"- \" e, se ajudar, uma tabela `| a | b |`. Não use títulos " +
    "com # nem blocos de código. Escreva um texto corrido e contínuo (sem " +
    "numeração ou rótulo de seção). Seja objetivo (1 a 4 parágrafos)." +
    continuacao +
    "\n\nQuestão:\n" +
    `Enunciado: ${pergunta.enunciado}\n` +
    "Alternativas:\n" +
    `${opcoesTexto}\n\n` +
    "Responda apenas com o JSON pedido, sem texto adicional."
  );
}

export function promptExtracao(
  assunto: string,
  dificuldadePadrao: string,
  maxPerguntas: number,
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
    '"correta" (true/false). Você deve decidir qual alternativa é a ' +
    "correta usando seu conhecimento sobre o assunto, mesmo que o texto " +
    "original não indique isso explicitamente ou indique errado. " +
    'Exatamente uma alternativa deve ter "correta": true.\n' +
    '- "dificuldade": "Fácil", "Média" ou "Difícil". Se não for ' +
    `possível inferir, use "${dificuldadePadrao}".\n` +
    `- "topico": um subtópico curto dentro de "${assunto}" (ex.: "IAM", ` +
    '"Redes", "Regressão Linear"), ou null se não for possível ' +
    "determinar.\n" +
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
    "Você é um tutor de estudos conversando com um aluno. Dado o flashcard " +
    "abaixo (frente e verso), escreva uma explicação (\"Saber mais\") em " +
    "português do Brasil, clara e didática, como se estivesse falando com a " +
    "pessoa.\n\n" +
    "Explique melhor o conceito da resposta, com contexto útil, exemplos, " +
    "comparações e pegadinhas comuns — sem apenas repetir o verso.\n\n" +
    "Regras de formatação: use Markdown enxuto — **negrito** para termos-chave, " +
    "listas com \"- \" e, se ajudar, uma tabela `| a | b |`. Não use títulos " +
    "com # nem blocos de código. Texto corrido e contínuo (sem numeração ou " +
    "rótulo de seção). Seja objetivo (1 a 4 parágrafos)." +
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
): string {
  const blocoContexto = contexto.trim()
    ? "\n\nCONTEXTO DA MATÉRIA (siga rigorosamente o estilo, o vocabulário e o " +
      "recorte de conteúdo descritos abaixo — ex.: edital da prova):\n" +
      "-----\n" + contexto.trim() + "\n-----\n"
    : "";

  return (
    "Você é um assistente que cria flashcards de estudo (estilo Anki) a " +
    "partir de um texto bruto colado pelo usuário (anotações, trechos de " +
    "apostila, edital, questões, etc.).\n\n" +
    `Crie flashcards objetivos, no máximo ${maxFlashcards}, cada um com:\n` +
    '- "frente": uma pergunta curta, termo ou lacuna que force recall ' +
    "ativo de UM conceito específico (nunca mais de um conceito por card).\n" +
    '- "verso": a resposta direta e concisa, sem rodeios.\n' +
    '- "dificuldade": "Fácil", "Média" ou "Difícil". Se não for possível ' +
    `inferir, use "${dificuldadePadrao}".\n` +
    `- "topico": um subtópico curto dentro de "${assunto}", ou null.\n` +
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

  return (
    "Reescreva a pergunta de múltipla escolha abaixo, mudando a redação " +
    "do enunciado e das alternativas (parafraseando, trocando exemplos, " +
    "mudando a ordem das alternativas), mas mantendo exatamente o mesmo " +
    "conceito testado e a mesma resposta correta.\n\n" +
    "Regras:\n" +
    `- O número de alternativas deve continuar o mesmo: ${pergunta.opcoes.length}.\n` +
    '- Exatamente uma alternativa deve ter "correta": true, e ela deve ' +
    "testar o mesmo conceito que era a resposta correta original — não " +
    "troque qual é o fato correto.\n" +
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
