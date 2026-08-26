# Modo Matemática — desenho de arquitetura

Estudar conteúdo matemático é **produzir** (resolver/derivar), não **reconhecer**
(múltipla escolha). O motor de repetição espaçada (SM-2 em dias úteis) e o fluxo
de flashcard (resolve no papel → revela → se dá nota) se reaproveitam inteiros; a
matemática adiciona uma camada por cima. Documento de DESENHO — implementar em
fases, cada uma entregando valor sozinha.

## Matéria tem TIPO (separação dura)

A matéria ganha `tipo = 'normal' | 'matematica'`, escolhido **na criação**. A
matéria **normal fica 100% inalterada** — o que existe hoje (múltipla escolha,
vestibular, concurso) não muda em nada. O **modo matemática** (LaTeX, ingestão de
livro, drill paramétrico, digitar-e-conferir) só aparece **dentro de matéria
matemática**. Assim nada polui o fluxo normal, e a renderização de fórmula é
escopada ao tipo matemática (não interpreta `$...$` em matéria normal).

- `materias` recebe a coluna `tipo` (default `'normal'`); a UI de criar matéria
  passa a perguntar o tipo. Coluna não é sensível → sem mudança de RLS.
- O estudo e as telas de criação/ingestão ramificam pelo tipo da matéria atual.
- (Em aberto) trocar o tipo depois da criação: por ora, fixo na criação.

## Lista de exercícios — a 3ª categoria (decisão de 2026-08-25)

Exercício de livro/lista **não é** flashcard nem simulado — é uma categoria
própria, ao lado das duas que já existem:

| Modo | Interação | Origem |
|---|---|---|
| Simulado | reconhecer a alternativa | minhas matérias / banco público |
| Flashcard | recall ativo + auto-nota (SM-2) | anotações, fórmulas, definições |
| **Lista de exercícios** | **resolver** e **conferir** a resposta | livros/listas com gabarito |

Forçar em flashcard perde (1) a **identidade de lista** (numerada, com sub-itens,
de uma fonte; você percorre a lista) e (2) a interação certa: **resolver e ser
conferido**, não "virar o cartão e se dar nota".

**Decisões fechadas com o dono:**
- A **lista vive dentro da matéria** (matéria → listas → exercícios). Matéria
  matemática passa a ter **flashcards** (recall de fórmula/definição) **E listas**.
- Estudo: **resolver + conferir, com os errados na repetição espaçada**. Você
  percorre a lista resolvendo; o CÓDIGO confere (Calc/Logica) ou compara com o
  gabarito; há placar de progresso; quem erra entra no SM-2 (dias úteis) e volta.

**Modelo de dados:**
- `listas` (id, materia_id fk, nome, created_at) — coleção ordenada dentro da
  matéria. RLS pela cadeia de dono (lista → matéria).
- `perguntas.tipo` ganha `'exercicio'` + coluna `lista_id` (fk, nullable).
- `exercicios` (1:1 com a pergunta): `resposta_esperada`, `verificacao jsonb`,
  `ordem`. O `verso` guarda a resolução passo a passo.
- **SM-2 reusa** `revisoes_perguntas`: responder um exercício chama
  `registrar_resposta` (errado agenda cedo → volta; certo agenda longe). Reusa
  variantes, dias úteis, RLS — tudo.

**Resolver e conferir (onde entra o determinístico):**
- Na ingestão, a IA emite por exercício uma `verificacao` (o que é calculável) —
  o código roda `Calc`/`Logica` (`web/js/conferir.js`) e é a **fonte da verdade**
  onde é 100% computável; onde não é, compara com a `resposta_esperada` (gabarito)
  ou o usuário se auto-avalia.
- Fluxo: digita a resposta → conferência determinística → certo/errado → SM-2.

**Ingestão de livro/lista** (texto ou foto/PDF) → monta uma **LISTA** (exercícios
+ gabarito + verificação), NÃO flashcards. (Flashcards continuam para recall de
fórmula/definição, criados à parte.)

**Reaproveita o já feito (Fase 1):** renderização LaTeX→MathML, tipo de matéria,
e os avaliadores determinísticos (`Calc`/`Logica`/`conferir`, já prontos e
testados). Só a ingestão muda de alvo (flashcard → lista).

## Trilha antiga — flashcards matemáticos e drill (mantidas)

> Nota: a "Trilha A" abaixo foi **substituída** pela Lista de exercícios acima
> para o caso de livros/listas. Flashcards matemáticos seguem existindo para
> recall de conceito; a Trilha B (drill paramétrico) segue como está.

