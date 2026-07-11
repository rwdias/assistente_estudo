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

## Pré-2009 (1998–2008): comando `enem-antigo`

ENEM antigo: prova ÚNICA de 63 questões interdisciplinares (sem áreas).

```bash
python provas.py enem-antigo --ano 2000   # uma prova por ano
```

- Prova: INEP `provas/<ano>/<ano>_amarela.pdf` (baixa sozinho).
- Gabarito: tabela do **Curso Objetivo** (`ENEM<ano>_gabarito.pdf`), coluna
  AMARELA — casa com a prova amarela. Validado: 2000 Q1-10 = 10/10.
- Cada ano vira UMA prova (`area = "Interdisciplinar"`). Muitas questões
  são charges/gráficos (revisar no editor; imagem entra manualmente).
- Código em `enem_antigo.py`.

## Resumo — cobertura COMPLETA 1998–2024

| Anos | Comando | Método |
|---|---|---|
| 1998–2008 | `enem-antigo --ano N` | prova INEP + gabarito Objetivo |
| 2009–2023 | `enem-api --ano N [--area X]` | API enem.dev (sem IA, oficial) |
| 2024+ | `extrair enem --ano N --area X` | PDF INEP (IA + gabarito) |

Todas as 27 edições do ENEM (1998–2024) são extraíveis.
