"""Adaptador de provas de CONCURSO (bancas) para a ferramenta de curadoria.

Diferente do ENEM (URLs oficiais previsíveis), concurso não tem download
automático: o curador baixa o caderno + gabarito e os coloca em
  cache/<banca>/<slug>/prova.pdf  e  gabarito.pdf
Depois roda a extração por MATÉRIA do edital (faixa vinda do gabarito).

Implementado para o layout CESGRANRIO (número da questão em linha própria,
alternativas "(A)-(E)", cabeçalhos de matéria inline). Outras bancas entram
como novas funções de gabarito/segmentação reutilizando o mesmo miolo.
"""
import json
import re
from datetime import datetime, timezone

import provas  # núcleo compartilhado (colunas, IA, publicação, canônicos)

BANCAS = {"cesgranrio"}


def concurso_dir(banca, slug):
    return provas.CACHE / banca / slug


# =========================================================
# Gabarito CESGRANRIO: respostas + faixas de matéria do edital
# =========================================================

def gabarito_cesgranrio(caminho):
    """Retorna ({numero: letra}, [(materia, ini, fim)]) da 1ª prova (A)."""
    import pdfplumber

    with pdfplumber.open(caminho) as pdf:
        texto = "\n".join((p.extract_text() or "") for p in pdf.pages)

    PAR = re.compile(r"(\d{1,3})\s*[-–]\s*([A-E])\b")
    IGNORAR = {"BANCO DO BRASIL", "GABARITO", "CONHECIMENTOS BÁSICOS",
               "CONHECIMENTOS ESPECÍFICOS"}
    gab = {}
    materias = []  # [nome, ini, fim] em ordem
    atual = None

    def eh_linha_de_gabarito(linha, pares):
        # aceita só se, removidos os pares, sobra quase nada (evita casar
        # "EDITAL No 01 – 2022/001" como um par solto)
        resto = re.sub(r"[\s\-–]", "", PAR.sub("", linha))
        return bool(pares) and len(resto) <= 2

    for linha in texto.splitlines():
        l = linha.strip()
        pares = PAR.findall(l)
        if eh_linha_de_gabarito(l, pares):
            for n, letra in pares:
                n = int(n)
                if n in gab:  # começou a Prova B/2ª volta -> encerra
                    materias[:] = [[m[0], m[1], m[2]] for m in materias if m[1] is not None]
                    return gab, [tuple(m) for m in materias]
                gab[n] = letra
                if atual is not None:
                    if materias[atual][1] is None:
                        materias[atual][1] = n
                    materias[atual][2] = n
            continue
        eh_cabecalho = (len(l) >= 5 and l == l.upper()
                        and re.match(r"^[A-ZÀ-Ú][A-ZÀ-Ú \-–/]+$", l)
                        and l not in IGNORAR)
        if eh_cabecalho:
            materias.append([l, None, None])
            atual = len(materias) - 1

    return gab, [tuple(m) for m in materias if m[1] is not None]


# =========================================================
# Segmentação do caderno: bloco de texto por número de questão
# =========================================================

def blocos_por_numero(pdf_path, ini, fim, log=print):
    """Divide o caderno em {numero: texto} usando o número em linha própria.

    Lê cada página por coluna (quando houver) e ancora na sequência esperada
    ini..fim: uma linha que é só o próximo número esperado abre a questão.
    """
    import pdfplumber

    linhas = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            if provas.eh_duas_colunas(page):
                meio = page.width / 2
                partes = [
                    page.crop((0, 0, meio, page.height)).extract_text() or "",
                    page.crop((meio, 0, page.width, page.height)).extract_text() or "",
                ]
            else:
                partes = [page.extract_text() or ""]
            for parte in partes:
                linhas.extend(parte.splitlines())

    blocos = {}
    esperado = ini
    atual = None
    buffer = []
    for linha in linhas:
        l = linha.strip()
        if l == str(esperado):  # abre a questão esperada
            if atual is not None:
                blocos[atual] = "\n".join(buffer).strip()
            atual = esperado
            buffer = []
            esperado += 1
            if esperado > fim:
                # ainda captura o corpo da última questão até o próximo número
                continue
        elif atual is not None:
            buffer.append(l)
    if atual is not None:
        # corta lixo de rodapé após as alternativas da última questão
        blocos[atual] = "\n".join(buffer).strip()

    return blocos


