"""ENEM antigo (1998-2008): prova ÚNICA de 63 questões interdisciplinares.

- Prova: INEP `provas/<ano>/<ano>_amarela.pdf` (texto extraível, "(A)-(E)",
  questões numeradas por número em linha própria).
- Gabarito: não existe no INEP; usamos a tabela do Curso Objetivo
  (`ENEM<ano>_gabarito.pdf`), coluna AMARELA — casa com a prova amarela.

Sem áreas (exame interdisciplinar): cada ano vira UMA prova no catálogo.
"""
import json
import re
import subprocess
from datetime import datetime, timezone

import provas
from concurso import blocos_por_numero  # segmentação por número (reutilizada)

INEP_PROVA = "https://download.inep.gov.br/educacao_basica/enem/provas/{ano}/{ano}_amarela.pdf"
OBJETIVO_GAB = "https://www.curso-objetivo.br/vestibular/resolucao-comentada/enem/{ano}/ENEM{ano}_gabarito.pdf"
TOTAL = 63


def antigo_dir(ano):
    return provas.CACHE / "enem-antigo" / str(ano)


def baixar(ano, log=print):
    pasta = antigo_dir(ano)
    pasta.mkdir(parents=True, exist_ok=True)
    prova = pasta / "prova.pdf"
    gab = pasta / "gabarito.pdf"
    if not prova.exists():
        log(f"baixando prova {ano} (INEP)")
        subprocess.run(["curl", "-sf", "-A", "Mozilla/5.0", "-o", str(prova),
                        INEP_PROVA.format(ano=ano)], check=True)
    if not gab.exists():
        log(f"baixando gabarito {ano} (Curso Objetivo)")
        subprocess.run(["curl", "-sf", "-A", "Mozilla/5.0", "-o", str(gab),
                        OBJETIVO_GAB.format(ano=ano)], check=True)
    return prova, gab


def gabarito_amarela(caminho):
    """Coluna AMARELA da tabela 'Q<n> AMARELA BRANCA ROSA VERDE'."""
    import pdfplumber

    with pdfplumber.open(caminho) as pdf:
        texto = "\n".join((p.extract_text() or "") for p in pdf.pages)
    gab = {}
    for m in re.finditer(r"Q?(\d{1,2})\s+([A-E])\s+[A-E]\s+[A-E]\s+[A-E]", texto):
        gab[int(m.group(1))] = m.group(2)
    return gab


def extrair(ano, maximo=None, log=print):
    prova, gab_pdf = baixar(ano, log=log)
    gab = gabarito_amarela(gab_pdf)
    if len(gab) < 50:
        raise ValueError(f"gabarito {ano} incompleto ({len(gab)} respostas) — conferir a tabela")

    fim = min(TOTAL, maximo) if maximo else TOTAL
    blocos = blocos_por_numero(prova, 1, fim, log=log)
    numeros = [n for n in range(1, fim + 1) if n in blocos]
    log(f"{len(numeros)} blocos localizados (gabarito com {len(gab)} respostas)")

    lista = [(n, blocos[n]) for n in numeros]
    questoes = []
    LOTE = 8
    for i in range(0, len(lista), LOTE):
        lote = lista[i:i + LOTE]
        log(f"IA: questões {lote[0][0]}-{lote[-1][0]}...")
        questoes.extend(provas.chamar_openai(lote, log))

    saida, sem_gab = [], 0
    for q in sorted(questoes, key=lambda x: x["numero"]):
        letra = gab.get(q["numero"])
        if not letra:
            sem_gab += 1
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
    destino = provas.REVISAO / f"enem_{ano}_prova.json"
    if destino.exists():
        destino.rename(destino.with_suffix(f".bak-{datetime.now():%Y%m%d%H%M%S}.json"))

    doc = {
        "fonte": "enem",
        "nome": f"ENEM {ano} — Prova",
        "ano": ano,
        "area": "Interdisciplinar",
        "categoria": "vestibular",
        "nivel": "medio",
        "metadados": {
            "formato": "antigo (63 questões interdisciplinares)",
            "gabarito_fonte": "curso-objetivo (coluna amarela)",
            "extraida_em": datetime.now(timezone.utc).isoformat(),
        },
        "questoes": saida,
    }
    destino.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    aprovadas = sum(1 for q in saida if q["aprovada"])
    log(f"gerado: {destino.name} — {len(saida)} questões ({aprovadas} pré-aprovadas, {sem_gab} sem gabarito)")
    return destino
