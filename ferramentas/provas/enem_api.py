"""Importa provas do ENEM da API pública enem.dev (2009-2023).

Muito melhor que extrair PDF: o enunciado já vem estruturado (Markdown),
com a resposta oficial (`correctAlternative`), alternativas e imagens
hospedadas. Zero IA, zero OCR, precisão oficial. Gera o mesmo JSON de
revisão do resto da ferramenta; imagens são baixadas para o acervo e
sobem ao Storage na publicação.

Anos 2009-2023. Para 2024+ use o extrator de PDF (`extrair enem`).
"""
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import provas

API = "https://api.enem.dev/v1"
PAUSA = 0.4  # respeita o rate-limit da API

# área (nossa) -> (nome exibido, ini, fim, language da API)
# O campo `discipline` da API é ruidoso (mistura reaplicação); as FAIXAS de
# índice são canônicas e estáveis desde 2009 — buscamos por elas.
AREAS = {
    "ingles": ("Língua Inglesa", 1, 5, "ingles"),
    "espanhol": ("Língua Espanhola", 1, 5, "espanhol"),
    "linguagens": ("Linguagens e Códigos", 6, 45, None),
    "humanas": ("Ciências Humanas", 46, 90, None),
    "natureza": ("Ciências da Natureza", 91, 135, None),
    "matematica": ("Matemática", 136, 180, None),
}


def _get(caminho, tentativa=0):
    req = urllib.request.Request(f"{API}{caminho}", headers={"User-Agent": "Mozilla/5.0"})
    try:
        time.sleep(PAUSA)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as erro:
        if erro.code == 429 and tentativa < 5:  # backoff no rate-limit
            time.sleep(2 ** tentativa)
            return _get(caminho, tentativa + 1)
        raise


def anos_disponiveis():
    return sorted(e["year"] for e in _get("/exams"))


def _questao(ano, indice, lang=None):
    sufixo = f"?language={lang}" if lang else ""
    return _get(f"/exams/{ano}/questions/{indice}{sufixo}")


def _limpar_contexto(texto, imagens_ctx):
    """Converte o Markdown da API para a nossa convenção.

    - imagens ![](url) saem do texto e vão para a lista de imagens;
    - **negrito** é removido (enunciado não é negrito);
    - linha de fonte ('Disponível em'/'Acesso em') vira *itálico*.
    """
    if not texto:
        return ""
    def _img(m):
        url = m.group(1).strip()
        if url and "broken-image" not in url:
            imagens_ctx.append(url)
        return ""
    texto = re.sub(r"!\[[^\]]*\]\(([^)]*)\)", _img, texto)
    texto = texto.replace("**", "")
    linhas = []
    for l in texto.split("\n"):
        s = l.rstrip()
        if re.search(r"Dispon[íi]vel em|Acesso em", s) and not s.startswith("*"):
            s = f"*{s.strip()}*"
        linhas.append(s)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(linhas)).strip()


def _baixar_imagens(urls, ano, indice):
    import subprocess

    pasta = provas.CACHE / "enem" / str(ano) / "api-imagens"
    pasta.mkdir(parents=True, exist_ok=True)
    rels = []
    for i, url in enumerate(urls):
        ext = ".png" if ".png" in url.lower() else (".jpg" if ".jp" in url.lower() else ".png")
        destino = pasta / f"q{indice}_{i}{ext}"
        if not destino.exists():
            r = subprocess.run(["curl", "-sf", "-A", "Mozilla/5.0", "-o", str(destino), url])
            if r.returncode != 0 or not destino.exists() or destino.stat().st_size < 200:
                continue
        rels.append(str(destino.relative_to(provas.CACHE)))
    return rels


def importar(ano, area, maximo=None, log=print):
    if area not in AREAS:
        raise ValueError(f"área deve ser uma de: {', '.join(AREAS)}")
    nome_area, ini, fim, lang = AREAS[area]
    if maximo:
        fim = min(fim, ini + maximo - 1)

    log(f"consultando enem.dev — ENEM {ano} / {nome_area} (questões {ini}-{fim})...")
    filtradas = []
    for i in range(ini, fim + 1):
        try:
            filtradas.append(_questao(ano, i, lang))
        except Exception as erro:  # noqa: BLE001 — questão ausente não derruba
            log(f"  aviso: questão {i} indisponível ({erro})")
    log(f"{len(filtradas)} questões de {nome_area}")

    saida = []
    for q in filtradas:
        imagens_ctx = []
        contexto = _limpar_contexto(q.get("context") or "", imagens_ctx)
        comando = (q.get("alternativesIntroduction") or "").strip()
        enunciado = (contexto + "\n\n" + comando).strip() if comando else contexto

        letra = q.get("correctAlternative")
        alternativas = []
        for a in q.get("alternatives", []):
            texto = (a.get("text") or "").strip()
            if a.get("file"):
                imagens_ctx.append(a["file"])
                texto = texto or f"(ver imagem — alternativa {a.get('letter')})"
            alternativas.append({"texto": texto, "correta": bool(a.get("isCorrect"))})

        urls = (q.get("files") or []) + imagens_ctx
        urls = [u for u in dict.fromkeys(urls) if u and "broken-image" not in u]
        rels = _baixar_imagens(urls, ano, q["index"])

        valido = (letra in "ABCDE" and len(alternativas) == 5
                  and sum(a["correta"] for a in alternativas) == 1
                  and all(a["texto"] for a in alternativas))
        saida.append({
            "numero": q["index"],
            "enunciado": enunciado,
            "gabarito_oficial": letra,
            "alternativas": alternativas,
            "topico": None,
            "aprovada": bool(valido),
            "depende_de_imagem": False,
            "imagens": rels,
            "imagem_posicao": "depois",
            "pagina": None,
        })

    provas.REVISAO.mkdir(exist_ok=True)
    destino = provas.REVISAO / f"enem_{ano}_{area}.json"
    if destino.exists():
        destino.rename(destino.with_suffix(f".bak-{datetime.now():%Y%m%d%H%M%S}.json"))

    doc = {
        "fonte": "enem",
        "nome": f"ENEM {ano} — {nome_area}",
        "ano": ano,
        "area": nome_area,
        "categoria": "vestibular",
        "nivel": "medio",
        "metadados": {
            "origem": "api.enem.dev",
            "importada_em": datetime.now(timezone.utc).isoformat(),
            "gabarito_oficial": True,
        },
        "questoes": saida,
    }
    destino.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    aprovadas = sum(1 for q in saida if q["aprovada"])
    log(f"gerado: {destino.name} — {len(saida)} questões ({aprovadas} pré-aprovadas)")
    return destino