# =========================================================
# Extração de uma matéria
# =========================================================

def listar_materias(banca, slug):
    caminho = concurso_dir(banca, slug) / "gabarito.pdf"
    _, materias = gabarito_cesgranrio(caminho)
    return materias


def extrair_materia(banca, orgao, ano, cargo, nivel, materia, slug, maximo=None, log=print):
    pasta = concurso_dir(banca, slug)
    if not (pasta / "prova.pdf").exists() or not (pasta / "gabarito.pdf").exists():
        raise ValueError(f"coloque prova.pdf e gabarito.pdf em {pasta}")

    gab, materias = gabarito_cesgranrio(pasta / "gabarito.pdf")
    alvo = next((m for m in materias if provas.chave_topico(m[0]) == provas.chave_topico(materia)), None)
    if not alvo:
        disponiveis = ", ".join(m[0] for m in materias)
        raise ValueError(f"matéria '{materia}' não encontrada. Disponíveis: {disponiveis}")
    nome_materia, ini, fim = alvo
    if maximo:
        fim = min(fim, ini + maximo - 1)

    blocos = blocos_por_numero(pasta / "prova.pdf", ini, fim, log=log)
    numeros = [n for n in range(ini, fim + 1) if n in blocos]
    log(f"{nome_materia}: questões {ini}-{fim} | {len(numeros)} blocos localizados")

    questoes = []
    LOTE = 8
    for i in range(0, len(numeros), LOTE):
        lote = [(n, blocos[n]) for n in numeros[i:i + LOTE]]
        log(f"IA: questões {lote[0][0]}-{lote[-1][0]}...")
        questoes.extend(provas.chamar_openai(lote, log))

    saida = []
    sem_gabarito = 0
    for q in sorted(questoes, key=lambda x: x["numero"]):
        letra = gab.get(q["numero"])
        if letra is None or letra == "X":
            sem_gabarito += 1
            continue
        idx = "ABCDE".index(letra)
        textos = provas.remover_letras_alternativas([t.strip() for t in q["alternativas"]])
        alternativas = [{"texto": t, "correta": j == idx} for j, t in enumerate(textos)]
        saida.append({
            "numero": q["numero"],
            "enunciado": q["enunciado"].strip(),
            "gabarito_oficial": letra,
            "alternativas": alternativas,
            "topico": (q.get("topico") or "").strip() or None,
            "aprovada": len(alternativas) == 5 and not q.get("depende_de_imagem"),
            "depende_de_imagem": bool(q.get("depende_de_imagem")),
            "imagens": [],
            "imagem_posicao": "depois",
            "pagina": None,
        })

    provas.REVISAO.mkdir(exist_ok=True)
    slug_materia = re.sub(r"[^a-z0-9]+", "-", provas.chave_topico(nome_materia)).strip("-")
    destino = provas.REVISAO / f"{banca}_{slug}_{slug_materia}.json"
    if destino.exists():
        backup = destino.with_suffix(f".bak-{datetime.now():%Y%m%d%H%M%S}.json")
        destino.rename(backup)
        log(f"aviso: {destino.name} já existia — backup em {backup.name}")

    nome = f"{orgao} {ano} — {cargo} — {nome_materia.title()}"
    doc = {
        "fonte": banca,
        "nome": nome,
        "ano": ano,
        "area": nome_materia.title(),
        "categoria": "concurso",
        "nivel": nivel,
        "orgao": orgao,
        "cargo": cargo,
        "metadados": {
            "banca": banca,
            "extraida_em": datetime.now(timezone.utc).isoformat(),
            "modelo_ia": provas.ler_env("OPENAI_MODEL", obrigatoria=False) or "gpt-4o-mini",
            "gabarito_oficial": True,
        },
        "questoes": saida,
    }
    destino.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    aprovadas = sum(1 for q in saida if q["aprovada"])
    log(f"gerado: {destino.name} — {len(saida)} questões "
        f"({aprovadas} pré-aprovadas, {sem_gabarito} descartadas)")
    return destino
