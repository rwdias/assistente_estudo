#!/usr/bin/env python3
"""Ferramenta de curadoria de provas para o catálogo do Study Rats.

Fluxo: baixar (fonte oficial) -> extrair (PDF -> JSON de revisão via IA +
gabarito oficial) -> revisar o JSON no editor -> publicar (JSON -> catálogo
no Supabase). Os usuários do app importam do catálogo sem gastar IA.

Uso:
  python provas.py baixar   enem --ano 2023 --dia 1
  python provas.py extrair  enem --ano 2023 --dia 1 --area humanas [--max N]
  python provas.py publicar revisao/enem_2023_humanas.json [--substituir]
  python provas.py listar

Fontes: 'enem' implementada (INEP oficial). Bancas/vestibulares entram como
novos adaptadores em FONTES.
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CACHE = BASE_DIR / "cache"
REVISAO = BASE_DIR / "revisao"
ENV = BASE_DIR.parent.parent / ".env"

POOLER = ("host=aws-1-sa-east-1.pooler.supabase.com port=5432 dbname=postgres "
          "user=postgres.scafgcpxjsimzaaviean password={senha}")


def ler_env(chave, obrigatoria=True):
    with open(ENV) as f:
        for linha in f:
            if linha.startswith(chave + "="):
                return linha.split("=", 1)[1].strip()
    if obrigatoria:
        sys.exit(f"{chave} não encontrada no .env")


# =========================================================
# Fonte: ENEM (INEP) — PDFs oficiais e públicos
# =========================================================

ENEM_URL = "https://download.inep.gov.br/enem/provas_e_gabaritos/{ano}_{tipo}_impresso_D{dia}_CD{cd}.pdf"
# caderno azul: CD1 no dia 1, CD7 no dia 2
ENEM_CADERNO_AZUL = {1: 1, 2: 7}
ENEM_AREAS = {
    # área -> (dia, questão inicial, questão final)
    "linguagens": (1, 6, 45),   # 1-5 são língua estrangeira (fora do MVP)
    "humanas": (1, 46, 90),
    "natureza": (2, 91, 135),
    "matematica": (2, 136, 180),
}
ENEM_NOMES = {
    "linguagens": "Linguagens e Códigos",
    "humanas": "Ciências Humanas",
    "natureza": "Ciências da Natureza",
    "matematica": "Matemática",
}


def enem_dir(ano, dia):
    """Acervo estruturado (fora do git): cache/enem/<ano>/dia<en>/..."""
    return CACHE / "enem" / str(ano) / f"dia{dia}"


def enem_baixar(ano, dia):
    # curl em vez de urllib: o download.inep.gov.br entrega a cadeia TLS
    # incompleta e o urllib rejeita; o curl do macOS resolve sozinho.
    import subprocess

    enem_dir(ano, dia).mkdir(parents=True, exist_ok=True)
    arquivos = {}
    for tipo, rotulo in (("PV", "prova"), ("GB", "gabarito")):
        destino = enem_dir(ano, dia) / f"{rotulo}.pdf"
        if not destino.exists():
            url = ENEM_URL.format(ano=ano, tipo=tipo, dia=dia, cd=ENEM_CADERNO_AZUL[dia])
            print(f"baixando {url}")
            subprocess.run(
                ["curl", "-sf", "-A", "Mozilla/5.0", "-o", str(destino), url],
                check=True,
            )
        print(f"  ok: {destino.name} ({destino.stat().st_size // 1024} KB)")
        arquivos[rotulo] = destino
    return arquivos


def enem_gabarito(ano, dia):
    """Extrai o mapa questão -> letra do PDF de gabarito (caderno azul)."""
    import pdfplumber

    caminho = enem_dir(ano, dia) / "gabarito.pdf"
    texto = ""
    with pdfplumber.open(caminho) as pdf:
        for pagina in pdf.pages:
            texto += (pagina.extract_text() or "") + "\n"

    mapa = {}
    for numero, letra in re.findall(r"(\d{1,3})\s+([A-E])\b", texto):
        n = int(numero)
        if 1 <= n <= 180 and n not in mapa:  # 1ª ocorrência = caderno azul
            mapa[n] = letra
    return mapa


def eh_duas_colunas(page):
    """Detecta o layout DA PÁGINA: 2 colunas têm um vão central sem palavras.

    O ENEM mistura páginas de coluna única e dupla na mesma prova — assumir
    um layout fixo atribui texto/figura à questão errada.
    """
    palavras = page.extract_words()
    if len(palavras) < 40:
        return False
    centro = page.width / 2
    cruzam = sum(1 for w in palavras if w["x0"] < centro - 6 and w["x1"] > centro + 6)
    return cruzam <= max(3, len(palavras) * 0.01)


def coluna_de(page, x0, x1=None):
    if not eh_duas_colunas(page):
        return 0
    ponto = x0 if x1 is None else (x0 + x1) / 2
    return 0 if ponto < page.width / 2 else 1


def enem_imagens(ano, dia, ini, fim, log=print):
    """Extrai as figuras de cada questão do PDF (recorte por posição).

    Cada imagem pertence à última questão iniciada acima dela na ordem de
    leitura (página → coluna, quando houver → altura). Figuras vetoriais
    (desenhadas, não embutidas) não são capturadas.
    """
    import pdfplumber

    caminho = enem_dir(ano, dia) / "prova.pdf"
    pasta = enem_dir(ano, dia) / "imagens"
    pasta.mkdir(parents=True, exist_ok=True)

    # remove recortes antigos da MESMA faixa (rodada anterior pode ter
    # atribuído a questões erradas; fora da faixa preserva outras áreas)
    for antigo in pasta.glob("q*.png"):
        m = re.match(r"q(\d+)_", antigo.name)
        if m and ini <= int(m.group(1)) <= fim:
            antigo.unlink()

    mapa = {}
    with pdfplumber.open(caminho) as pdf:
        marcadores = []  # (pagina, coluna, top, numero) em ordem de leitura
        for pi, page in enumerate(pdf.pages):
            for m in page.search(r"QUEST[ÃA]O\s+\d{1,3}"):
                numero = int(re.search(r"\d+", m["text"]).group())
                marcadores.append((pi, coluna_de(page, m["x0"]), m["top"], numero))
        marcadores.sort()

        for pi, page in enumerate(pdf.pages):
            for img in page.images:
                if img["x1"] - img["x0"] < 45 or img["bottom"] - img["top"] < 45:
                    continue  # logotipos/ícones
                col = coluna_de(page, img["x0"], img["x1"])
                chave = (pi, col, img["top"])
                donos = [m for m in marcadores if (m[0], m[1], m[2]) <= chave]
                if not donos:
                    continue
                numero = donos[-1][3]
                if not (ini <= numero <= fim):
                    continue
                bbox = (
                    max(0, img["x0"] - 2), max(0, img["top"] - 2),
                    min(page.width, img["x1"] + 2), min(page.height, img["bottom"] + 2),
                )
                arquivo = pasta / f"q{numero}_{len(mapa.get(numero, []))}.png"
                try:
                    page.crop(bbox).to_image(resolution=150).save(arquivo)
                except Exception as erro:  # noqa: BLE001 — imagem ruim não derruba a prova
                    log(f"  aviso: falha ao recortar imagem da Q{numero}: {erro}")
                    continue
                mapa.setdefault(numero, []).append(str(arquivo.relative_to(CACHE)))

    log(f"imagens extraídas: {sum(len(v) for v in mapa.values())} "
        f"(questões com figura: {len(mapa)})")
    return mapa


def enem_paginas_questoes(ano, dia):
    """Mapa questão -> página (1-based) onde ela começa, p/ o PDF ao lado."""
    import pdfplumber

    paginas = {}
    with pdfplumber.open(enem_dir(ano, dia) / "prova.pdf") as pdf:
        for pi, page in enumerate(pdf.pages):
            for m in page.search(r"QUEST[ÃA]O\s+\d{1,3}"):
                numero = int(re.search(r"\d+", m["text"]).group())
                paginas.setdefault(numero, pi + 1)
    return paginas


def enem_blocos_questoes(ano, dia, ini, fim):
    """Divide o texto da prova em blocos por questão (via marcador QUESTÃO N).

    Em página de 2 colunas o texto é lido coluna a coluna (esquerda depois
    direita) — ler a página inteira intercalaria linhas das duas colunas e
    misturaria questões vizinhas.
    """
    import pdfplumber

    caminho = enem_dir(ano, dia) / "prova.pdf"
    texto = ""
    with pdfplumber.open(caminho) as pdf:
        for pagina in pdf.pages:
            if eh_duas_colunas(pagina):
                meio = pagina.width / 2
                esq = pagina.crop((0, 0, meio, pagina.height)).extract_text() or ""
                dir_ = pagina.crop((meio, 0, pagina.width, pagina.height)).extract_text() or ""
                texto += esq + "\n" + dir_ + "\n"
            else:
                texto += (pagina.extract_text() or "") + "\n"

    partes = re.split(r"\bQUEST[ÃA]O\s+(\d{1,3})\b", texto)
    blocos = {}
    for i in range(1, len(partes) - 1, 2):
        n = int(partes[i])
        if ini <= n <= fim and n not in blocos:
            blocos[n] = partes[i + 1].strip()[:6000]
    return blocos


# =========================================================
# Estruturação por IA (OpenAI, chave do .env — NUNCA a quota do app)
# =========================================================

SCHEMA_EXTRACAO = {
    "type": "object",
    "properties": {
        "questoes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "numero": {"type": "integer"},
                    "enunciado": {"type": "string"},
                    "alternativas": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "depende_de_imagem": {"type": "boolean"},
                    "topico": {"type": "string"},
                },
                "required": ["numero", "enunciado", "alternativas", "depende_de_imagem", "topico"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["questoes"],
    "additionalProperties": False,
}

PROMPT_EXTRACAO = """Você recebe blocos de questões extraídos de um PDF de prova oficial (texto corrido, com quebras de linha e hifenização quebradas pela extração).

