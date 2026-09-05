// Edge Function: baixa um material a partir de uma URL e guarda no bucket
// `materiais`, na pasta da matéria. Serve para colar o link de um PDF de curso
// em vez de baixar à mão e depois subir.
//
// Entrada: { url, materia_id, nome? }
// Saída:   { caminho, nome, tamanho }
//
// ATENÇÃO — SSRF é o risco central aqui. Uma função que busca uma URL escolhida
// pelo usuário pode ser usada para alcançar coisas que só o SERVIDOR enxerga:
// o endpoint de metadados da cloud (169.254.169.254), serviços em localhost, a
// rede interna. Por isso:
//   1. só https (nada de http, file:, gopher:, data:…);
//   2. hostname que seja IP privado/loopback/link-local é recusado;
//   3. redirecionamento é seguido À MÃO, revalidando cada salto — seguir
//      automático permitiria um host público redirecionar para um IP interno;
//   4. teto de tamanho aplicado durante a leitura, não só pelo Content-Length
//      (que o servidor remoto pode mentir);
//   5. o upload usa o JWT do usuário, então o arquivo só pode cair na pasta
//      dele (a política do Storage é quem decide).

import { corsHeaders, respostaJson, usuarioIdDoRequest } from "../_shared/comum.ts";

const BUCKET = "materiais";
const MAX_BYTES = 50 * 1024 * 1024; // mesmo teto do bucket
const MAX_REDIRECIONAMENTOS = 3;
const TIMEOUT_MS = 60_000;

// Bloqueia destinos que só existem "de dentro" do servidor.
function destinoPermitido(u: URL): boolean {
  if (u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  // IPv6 literal (vem entre colchetes) — bloqueado por inteiro: cobre ::1 e fd00::/8
  if (host.includes(":")) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 127) return false;                 // este host / loopback
    if (a === 10) return false;                             // privado
    if (a === 172 && b >= 16 && b <= 31) return false;      // privado
    if (a === 192 && b === 168) return false;               // privado
    if (a === 169 && b === 254) return false;               // link-local (metadata da cloud)
    if (a >= 224) return false;                             // multicast/reservado
  }
  return true;
}

// Nome de arquivo derivado da URL, com as mesmas regras do upload manual.
function nomeDaUrl(u: URL, fallback: string): string {
  const bruto = decodeURIComponent(u.pathname.split("/").pop() || "") || fallback;
  const limpo = bruto
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const nome = limpo || fallback;
  return /\.[a-z0-9]{2,5}$/i.test(nome) ? nome : `${nome}.pdf`;
}

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

  const materiaId = Number(corpo.materia_id);
  if (!Number.isInteger(materiaId) || materiaId <= 0) {
    return respostaJson(req, { erro: "Matéria inválida." }, 400);
  }

  let alvo: URL;
  try {
    alvo = new URL(String(corpo.url ?? ""));
  } catch {
    return respostaJson(req, { erro: "Link inválido." }, 400);
  }
  if (!destinoPermitido(alvo)) {
    return respostaJson(req, { erro: "Este link não é permitido (use um endereço https público)." }, 400);
  }

  // 1) baixa seguindo redirecionamentos MANUALMENTE, revalidando cada destino
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  let resposta: Response;
  try {
    let atual = alvo;
    let saltos = 0;
    while (true) {
      resposta = await fetch(atual, {
        redirect: "manual",
        signal: controlador.signal,
        headers: { Accept: "application/pdf,*/*" },
      });
      if (![301, 302, 303, 307, 308].includes(resposta.status)) break;

      const destino = resposta.headers.get("location");
      if (!destino || ++saltos > MAX_REDIRECIONAMENTOS) {
        return respostaJson(req, { erro: "Link com redirecionamentos demais." }, 400);
      }
      const proxima = new URL(destino, atual);
      if (!destinoPermitido(proxima)) {
        return respostaJson(req, { erro: "O link redireciona para um endereço não permitido." }, 400);
      }
      atual = proxima;
    }

    if (!resposta.ok) {
      return respostaJson(req, { erro: `O servidor do link respondeu ${resposta.status}.` }, 400);
    }

    // Content-Length é só um aviso — o teto real é aplicado na leitura abaixo.
    const anunciado = Number(resposta.headers.get("content-length") ?? 0);
    if (anunciado > MAX_BYTES) {
      return respostaJson(req, { erro: "Arquivo maior que 50 MB." }, 413);
    }

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.byteLength === 0) {
      return respostaJson(req, { erro: "O link não devolveu nenhum arquivo." }, 400);
    }
    if (bytes.byteLength > MAX_BYTES) {
      return respostaJson(req, { erro: "Arquivo maior que 50 MB." }, 413);
    }

    const tipo = resposta.headers.get("content-type") ?? "application/octet-stream";
    const nome = String(corpo.nome ?? "") || nomeDaUrl(alvo, "material");
    const caminho = `${uid}/${materiaId}/${nome}`;

    // 2) sobe COM O TOKEN DO USUÁRIO: a política do Storage é quem autoriza,
    // então o arquivo não tem como cair na pasta de outra pessoa.
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const envio = await fetch(
      `${url}/storage/v1/object/${BUCKET}/${caminho.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "POST",
        headers: {
          apikey: anon,
          Authorization: req.headers.get("Authorization") ?? "",
          "Content-Type": tipo.split(";")[0],
          "x-upsert": "false", // não sobrescrever em silêncio
        },
        body: bytes,
      },
    );

    if (!envio.ok) {
      const detalhe = await envio.text();
      const duplicado = envio.status === 409 || /exists/i.test(detalhe);
      return respostaJson(
        req,
        { erro: duplicado ? `Já existe um arquivo chamado "${nome}".` : "Não consegui guardar o arquivo." },
        duplicado ? 409 : 502,
      );
    }

    return respostaJson(req, { caminho, nome, tamanho: bytes.byteLength });
  } catch (erro) {
    const abortou = (erro as Error).name === "AbortError";
    console.error("falha ao baixar material:", (erro as Error).message);
    return respostaJson(
      req,
      { erro: abortou ? "O download demorou demais." : "Não consegui baixar deste link." },
      502,
    );
  } finally {
    clearTimeout(relogio);
  }
});