- **Trilha A — exercícios de livro (estáticos).** Você manda o material (texto, foto
  ou PDF) com os exercícios **e as respostas**; a IA monta **flashcards
  matemáticos**: frente = enunciado, verso = passo a passo + resposta, tudo em
  LaTeX. É flashcard puro — sem tabela nova. É o principal jeito de criar conteúdo.
- **Trilha B — drill paramétrico (números novos).** Problema com template + faixas
  de parâmetros + fórmula da resposta; cada revisão sorteia números e recalcula,
  forçando re-derivar. Precisa de estrutura nova. Geralmente montado à mão (ou por
  IA "generalizar", com teste antes de salvar) — não sai direto do livro.

Ambas: renderização de fórmula (MathML) + SM-2 (dias úteis) + os 4 botões.

## Decisões fechadas com o dono

- **Fórmula**: autor escreve **LaTeX** (`$...$` inline, `$$...$$` bloco); render em
  **MathML nativo** do navegador via conversor pequeno **vendorizado** (ex.: Temml —
  puro JS, sem dependência; confirmar que não usa `eval`). `trust=false` (bloqueia
  `\href` e afins → sem XSS). É essencial desde o começo.
- **Ingestão**: **texto E foto/PDF** (visão). PDF vira imagens de página no
  **navegador** (vendorizar `pdf.js`) — texto/foto/PDF caem todos no mesmo caminho.
- **Figuras/diagramas**: **anexar a imagem** (página ou recorte) ao card, reusando o
  suporte a `imagens`. Fiel para geometria/gráficos; exige bucket gravável pelo
  usuário no Storage.
- **Solução**: a IA **sempre elabora o passo a passo**, ancorada na resposta do livro
  (resposta conhecida reduz erro). O preview renderiza a fórmula → o usuário confere
  antes de salvar.
- **Drill (Trilha B)**: **template determinístico** — o autor define a fórmula da
  resposta; o sistema sorteia e calcula (confiável, de graça). Avaliação da fórmula
  no **cliente**, com **avaliador próprio e seguro** (sem `eval`).
- **Digitar e conferir**: só **resposta numérica** (equivalência com tolerância,
  `1/2`=`0,5`). Simbólico (`x+x` vs `2x`) exigiria CAS → fora de escopo (fica no
  modo auto/self-grade).
- **SM-2 / dias úteis**: `registrar_resposta` sem mudança.

## Modelo de dados

- **Trilha A** = `perguntas.tipo = 'flashcard'` com LaTeX em `enunciado`/`verso`.
  **Sem tabela nova.** Figura → `imagens jsonb` (URL no Storage do usuário).
- **Trilha B** = novo `tipo = 'problema'` + tabela-companheira 1:1:
  ```
  problemas (pergunta_id fk 1:1)
    parametros       jsonb   -- {"a":{"min":1,"max":9}, "b":{"min":1,"max":9,"exclui":[0]}}
    resposta_formula text    -- "-b/a" (expressão sobre os parâmetros)
    resposta_tipo    varchar -- 'auto' | 'numerica'
    tolerancia       numeric -- p/ 'numerica'
    solucao_template text    -- LaTeX + lacunas, passo a passo com os valores
  ```
  SM-2 fica na pergunta-pai (1 linha em `revisoes_perguntas`); cada revisão renderiza
  uma **instância** com números novos — mesmo padrão das variantes (apresentação
  muda, estado do SRS não). Semente do sorteio: `(pergunta_id, vezes_respondida)`
  (estável na tentativa, muda na próxima — igual ao embaralhamento das alternativas).

## Renderização (fundação)

`formatarTexto` passa a: (1) proteger os trechos `$...$`/`$$...$$`; (2) escapar o
resto (anti-XSS como hoje); (3) converter o math via o conversor vendorizado
(`trust=false`) e injetar o MathML. MathML é nativo (sem lib de runtime) — casa com
a CSP e o "sem build". Conversor servido do próprio domínio → `script-src 'self'`
já cobre. Fonte: começar com a nativa do sistema; se ficar feio, vendorizar Latin
Modern Math depois (aí add `font-src 'self'` na CSP). Worker do `pdf.js` também
vendorizado (same-origin; `default-src 'self'` cobre).

## Ingestão por IA (`extrair` estendido)

- **Texto**: novo prompt "math" — lê exercícios + respostas, saída = flashcards em
  LaTeX, **elaborando** o passo a passo até a resposta do livro.
