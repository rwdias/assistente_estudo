# Disponibilidade das provas da UFPR (verificado 2026-07-11)

A UFPR **não tem API nem fonte padronizada** como o ENEM. As provas foram
reunidas de duas origens e ficam no acervo `cache/ufpr/ps<ano>/prova.pdf`:

- **2022–2026**: NC/UFPR oficial (`servicos.nc.ufpr.br/documentos/...`).
  Caminho varia: `ps<ano>/provas/Geral.pdf` ou `.../definitivo/Geral.pdf`.
- **2011–2021**: compilado público do onestudy (Google Drive). IDs abaixo.

O caderno da UFPR já traz a resposta certa marcada com **►** (o adaptador
lê direto, sem gabarito separado). As alternativas mudam de caixa por ano
(minúsculas até ~2023, MAIÚSCULAS depois) — o parser aceita as duas.

## Cobertura da leitura de respostas (►)

| Anos | Estado |
|---|---|
| 2013–2021, 2023–2026 | **OK** — respostas lidas (≥108/prova) |
| 2022 | parcial |
| 2011–2012 | escaneado (imagem, sem texto) — precisa de OCR |

**Ressalva**: a segmentação por MATÉRIA varia com o layout do ano. Anos
como 2023/2025 segmentam limpo (validado: 2023 História 9/9, 2025 Matem.
5/5); outros (ex.: 2020) trazem as respostas mas os cabeçalhos de matéria
saem diferentes — precisam de ajuste fino do parser ou revisão no editor.

## IDs do Google Drive (onestudy) — 2011–2021

```
2021 1kuQrTrTStTSfhmTsajaKeLop9buIW_W3
2020 1zQ0h1iX9aXZQEEU9UDOD5hzo67k63j21
2019 12fTKwstkZEo2hdzVFEnth2JmAErT2Jrn
2018 13QXxPNpiHajQfdM04_8byGISEguySCqF
2017 18-zFD1iIeOgTbZHUFs7BHPfHxq6gY3hN
2016 1UnR5D3nTl-2uWgqqlpsijQgNkjVJQcEK
2015 1z_nvuw_wdRbJkx4PRlK3embHs9Gn_mja
2014 1XFYnEUYbsj3SufuX0Fd3CZP-BZAqg1Aq
2013 1bTtY0jidVEhvvuUR151gdXqkAIDNvXPR
2012 1CT4dRlP9yHFmBI8mkwhgMGq_2Uvs3b4l
2011 1b1f1diBEEmfePIpasbWWa0XX9U9eoXor
```
Baixar: `curl -sL "https://drive.google.com/uc?export=download&id=<ID>" -o prova.pdf`

## Uso

```bash
python provas.py ufpr --slug ps2023                        # lista matérias
python provas.py ufpr --slug ps2023 --ano 2023 --materia "História"
```
