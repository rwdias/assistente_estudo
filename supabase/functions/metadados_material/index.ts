// Edge Function: lê as PRIMEIRAS PÁGINAS de um PDF já enviado ao bucket
// `materiais` e devolve os metadados bibliográficos (título, autores, editora…).
//
// Entrada: { caminho: "uid/materia_id/arquivo.pdf", modelo? }
// Saída:   { metadados: { titulo, autores[], ano, editora, edicao, isbn, idioma, descricao } }
//
// Segurança (o ponto mais importante desta função): o PDF é baixado com o JWT
// DO PRÓPRIO USUÁRIO, não com a service key. Assim quem autoriza a leitura é a
// política do Storage — se o caminho não for dele, o download simplesmente
// falha. Usar service key aqui exigiria validar o dono na mão e transformaria
// qualquer descuido num IDOR. A checagem do prefixo abaixo é só defesa em
// profundidade, não a barreira principal.

import {
  chamarProvedor,
  consumirQuota,
  corsHeaders,
  ErroProvedorIA,
  METADADOS_MATERIAL_SCHEMA,
  promptMetadadosMaterial,
  respostaJson,
  usuarioIdDoRequest,
} from "../_shared/comum.ts";

// unpdf é o pdf.js empacotado para runtimes serverless (sem DOM, sem worker).
import { getDocumentProxy } from "npm:unpdf@0.12.1";

const BUCKET = "materiais";
const PAGINAS_LIDAS = 4;       // capa + folha de rosto + créditos costumam caber aqui
const MAX_BYTES = 25 * 1024 * 1024; // acima disso o parse não vale o risco de estourar a memória
const MAX_CHARS = 6000;        // recorte do texto enviado à IA

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return respostaJson(req, { erro: "Método não suportado." }, 405);
  }

  const uid = await usuarioIdDoRequest(req);
  if (!uid) return respostaJson(req, { erro: "Não autenticado." }, 401);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return respostaJson(req, { erro: "Corpo inválido." }, 400);
  }

  const caminho = String(corpo.caminho ?? "");
  const modelo = String(corpo.modelo ?? "ChatGPT");

  if (!caminho || caminho.includes("..")) {
    return respostaJson(req, { erro: "Caminho inválido." }, 400);
  }
  // Defesa em profundidade: o caminho tem que estar na pasta do próprio usuário.
  // (A barreira de verdade é a política do Storage, exercida no fetch abaixo.)
  if (!caminho.startsWith(`${uid}/`)) {
    return respostaJson(req, { erro: "Caminho não pertence a você." }, 403);
  }
  if (!/\.pdf$/i.test(caminho)) {
    return respostaJson(req, { erro: "Só PDF tem metadados legíveis por aqui." }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1) baixa o PDF COM O TOKEN DO USUÁRIO (o RLS do Storage é quem autoriza)
  const arquivo = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${caminho.split("/").map(encodeURIComponent).join("/")}`,
    { headers: { apikey: anon, Authorization: req.headers.get("Authorization") ?? "" } },
  );
  if (!arquivo.ok) {
    return respostaJson(req, { erro: "Arquivo não encontrado." }, 404);
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) {
    return respostaJson(
      req,
      { erro: "Arquivo grande demais para ler automaticamente. Preencha os dados à mão." },
      413,
    );
  }

  // 2) extrai o texto das primeiras páginas (é onde fica a ficha catalográfica)
  let trecho = "";
  let paginas: number | null = null;
  try {
    const pdf = await getDocumentProxy(bytes);
    // Total de páginas vem do PARSER, não da IA: é um número que o pdf.js sabe
    // com certeza, e perguntar isso ao modelo seria convidar alucinação.
    paginas = pdf.numPages ?? null;
    // Página a página, e SÓ as primeiras. O atalho `extractText(pdf)` percorre o
    // documento inteiro — num livro de 300 páginas isso estoura o limite de
    // CPU/memória do worker (WORKER_RESOURCE_LIMIT), e o que interessa aqui
    // (capa, folha de rosto, créditos) está nas primeiras páginas de qualquer jeito.
    const total = Math.min(PAGINAS_LIDAS, pdf.numPages ?? PAGINAS_LIDAS);
    const partes: string[] = [];
    for (let n = 1; n <= total; n++) {
      const pagina = await pdf.getPage(n);
      const conteudo = await pagina.getTextContent();
      const texto = (conteudo.items as Array<{ str?: string }>)
        .map((item) => item.str ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (texto) partes.push(texto);
      if (partes.join(" ").length > MAX_CHARS) break; // já tem material de sobra
    }
    trecho = partes.join("\n\n").slice(0, MAX_CHARS).trim();
  } catch (erro) {
    console.error("falha ao ler o PDF:", (erro as Error).message);
    return respostaJson(req, { erro: "Não consegui ler este PDF (pode ser digitalizado)." }, 422);
  }

  // PDF digitalizado (só imagem) não tem texto extraível: não gasta chamada de IA.
  if (trecho.replace(/\s/g, "").length < 40) {
    return respostaJson(
      req,
      { erro: "Este PDF não tem texto (parece digitalizado). Preencha os dados à mão." },
      422,
    );
  }

  // 3) só agora consome quota — antes disso nada de IA foi gasto
  if (!(await consumirQuota(req))) {
    return respostaJson(
      req,
      { erro: "Limite diário de chamadas de IA atingido. Tente novamente amanhã." },
      429,
    );
  }

  try {
    const nomeArquivo = caminho.split("/").pop() ?? "";
    const dados = await chamarProvedor(
      modelo,
      promptMetadadosMaterial(nomeArquivo),
      trecho,
      METADADOS_MATERIAL_SCHEMA,
      "metadados_material",
    );
    // `paginas` é acrescentado pelo servidor, fora do que a IA devolveu.
    return respostaJson(req, { metadados: { ...(dados as object), paginas } });
  } catch (erro) {
    if (erro instanceof ErroProvedorIA) {
      return respostaJson(req, { erro: erro.message }, 502);
    }
    console.error("erro inesperado nos metadados:", (erro as Error).message);
    return respostaJson(req, { erro: "Erro interno." }, 500);
  }
});
