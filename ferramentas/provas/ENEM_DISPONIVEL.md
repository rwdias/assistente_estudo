# Disponibilidade das provas do ENEM (verificado 2026-07-11)

## Melhor caminho: API enem.dev — 2009 a 2023 (15 anos)

A API pública **api.enem.dev** serve as questões já estruturadas (enunciado
em texto, resposta oficial, alternativas, imagens hospedadas). Sem IA, sem
OCR, sem PDF — precisão oficial. É o método preferido.

```bash
python provas.py enem-api --ano 2015 --area humanas   # uma área
python provas.py enem-api --ano 2015                   # todas as áreas
# áreas: ingles, espanhol, linguagens, humanas, natureza, matematica
```

Como o campo `discipline` da API é ruidoso (mistura reaplicação), buscamos
por **faixa de índice canônica** (estável desde 2009):

| Área | Questões |
|---|---|
| Língua Inglesa / Espanhola | 1–5 (por idioma) |
| Linguagens e Códigos | 6–45 |
| Ciências Humanas | 46–90 |
| Ciências da Natureza | 91–135 |
| Matemática | 136–180 |

Imagens são baixadas para o acervo e sobem ao Storage na publicação. A API
tem rate-limit — o importador já faz pausa + backoff (código em
`enem_api.py`). Validado: gabaritos batem 100% com a extração de PDF
independente (2023 humanas Q46=C, Q50=E...).

## 2024 (e anos ainda fora da API): extrator de PDF

`python provas.py extrair enem --ano 2024 --area <...>` — baixa da INEP
(as duas eras de URL estão em `enem_urls`). Use quando o ano não estiver
na enem.dev.

## Pré-2009 (1998–2008) — pendente

ENEM antigo: prova ÚNICA (~63 questões + redação), sem as 4 áreas nem 2
dias. Não está na enem.dev nem no extrator atual. Precisaria de fonte e
adaptador próprios — esforço à parte.

## Resumo

- **2009–2023: 15 anos prontos** via `enem-api` (imediato, oficial).
- **2024: pronto** via extrator de PDF.
- **1998–2008: pendente** (formato antigo).
