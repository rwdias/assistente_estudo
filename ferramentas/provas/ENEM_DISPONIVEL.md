# Disponibilidade das provas do ENEM (verificado 2026-07-11)

Fonte oficial: `download.inep.gov.br`. O INEP hospeda o ENEM em eras de URL
diferentes; o adaptador (`enem_urls` em `provas.py`) já resolve as duas
modernas. Caderno **azul**: CD1 (dia 1) e CD7 (dia 2).

## Pronto para extrair agora — 2018 a 2024 (7 anos)

Prova **e** gabarito oficiais confirmados, dias 1 e 2:

| Anos | Prova | Gabarito |
|---|---|---|
| 2020–2024 | `enem/provas_e_gabaritos/{ano}_PV_impresso_D{dia}_CD{cd}.pdf` | `..._GB_impresso_...` |
| 2018–2019 | `educacao_basica/enem/provas/{ano}/{ano}_PV_impresso_D{dia}_CD{cd}.pdf` | `educacao_basica/enem/gabaritos/{ano}/...` (nome varia; resolvido por candidatas) |

Basta `python provas.py extrair enem --ano <2018..2024> --area <...>`
(baixa sozinho). Áreas: ingles, espanhol, linguagens, humanas, natureza,
matematica.

## Prova disponível, gabarito a resolver — 2014 a 2017

As provas existem em `educacao_basica/enem/provas/{ano}/{ano}_PV_impresso_D{dia}_CD{cd}.pdf`,
mas o gabarito de cada ano usa um nome próprio ainda não mapeado. Quando
for extrair esses anos, descobrir a URL do gabarito (buscar no INEP) e
acrescentar à lista `gabs` em `enem_urls`. **Atenção**: até 2016 o ENEM
tinha os dias INVERTIDOS (dia 1 = Humanas+Natureza, dia 2 =
Linguagens+Matemática) — o mapa `ENEM_AREAS` vale para 2017+; anos
anteriores exigem ajustar dia↔área.

## Ainda não mapeado — 2009 a 2013

Não estão nos caminhos acima. Provavelmente em outra estrutura de URL do
INEP; exigem nova investigação. Mesma ressalva de dias invertidos.

## Formato antigo — 1998 a 2008

ENEM pré-reforma: prova ÚNICA (~63 questões + redação), sem as 4 áreas nem
a divisão em 2 dias. Precisa de um adaptador próprio (numeração e
segmentação diferentes) — não é coberto pelo extrator atual.

## Resumo

- **12 edições com prova baixável** (2014–2024 aqui + 2019 confirmado E2E).
- **7 prontas de imediato** (2018–2024): prova + gabarito automáticos.
- Pré-2014: esforço adicional (gabarito 2014–2017; URLs 2009–2013; formato
  antigo 1998–2008).