Para cada questão:
- Reconstrua fielmente o enunciado (incluindo o texto-base/citações que o acompanham), consertando quebras de linha e hifenização. NÃO invente nem resuma conteúdo. O enunciado NUNCA deve conter as alternativas — elas vão exclusivamente no campo alternativas.
- Estruture o enunciado com esta convenção (vale para qualquer prova):
  * Texto-base citado (trecho de obra, poema, notícia, fala) vira linhas iniciadas por "> " (citação).
  * A referência/fonte da citação (AUTOR, obra, site, ano, "adaptado") vai numa linha própria entre asteriscos: *SOUSA, M. Disponível em: ... (adaptado).*
  * Tabelas de dados viram tabelas Markdown: cada linha como | célula | célula |, com a primeira linha de cabeçalho.
  * Separe blocos (texto-base, comando da questão) com uma linha em branco.
- Liste as 5 alternativas (A a E) na ordem, SEM a letra na frente.
- Marque depende_de_imagem=true se a questão só faz sentido com figura, gráfico, charge, mapa ou tabela que não está no texto.
- Em topico, classifique o assunto da questão em 2 a 4 palavras (ex.: "Guerra Fria", "Geografia agrária", "Interpretação de texto").
- Ignore cabeçalhos, rodapés e instruções da prova misturados no texto.

