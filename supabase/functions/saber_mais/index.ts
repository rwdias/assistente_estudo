// Edge Function: "Saber mais" de uma questão/flashcard.
//
// A DECISÃO cache-ou-IA mora AQUI, no servidor — de propósito. O front nunca
// recebe os complementos salvos no carregamento e sempre faz a mesma chamada
// (POST com pergunta_id + quantos já viu). Assim não há como, pelo código do
// cliente nem pelo devtools, distinguir uma resposta vinda do cache de uma
// recém-gerada pela IA: a forma da resposta é idêntica nos dois casos.
//
// Entrada:  { modelo?, pergunta_id, vistos }
// Saída:    { complementos: string[], total: number }
//   - se há complemento salvo além dos `vistos` → devolve o(s) salvo(s) SEM
//     tocar na IA nem na quota;
//   - senão, e ainda cabendo (< 3) → gera 1 novo, persiste e devolve.

import {
  chamarProvedor,
  consumirQuota,
  corsHeaders,
  ErroProvedorIA,
  type PerguntaIA,
  promptSaberMais,
  promptSaberMaisFlashcard,
  respostaJson,
  restComoUsuario,
  SABER_MAIS_SCHEMA,
  usuarioAutenticado,
} from "../_shared/comum.ts";

const MAX_COMPLEMENTOS = 3;
// Piso de latência do caminho de cache, para a abertura parecer uma consulta
// (o caminho de IA já é naturalmente lento). Invisível ao cliente.
const PISO_CACHE_MS = 650;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const modelo = String(corpo.modelo ?? "ChatGPT");
  const perguntaId = Number(corpo.pergunta_id);
  const vistos = Math.max(0, Math.trunc(Number(corpo.vistos ?? 0)) || 0);
  if (!Number.isInteger(perguntaId) || perguntaId <= 0) {
    return respostaJson(req, { erro: "pergunta_id inválido." }, 400);
  }

  // Carrega a questão pelo JWT do chamador — o RLS garante que só a própria
  // aparece; questão de outro usuário volta vazia (IDOR bloqueado no servidor).
  const resp = await restComoUsuario(
    req,
    `perguntas?id=eq.${perguntaId}&select=tipo,enunciado,verso,saber_mais,` +
      `opcoes(texto,correta,ordem)`,
  );
  if (!resp.ok) {
    return respostaJson(req, { erro: "Falha ao carregar a questão." }, 502);
  }
  const linhas = (await resp.json()) as Array<{
    tipo: string;
    enunciado: string;
    verso: string | null;
    saber_mais: unknown;
    opcoes: Array<{ texto: string; correta: boolean; ordem: number }>;
  }>;
  if (!linhas.length) {
    return respostaJson(req, { erro: "Questão não encontrada." }, 404);
  }

  const q = linhas[0];
  const salvos = (Array.isArray(q.saber_mais) ? q.saber_mais : [])
    .filter((t): t is string => typeof t === "string" && t.trim() !== "");

  // CACHE: há complemento salvo além do que o cliente já viu → devolve sem IA.
  if (salvos.length > vistos) {
    await dormir(PISO_CACHE_MS);
    return respostaJson(req, {
      complementos: salvos.slice(vistos),
      total: salvos.length,
    });
  }

  // Sem nada novo salvo. Se já atingiu o teto, não há mais o que oferecer.
  if (salvos.length >= MAX_COMPLEMENTOS) {
    return respostaJson(req, { complementos: [], total: salvos.length });
  }

  // GERAÇÃO por IA: usa os salvos como "anteriores" (para reexplicar diferente).
  const ehFlashcard = q.tipo === "flashcard";
  let prompt: string;
  if (ehFlashcard) {
    if (!q.verso || !q.verso.trim()) {
      return respostaJson(req, { erro: "Flashcard sem verso." }, 400);
    }
    prompt = promptSaberMaisFlashcard(q.enunciado, q.verso, salvos);
  } else {
    const opcoes = (q.opcoes ?? []).slice().sort((a, b) => a.ordem - b.ordem);
    if (opcoes.length < 2) {
      return respostaJson(req, { erro: "Questão sem alternativas." }, 400);
    }
    const pergunta: PerguntaIA = {
      enunciado: q.enunciado,
      dificuldade: "Média",
      opcoes: opcoes.map((o) => ({ texto: o.texto, correta: Boolean(o.correta) })),
      topico: null,
    };
    prompt = promptSaberMais(pergunta, salvos);
  }

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
      prompt,
      SABER_MAIS_SCHEMA,
      "saber_mais",
    )) as { saber_mais: string };

    const texto = (dados.saber_mais ?? "").trim();
    if (!texto) throw new ErroProvedorIA("A IA não retornou conteúdo.");

    // Persiste via RPC (teto de 3 + RLS do dono), com o JWT do chamador.
    const persist = await restComoUsuario(req, "rpc/adicionar_saber_mais", {
      method: "POST",
      body: JSON.stringify({ p_pergunta_id: perguntaId, p_texto: texto }),
    });
    if (!persist.ok) {
      // gerou mas não gravou: devolve mesmo assim (não gravado no cache).
      console.error("saber_mais: falha ao persistir", await persist.text());
      return respostaJson(req, { complementos: [texto], total: salvos.length + 1 });
    }
    const novoArray = (await persist.json()) as string[];
    const total = Array.isArray(novoArray) ? novoArray.length : salvos.length + 1;
    return respostaJson(req, { complementos: [texto], total });
  } catch (erro) {
    if (erro instanceof ErroProvedorIA) {
      return respostaJson(req, { erro: erro.message }, 502);
    }
    console.error("erro inesperado no saber mais:", (erro as Error).message);
    return respostaJson(req, { erro: "Erro interno." }, 500);
  }
});