- **Visão (foto/PDF)**: `extrair` aceita imagem(ns) (data URL); `chamarProvedor`
  ganha conteúdo multimodal (ChatGPT/Claude/Grok aceitam imagem). Cliente
  redimensiona antes de enviar (limite de tamanho). PDF → imagens via `pdf.js`.
- **Figura**: quando houver figura essencial, a imagem da página (ou recorte) é
  anexada ao card (upload no bucket do usuário; URL em `imagens`).
- **Quota**: mesmo mecanismo (`consumir_quota_ia` antes do provedor); visão custa
  mais tokens.
- **Revisão**: a tela "revise antes de salvar" **renderiza a fórmula** → o usuário
  corrige LaTeX torto antes de salvar.

## Storage de imagens do usuário

Hoje só a curadoria escreve no bucket `provas` (service key, sem política de
escrita). Para anexar figuras, criar bucket/prefixo **gravável por `authenticated`**
com **policy por dono** (pasta = `uid`; lê/escreve só o próprio). `renderImagensPergunta`
já descarta URL fora do Storage do projeto — novo bucket no mesmo host funciona.

## SM-2 / estudo

- Math usa `registrar_resposta` sem mudança (4 botões; dias úteis).
- Modo `numerica`: digita → confere (tolerância + fração/decimal) → revela
  certo/errado → **então** os 4 botões (a checagem é um passo A MAIS antes do SM-2).

## Segurança (seguir `docs/SEGURANCA.md`)

- Tabela `problemas`: RLS deny-by-default, cadeia de dono, `WITH CHECK` em
  insert/update, revoke de anon + truncate/trigger/references de authenticated.
- Editar problema (toca `perguntas` + `problemas`) → RPC atômica (tipo
  `atualizar_pergunta`).
- Bucket do usuário: policies de `storage.objects` por dono; sem escrita p/ anon.
- Avaliador client-side: só aritmética (sem `eval`/`Function`, sem DOM/rede) → CSP-safe.
- LaTeX `trust=false`; MathML só do conversor (nunca HTML cru de dado).
- Visão: validar tipo/tamanho da imagem na função; CORS restrito; chaves só em secrets.

## Fases de construção

1. ✅ **FEITA.** **Tipo de matéria** (`materias.tipo`, migr. 0020; `resumo_materias`
   devolve tipo, 0021) + escolha na criação + **renderização LaTeX→MathML**
   (Temml vendorizado em `web/js/vendor/`, `formatarTexto({math:true})`, escopada
   a matéria matemática) + **ingestão por TEXTO** (`extrair` com flag `matematica`
   + `promptFlashcardsMath`, preview com fórmula renderizada). Matéria normal
   intocada. Estudo e lista renderizam fórmula só em matéria matemática.
1.2. ✅ **FEITA.** **Lista de exercícios** (3ª categoria, dentro da matéria
   matemática). Ingestão por texto mantém a **questão numerada inteira** com
   todos os subitens juntos (não um card por subitem); cada questão traz
   `verificacoes` (lista por subitem: rótulo + resposta + o que o código
   confere). Migr. 0022 (`listas`/`exercicios`, `perguntas.tipo='exercicio'` +
   `lista_id`), 0023 (`resumo_materias` não conta exercício na fila do
   Aprendizado). UI: painel "Listas" (`web/js/listas.js`) com criar-por-IA +
   preview com conferência do código, e **modo de estudo "resolver a lista"**
   (clica na lista → vê o enunciado, resolve no papel, revela resolução +
   gabarito + conferência por subitem → auto-avalia em 4 níveis no mesmo SM-2;
   errar reenfileira na sessão). Perguntas/simulado/aprendizado filtram
   `tipo='exercicio'` (só vive no modo lista). Tradução/itens sem V/F viram
   `tipo:'nenhuma'` (sem conferência, sem falso alarme).
1.5. **Ingestão por VISÃO** (foto/PDF): multimodal no `extrair`, `pdf.js`, bucket do
   usuário + anexo de figura.
2. **Drill paramétrico**: `tipo='problema'` + tabela `problemas` + amostragem
   determinística + avaliador seguro + modo auto.
3. **Digitar e conferir** (equivalência numérica).

## Em aberto / riscos

- Fonte matemática (nativa primeiro; vendorizar depois).
- Parâmetros: inteiros primeiro (decimais/frações/`step` depois).
- Respostas simbólicas → só modo auto (self-grade).
- Recorte preciso de figura é difícil; v1 = anexar página/recorte simples.
- OCR/LaTeX de fórmula complexa (foto ruim) pode errar → mitigado pelo preview +
  correção antes de salvar.
- Só feriados **nacionais** no SM-2 (já documentado); não afeta math diretamente.
