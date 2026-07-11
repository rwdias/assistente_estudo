# Ferramenta de curadoria de provas

Alimenta o **Banco de provas** do Study Rats (catálogo público no Supabase)
a partir de fontes oficiais. Roda fora do app, na máquina do curador, com
as credenciais do `.env` da raiz — os usuários do app só leem o catálogo
e importam provas para a própria conta (sem gastar quota de IA).

## Interface web local (recomendado)

```bash
../../venv/bin/python curadoria.py    # abre http://127.0.0.1:8777 no navegador
```

Tudo pela tela: **1·Extrair** (fonte/ano/área, log ao vivo) → **2·Revisar**
(editor visual: enunciado, alternativas, correta por rádio, aprovada por
checkbox) → **Publicar** (checkbox "substituir" para republicar) → o
catálogo publicado aparece embaixo. Só escuta em 127.0.0.1 — não expor,
usa as credenciais do `.env`.

## Fluxo (CLI, mesmo núcleo)

```
baixar  ->  extrair  ->  revisar o JSON no editor  ->  publicar
(PDF oficial)  (IA + gabarito)     (aprovada: true/false)    (catálogo)
```

```bash
venv=../../venv/bin/python

$venv provas.py baixar   enem --ano 2023 --dia 1
$venv provas.py extrair  enem --ano 2023 --area humanas   # ou: linguagens, natureza, matematica
# revise revisao/enem_2023_humanas.json (textos, alternativas, campo "aprovada")
$venv provas.py publicar revisao/enem_2023_humanas.json   # --substituir para republicar
$venv provas.py listar
```

## Acervo local (fora do git, sem downloads repetidos)

```
cache/                      # git-ignorado por completo
  enem/
    2023/
      dia1/  prova.pdf · gabarito.pdf · imagens/qNN_i.png
      dia2/  ...
    2024/ ...
  <fonte>/...               # cada fonte nova segue o mesmo padrão
```

O download só acontece se o arquivo ainda não existe no acervo — reextrair
uma área reutiliza os PDFs já baixados.

## Cobertura, imagens e metadados

- A UI tem um **mapa de cobertura** (ano × área): publicada / em revisão /
  botão "extrair" para o que falta — é o checklist do que já foi feito.
- A extração **recorta as figuras de cada questão** do PDF (por posição na
  página, 2 colunas) para `cache/imagens/` e as mostra no editor — é assim
  que se confirma questões marcadas "depende de imagem". Figuras vetoriais
  (desenhadas no PDF, não embutidas) não são capturadas. As imagens ainda
  NÃO vão para o app (próxima etapa: Supabase Storage).
- Metadados gravados no catálogo (`metadados jsonb`): URLs oficiais dos
  PDFs, dia, caderno, data da extração, modelo de IA; por questão: número
  original e contagem de imagens locais. A IA também classifica o
  **tópico** de cada questão (vira subdivisão na importação do usuário).
- Reextrair uma área NÃO clobbera a revisão: o arquivo antigo vira
  `.bak-<timestamp>.json`.

## O que a extração faz (e o que exige revisão)

- Baixa prova + gabarito oficiais do INEP (caderno azul/CD1) via curl
  (a cadeia TLS do INEP é incompleta para o urllib).
- Divide o texto por marcador `QUESTÃO N` e estrutura em lotes de 8 via
  OpenAI (`OPENAI_API_KEY`/`OPENAI_MODEL` do `.env`), com schema estrito.
- A resposta correta vem do **gabarito oficial**, nunca da IA.
- Auto-reprova (aprovada=false) questões que dependem de imagem/gráfico
  ou que não fecharam 5 alternativas; anuladas (X) são descartadas.
- **Atenção na revisão**: o layout de 2 colunas do PDF às vezes embaralha
  a ordem texto-base/comando — ler o enunciado antes de aprovar.

## Formatação de enunciados (vale para TODAS as fontes)

Convenção de Markdown restrito no texto — a IA já gera assim e o app
renderiza com `formatarTexto()` (escapado antes; XSS-safe):

```
> linhas de citação/texto-base
*AUTOR, Obra. Ano (adaptado).*   <- fonte/referência (itálico)
| Coluna A | Coluna B |          <- tabelas (1ª linha = cabeçalho)
| 1        | 2        |
```

O editor tem botão "Prévia da formatação" por questão, atualizando ao
digitar. Fontes novas (PDF ou HTML) devem produzir a MESMA convenção —
o render no app é um só.

## Concursos (bancas) — adaptador `concurso`

Concurso não baixa sozinho (sem URL previsível): o curador coloca os PDFs em
`cache/<banca>/<slug>/prova.pdf` e `gabarito.pdf`, e roda por matéria:

```bash
# lista as matérias do edital (lidas do gabarito):
python provas.py concurso --banca cesgranrio --slug bb-2023-agente-comercial
# extrai uma matéria:
python provas.py concurso --banca cesgranrio --slug bb-2023-agente-comercial \
  --orgao "Banco do Brasil" --ano 2023 --cargo "Escriturário Agente Comercial" \
  --nivel medio --materia "Língua Inglesa"
```

Estrutura: **categoria=concurso → banca(fonte) → órgão → cargo(→nível) →
matéria(area) → tópico**. O gabarito da banca dá as faixas de matéria e as
respostas oficiais. Layout CESGRANRIO implementado (`concurso.py`); outras
bancas entram com nova função de gabarito/segmentação no mesmo miolo.

## Adicionar uma fonte nova (banca, vestibular, certificação)

Criar um adaptador com as mesmas 3 responsabilidades do ENEM:
`baixar` (URLs oficiais), `gabarito` (mapa questão→letra) e
`blocos_questoes` (texto por questão) — e registrar no comando. A parte
de IA/validação/publicação é comum a todas as fontes.

## Segurança

- Publicação usa a connection string do pooler (senha no `.env`) — o
  catálogo não tem NENHUMA política de escrita; usuário do app não
  consegue inserir/alterar provas (testado adversarialmente).
- A importação no app (`importar_prova_catalogo`) é SECURITY INVOKER:
  a cópia para a conta do usuário passa pelo RLS normal dele.