Responda apenas o JSON no schema pedido."""


def chamar_openai(blocos, log=print):
    chave = ler_env("OPENAI_API_KEY")
    modelo = ler_env("OPENAI_MODEL", obrigatoria=False) or "gpt-4o-mini"

    conteudo = "\n\n".join(f"=== QUESTÃO {n} ===\n{t}" for n, t in blocos)
    corpo = {
        "model": modelo,
        "temperature": 0,
        "max_tokens": 16000,
        "messages": [
            {"role": "system", "content": PROMPT_EXTRACAO},
            {"role": "user", "content": conteudo},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "extracao", "strict": False, "schema": SCHEMA_EXTRACAO},
        },
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(corpo).encode(),
        headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        dados = json.loads(resp.read().decode())

    escolha = dados["choices"][0]
    truncada = escolha.get("finish_reason") == "length"
    if not truncada:
        try:
            return json.loads(escolha["message"]["content"])["questoes"]
        except json.JSONDecodeError:
            truncada = True  # JSON cortado no meio = mesmo sintoma

    # Resposta estourou o limite de saída (textos-base longos): divide o
    # lote ao meio e tenta de novo — cada metade gera metade do JSON.
    if len(blocos) == 1:
        raise ValueError(f"resposta da IA truncada até para a questão {blocos[0][0]} sozinha")
    meio = len(blocos) // 2
    log(f"  lote grande demais para a IA — dividindo ({blocos[0][0]}-{blocos[meio-1][0]} e {blocos[meio][0]}-{blocos[-1][0]})")
    return chamar_openai(blocos[:meio], log) + chamar_openai(blocos[meio:], log)


# =========================================================
# Comandos
# =========================================================

def cmd_baixar(args):
    if args.fonte != "enem":
        sys.exit(f"fonte '{args.fonte}' ainda não implementada (só 'enem')")
    enem_baixar(args.ano, args.dia)


def extrair_enem(ano, area, maximo=None, log=print):
    """Núcleo da extração (compartilhado pelo CLI e pelo servidor local)."""
    if area not in ENEM_AREAS:
        raise ValueError(f"área deve ser uma de: {', '.join(ENEM_AREAS)}")

    dia, ini, fim = ENEM_AREAS[area]
    enem_baixar(ano, dia)
    gabarito = enem_gabarito(ano, dia)
    imagens = enem_imagens(ano, dia, ini, fim, log=log)
    paginas = enem_paginas_questoes(ano, dia)
    blocos = enem_blocos_questoes(ano, dia, ini, fim)
    numeros = sorted(blocos)[:maximo] if maximo else sorted(blocos)
    log(f"{len(numeros)} questões localizadas na faixa {ini}-{fim}"
        f" | gabarito com {len(gabarito)} entradas")

    questoes = []
    LOTE = 8
    for i in range(0, len(numeros), LOTE):
        lote = [(n, blocos[n]) for n in numeros[i:i + LOTE]]
        log(f"IA: questões {lote[0][0]}-{lote[-1][0]}...")
        questoes.extend(chamar_openai(lote, log))

    saida = []
    sem_gabarito = 0
    for q in sorted(questoes, key=lambda x: x["numero"]):
        letra = gabarito.get(q["numero"])
        if letra is None or letra == "X":  # X = anulada
            sem_gabarito += 1
            continue
        idx = "ABCDE".index(letra)
        textos = [t.strip() for t in q["alternativas"]]
        textos = remover_letras_alternativas(textos)
        alternativas = [
            {"texto": t, "correta": j == idx} for j, t in enumerate(textos)
        ]
        saida.append({
            "numero": q["numero"],
            "enunciado": q["enunciado"].strip(),
            "alternativas": alternativas,
            "topico": (lambda t: None if t.lower() in ("", "none", "null") else t)(
                (q.get("topico") or "").strip()),
            # questão de imagem só é pré-aprovada se as figuras vieram junto
            "aprovada": len(alternativas) == 5
            and (not q["depende_de_imagem"] or bool(imagens.get(q["numero"]))),
            "depende_de_imagem": q["depende_de_imagem"],
            "imagens": imagens.get(q["numero"], []),
            "imagem_posicao": "depois",
            "pagina": paginas.get(q["numero"]),
        })

    REVISAO.mkdir(exist_ok=True)
    destino = REVISAO / f"enem_{ano}_{area}.json"
    if destino.exists():  # nunca clobberar uma revisão em andamento
        from datetime import datetime

        backup = destino.with_suffix(f".bak-{datetime.now():%Y%m%d%H%M%S}.json")
        destino.rename(backup)
        log(f"aviso: {destino.name} já existia — backup em {backup.name}")

    from datetime import datetime, timezone

    doc = {
        "fonte": "enem",
        "nome": f"ENEM {ano} — {ENEM_NOMES[area]}",
        "ano": ano,
        "area": ENEM_NOMES[area],
        "metadados": {
            "dia": dia,
            "caderno": f"azul (CD{ENEM_CADERNO_AZUL[dia]})",
            "url_prova": ENEM_URL.format(ano=ano, tipo="PV", dia=dia, cd=ENEM_CADERNO_AZUL[dia]),
            "url_gabarito": ENEM_URL.format(ano=ano, tipo="GB", dia=dia, cd=ENEM_CADERNO_AZUL[dia]),
            "extraida_em": datetime.now(timezone.utc).isoformat(),
            "modelo_ia": ler_env("OPENAI_MODEL", obrigatoria=False) or "gpt-4o-mini",
            "gabarito_oficial": True,
        },
        "questoes": saida,
    }
    destino.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    aprovadas = sum(1 for q in saida if q["aprovada"])
    log(f"gerado: {destino.name} — {len(saida)} questões "
        f"({aprovadas} pré-aprovadas, {len(saida) - aprovadas} para revisar, "
        f"{sem_gabarito} descartadas)")
    return destino


def cmd_extrair(args):
    if args.fonte != "enem":
        sys.exit(f"fonte '{args.fonte}' ainda não implementada (só 'enem')")
    try:
        destino = extrair_enem(args.ano, args.area, args.max)
    except ValueError as erro:
        sys.exit(str(erro))
    print("revise o arquivo (edite textos, ajuste 'aprovada') e rode: "
          f"python provas.py publicar {destino.relative_to(BASE_DIR)}")


def remover_letras_alternativas(textos):
    """Remove a letra da alternativa colada no início do texto.

    O glifo de letra circulada do PDF pode virar "A" (simples) ou "AA"
    (glifo + letra), gerando "A Violeta." / "AA Violeta.". Só remove quando
    TODAS as 5 alternativas casam com a própria letra esperada — seguro
    contra textos que começam legitimamente com "E ..." etc.
    """
    if len(textos) != 5:
        return textos
    casamentos = [
        re.match(rf"^{l}{{1,2}}[.)\-–:]?\s+", t) for t, l in zip(textos, "ABCDE")
    ]
    if all(casamentos):
        return [t[m.end():].strip() for t, m in zip(textos, casamentos)]
    return textos


SUPABASE_URL = "https://scafgcpxjsimzaaviean.supabase.co"


def subir_imagens(rels):
    """Sobe imagens do acervo ao bucket público 'provas' (upsert).

    Retorna {caminho_relativo: url_publica}. O upload usa a service key —
    o bucket não tem política de escrita para usuários do app.
    """
    import urllib.error

    service = ler_env("SUPABASE_SERVICE_ROLE_KEY")
    urls = {}
    for rel in rels:
        arquivo = CACHE / rel
        if not arquivo.exists():
            raise ValueError(f"imagem não encontrada no acervo: {rel}")
        req = urllib.request.Request(
            f"{SUPABASE_URL}/storage/v1/object/provas/{rel}",
            data=arquivo.read_bytes(), method="POST",
            headers={"Authorization": f"Bearer {service}", "apikey": service,
                     "Content-Type": "image/png", "x-upsert": "true",
                     "User-Agent": "curl/8.6.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120):
                pass
        except urllib.error.HTTPError as erro:
            raise ValueError(
                f"upload de {rel} falhou: {erro.code} {erro.read().decode()[:150]}"
            ) from erro
        urls[rel] = f"{SUPABASE_URL}/storage/v1/object/public/provas/{rel}"
    return urls


def validar_questao(q):
    if not q.get("enunciado", "").strip():
        return "enunciado vazio"
    alts = q.get("alternativas", [])
    if len(alts) < 2:
        return "menos de 2 alternativas"
    if sum(1 for a in alts if a.get("correta")) != 1:
        return "não tem exatamente 1 correta"
    if any(not a.get("texto", "").strip() for a in alts):
        return "alternativa sem texto"
    return None


def publicar_arquivo(caminho, substituir=False):
    """Valida o JSON revisado e insere no catálogo. Levanta ValueError."""
    import psycopg

    doc = json.loads(Path(caminho).read_text())
    aprovadas = [q for q in doc["questoes"] if q.get("aprovada")]
    if not aprovadas:
        raise ValueError("nenhuma questão com aprovada=true no arquivo")

    invalidas = [(q["numero"], erro) for q in aprovadas if (erro := validar_questao(q))]
    if invalidas:
        detalhe = "; ".join(f"questão {n}: {e}" for n, e in invalidas)
        raise ValueError(f"corrija (ou marque aprovada=false): {detalhe}")

    # sobe as imagens das questões aprovadas ANTES de tocar no banco
    rels = sorted({im for q in aprovadas for im in q.get("imagens", [])})
    urls_imagens = subir_imagens(rels) if rels else {}

    conninfo = POOLER.format(senha=ler_env("SUPABASE_DB_PASSWORD"))
    with psycopg.connect(conninfo) as conn:
        existente = conn.execute(
            "select id from public.catalogo_provas where fonte=%s and nome=%s",
            (doc["fonte"], doc["nome"]),
        ).fetchone()
        if existente:
            if not substituir:
                raise ValueError(f"'{doc['nome']}' já está no catálogo — use substituir para republicar")
            conn.execute("delete from public.catalogo_provas where id=%s", (existente[0],))

        prova_id = conn.execute(
            "insert into public.catalogo_provas (fonte, nome, ano, area, total_questoes, metadados) "
            "values (%s,%s,%s,%s,%s,%s) returning id",
            (doc["fonte"], doc["nome"], doc.get("ano"), doc.get("area"), len(aprovadas),
             json.dumps(doc.get("metadados")) if doc.get("metadados") else None),
        ).fetchone()[0]

        for q in aprovadas:
            meta_q = {"numero_original": q.get("numero")}
            imagens_q = [urls_imagens[im] for im in q.get("imagens", []) if im in urls_imagens]
            posicao = q.get("imagem_posicao") if q.get("imagem_posicao") in ("antes", "depois") else "depois"
            questao_id = conn.execute(
                "insert into public.catalogo_questoes "
                "(prova_id, numero, enunciado, topico, metadados, imagens, imagens_posicao) "
                "values (%s,%s,%s,%s,%s,%s,%s) returning id",
                (prova_id, q.get("numero"), q["enunciado"].strip(),
                 (q.get("topico") or "").strip()[:150] or None, json.dumps(meta_q),
                 json.dumps(imagens_q) if imagens_q else None, posicao),
            ).fetchone()[0]
            for ordem, alt in enumerate(q["alternativas"]):
                conn.execute(
                    "insert into public.catalogo_alternativas "
                    "(questao_id, texto, correta, ordem) values (%s,%s,%s,%s)",
                    (questao_id, alt["texto"].strip(), bool(alt.get("correta")), ordem),
                )

    return {"prova_id": prova_id, "nome": doc["nome"], "questoes": len(aprovadas)}


def cmd_publicar(args):
    try:
        r = publicar_arquivo(args.arquivo, args.substituir)
    except ValueError as erro:
        sys.exit(str(erro))
    print(f"publicada: '{r['nome']}' (id {r['prova_id']}) com {r['questoes']} questões")


def listar_catalogo():
    import psycopg

    conninfo = POOLER.format(senha=ler_env("SUPABASE_DB_PASSWORD"))
    with psycopg.connect(conninfo) as conn:
        provas = conn.execute(
            "select id, fonte, nome, total_questoes, publicada_em::date::text "
            "from public.catalogo_provas order by id"
        ).fetchall()
    return [
        {"id": p[0], "fonte": p[1], "nome": p[2], "total_questoes": p[3], "publicada_em": p[4]}
        for p in provas
    ]


def cmd_listar(_args):
    provas = listar_catalogo()
    if not provas:
        print("catálogo vazio")
    for p in provas:
        print(f"  [{p['id']}] ({p['fonte']}) {p['nome']} — "
              f"{p['total_questoes']} questões — {p['publicada_em']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("baixar", help="baixa prova+gabarito da fonte oficial")
    p.add_argument("fonte")
    p.add_argument("--ano", type=int, required=True)
    p.add_argument("--dia", type=int, default=1)
    p.set_defaults(fn=cmd_baixar)

    p = sub.add_parser("extrair", help="PDF -> JSON de revisão (IA + gabarito)")
    p.add_argument("fonte")
    p.add_argument("--ano", type=int, required=True)
    p.add_argument("--dia", type=int)
    p.add_argument("--area", required=True)
    p.add_argument("--max", type=int, help="limita nº de questões (testes)")
    p.set_defaults(fn=cmd_extrair)

    p = sub.add_parser("publicar", help="JSON revisado -> catálogo no Supabase")
    p.add_argument("arquivo")
    p.add_argument("--substituir", action="store_true")
    p.set_defaults(fn=cmd_publicar)

    p = sub.add_parser("listar", help="lista provas publicadas no catálogo")
    p.set_defaults(fn=cmd_listar)

    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
