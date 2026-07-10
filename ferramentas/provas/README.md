# Ferramenta de curadoria de provas

Alimenta o **Banco de provas** do Study Rats (catálogo público no Supabase)
a partir de fontes oficiais. Roda fora do app, na máquina do curador, com
as credenciais do `.env` da raiz — os usuários do app só leem o catálogo
e importam provas para a própria conta (sem gastar quota de IA).

## Fluxo

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
