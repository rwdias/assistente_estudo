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

ENEM_URL = "https://download.inep.gov.br/enem/provas_e_gabaritos/{ano}_{tipo}_impresso_D{dia}_CD1.pdf"
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


def enem_baixar(ano, dia):
    # curl em vez de urllib: o download.inep.gov.br entrega a cadeia TLS
    # incompleta e o urllib rejeita; o curl do macOS resolve sozinho.
    import subprocess

    CACHE.mkdir(exist_ok=True)
    arquivos = {}
    for tipo, rotulo in (("PV", "prova"), ("GB", "gabarito")):
        destino = CACHE / f"enem_{ano}_d{dia}_{rotulo}.pdf"
        if not destino.exists():
            url = ENEM_URL.format(ano=ano, tipo=tipo, dia=dia)
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

    caminho = CACHE / f"enem_{ano}_d{dia}_gabarito.pdf"
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


def enem_blocos_questoes(ano, dia, ini, fim):
    """Divide o texto da prova em blocos por questão (via marcador QUESTÃO N)."""
    import pdfplumber

    caminho = CACHE / f"enem_{ano}_d{dia}_prova.pdf"
    texto = ""
    with pdfplumber.open(caminho) as pdf:
        for pagina in pdf.pages:
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
                },
                "required": ["numero", "enunciado", "alternativas", "depende_de_imagem"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["questoes"],
    "additionalProperties": False,
}

PROMPT_EXTRACAO = """Você recebe blocos de questões extraídos de um PDF de prova oficial (texto corrido, com quebras de linha e hifenização quebradas pela extração).

Para cada questão:
- Reconstrua fielmente o enunciado (incluindo o texto-base/citações que o acompanham), consertando quebras de linha e hifenização. NÃO invente nem resuma conteúdo.
- Liste as 5 alternativas (A a E) na ordem, SEM a letra na frente.
- Marque depende_de_imagem=true se a questão só faz sentido com figura, gráfico, charge, mapa ou tabela que não está no texto.
- Ignore cabeçalhos, rodapés e instruções da prova misturados no texto.

Responda apenas o JSON no schema pedido."""


def chamar_openai(blocos):
    chave = ler_env("OPENAI_API_KEY")
    modelo = ler_env("OPENAI_MODEL", obrigatoria=False) or "gpt-4o-mini"

    conteudo = "\n\n".join(f"=== QUESTÃO {n} ===\n{t}" for n, t in blocos)
    corpo = {
        "model": modelo,
        "temperature": 0,
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
    return json.loads(dados["choices"][0]["message"]["content"])["questoes"]


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
    blocos = enem_blocos_questoes(ano, dia, ini, fim)
    numeros = sorted(blocos)[:maximo] if maximo else sorted(blocos)
    log(f"{len(numeros)} questões localizadas na faixa {ini}-{fim}"
        f" | gabarito com {len(gabarito)} entradas")

    questoes = []
    LOTE = 8
    for i in range(0, len(numeros), LOTE):
        lote = [(n, blocos[n]) for n in numeros[i:i + LOTE]]
        log(f"IA: questões {lote[0][0]}-{lote[-1][0]}...")
        questoes.extend(chamar_openai(lote))

    saida = []
    sem_gabarito = 0
    for q in sorted(questoes, key=lambda x: x["numero"]):
        letra = gabarito.get(q["numero"])
        if letra is None or letra == "X":  # X = anulada
            sem_gabarito += 1
            continue
        idx = "ABCDE".index(letra)
        alternativas = [
            {"texto": t.strip(), "correta": j == idx}
            for j, t in enumerate(q["alternativas"])
        ]
        saida.append({
            "numero": q["numero"],
            "enunciado": q["enunciado"].strip(),
            "alternativas": alternativas,
            "topico": None,
            "aprovada": not q["depende_de_imagem"] and len(alternativas) == 5,
            "depende_de_imagem": q["depende_de_imagem"],
        })

    REVISAO.mkdir(exist_ok=True)
    destino = REVISAO / f"enem_{ano}_{area}.json"
    doc = {
        "fonte": "enem",
        "nome": f"ENEM {ano} — {ENEM_NOMES[area]}",
        "ano": ano,
        "area": ENEM_NOMES[area],
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
            "insert into public.catalogo_provas (fonte, nome, ano, area, total_questoes) "
            "values (%s,%s,%s,%s,%s) returning id",
            (doc["fonte"], doc["nome"], doc.get("ano"), doc.get("area"), len(aprovadas)),
        ).fetchone()[0]

        for q in aprovadas:
            questao_id = conn.execute(
                "insert into public.catalogo_questoes (prova_id, numero, enunciado, topico) "
                "values (%s,%s,%s,%s) returning id",
                (prova_id, q.get("numero"), q["enunciado"].strip(), q.get("topico")),
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
