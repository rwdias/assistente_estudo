"""Adaptador do vestibular da UFPR (NC/UFPR) para a curadoria.

Peculiaridades desta banca (validadas contra o PS2023):
- A prova (caderno "Geral") JÁ traz a resposta certa marcada com "►" antes
  da alternativa — não há gabarito separado.
- Questões numeradas "N - " no início da linha; matérias em CAIXA ALTA.
- As questões de língua estrangeira (83-90) se repetem por idioma
  (Alemão, Espanhol, Inglês...), como o ENEM — escolhidas por ocorrência.

Curador baixa o caderno em cache/ufpr/<slug>/prova.pdf e roda por matéria.
"""
import json
import re
from datetime import datetime, timezone

import provas

# caixa-alta que NÃO é matéria (cabeçalhos/rodapés do caderno)
NAO_MATERIA = {"INSCRIÇÃO TURMA NOME DO CANDIDATO", "ORDEM", "INSTRUÇÕES",
               "RESPOSTAS", "RESPOS", "STAS", "PROCESSO SELETIVO", "GABARITO",
               "RASCUNHO", "RASCUN", "ONLINE DE ESTUDOS", "ASSINATURA DO CANDIDATO",
               "ESCLARECIMENTO", "PLATAFORMA"}
LINGUAS = {"ALEMÃO", "ESPANHOL", "FRANCÊS", "INGLÊS", "ITALIANO", "JAPONÊS", "POLONÊS"}


def ufpr_dir(slug):
    return provas.CACHE / "ufpr" / slug


def _linhas(pdf_path):
    import pdfplumber

    linhas = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            if provas.eh_duas_colunas(page):
                meio = page.width / 2
                linhas += (page.crop((0, 0, meio, page.height)).extract_text() or "").splitlines()
                linhas += (page.crop((meio, 0, page.width, page.height)).extract_text() or "").splitlines()
            else:
                linhas += (page.extract_text() or "").splitlines()
    return linhas


def _eh_cabecalho(s):
    return (len(s) >= 4 and len(s) < 40 and s == s.upper()
            and bool(re.match(r"^[A-ZÀ-Ú ]+$", s)) and s not in NAO_MATERIA)


def mapear(pdf_path):
    """Retorna (blocos, respostas, materias).

    blocos[(materia, ocorr, num)] = texto; respostas[...] = letra oficial (►);
    materias = lista ordenada [(materia, ocorrencia, ini, fim)].
    Ocorrência distingue as versões de idioma que reusam 83-90.
    """
    linhas = _linhas(pdf_path)
    blocos, respostas = {}, {}
    materias = []              # [materia, ocorr, ini, fim]
    vistos_materia = {}        # materia -> quantas vezes já apareceu
    materia_atual = ocorr_atual = None
    chave_atual = None
    buffer = []

    def fechar():
        if chave_atual is not None:
            blocos[chave_atual] = "\n".join(buffer).strip()

    for l in linhas:
        s = l.strip()
        if _eh_cabecalho(s):
            fechar(); buffer = []; chave_atual = None
            materia_atual = s
            ocorr_atual = vistos_materia.get(s, 0)
            vistos_materia[s] = ocorr_atual + 1
            materias.append([s, ocorr_atual, None, None])
            continue
        mq = re.match(r"^(\d{1,2})\s*[-–]\s", s)
        if mq and materia_atual:
            fechar()
            num = int(mq.group(1))
            chave_atual = (materia_atual, ocorr_atual, num)
            buffer = [re.sub(r"^\d{1,2}\s*[-–]\s", "", s)]
            m = materias[-1]
            if m[2] is None:
                m[2] = num
            m[3] = num
            continue
        if chave_atual is not None:
            # resposta marcada com ► — alternativas em minúsculas (2023) ou
            # maiúsculas (2025/2026); o ► pode vir colado ou com espaço
            mr = re.match(r"^►\s*([a-eA-E])\)", s)
            if mr:
                respostas[chave_atual] = mr.group(1).upper()
            buffer.append(s)
    fechar()

    materias = [tuple(m) for m in materias if m[2] is not None]
    return blocos, respostas, materias


def listar_materias(slug):
    _, _, materias = mapear(ufpr_dir(slug) / "prova.pdf")
    # agrupa idiomas repetidos mostrando a ocorrência
    return materias


def extrair_materia(ano, materia, slug, ocorrencia=0, maximo=None, log=print):
    pasta = ufpr_dir(slug)
    if not (pasta / "prova.pdf").exists():
        raise ValueError(f"coloque o caderno em {pasta}/prova.pdf")

    blocos, respostas, materias = mapear(pasta / "prova.pdf")
    alvo = next((m for m in materias
                 if provas.chave_topico(m[0]) == provas.chave_topico(materia)
                 and m[1] == ocorrencia), None)
    if not alvo:
        disp = ", ".join(f"{m[0]}" + (f" (ocorr {m[1]})" if m[1] else "") for m in materias)
        raise ValueError(f"matéria '{materia}' (ocorrência {ocorrencia}) não encontrada. Disponíveis: {disp}")
    nome_materia, ocorr, ini, fim = alvo

    numeros = [n for n in range(ini, fim + 1) if (nome_materia, ocorr, n) in blocos]
    if maximo:
        numeros = numeros[:maximo]
    log(f"{nome_materia}: questões {ini}-{fim} | {len(numeros)} blocos")

    lista = [(n, blocos[(nome_materia, ocorr, n)]) for n in numeros]
    questoes = []
    LOTE = 8
    for i in range(0, len(lista), LOTE):
        lote = lista[i:i + LOTE]
        log(f"IA: questões {lote[0][0]}-{lote[-1][0]}...")
        questoes.extend(provas.chamar_openai(lote, log))

    saida = []
    sem_resp = 0
    for q in sorted(questoes, key=lambda x: x["numero"]):
        letra = respostas.get((nome_materia, ocorr, q["numero"]))
        if not letra:
            sem_resp += 1
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
    slug_mat = re.sub(r"[^a-z0-9]+", "-", provas.chave_topico(nome_materia)).strip("-")
    destino = provas.REVISAO / f"ufpr_{slug}_{slug_mat}.json"
    if destino.exists():
        destino.rename(destino.with_suffix(f".bak-{datetime.now():%Y%m%d%H%M%S}.json"))

    doc = {
        "fonte": "ufpr",
        "nome": f"UFPR {ano} — {nome_materia.title()}",
        "ano": ano,
        "area": nome_materia.title(),
        "categoria": "vestibular",
        "nivel": "medio",
        "metadados": {
            "extraida_em": datetime.now(timezone.utc).isoformat(),
            "modelo_ia": provas.ler_env("OPENAI_MODEL", obrigatoria=False) or "gpt-4o-mini",
            "gabarito_oficial": True,  # resposta ► impressa no próprio caderno
        },
        "questoes": saida,
    }
    destino.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    aprovadas = sum(1 for q in saida if q["aprovada"])
    log(f"gerado: {destino.name} — {len(saida)} questões ({aprovadas} pré-aprovadas, {sem_resp} sem resposta)")
    return destino
