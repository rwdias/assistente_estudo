# Flashcards seletivos do BACEN

## Diagnóstico e decisão

Antes, o prompt exigia cobertura exaustiva, incluindo conceitos secundários e exemplos, com teto de 100 cartões. Acrescentar apenas um contexto seletivo deixaria instruções contraditórias. O leitor de PDF também enviava contexto vazio.

Agora, a função `extrair` identifica a matéria e sua trilha com as permissões do usuário. Nas 11 matérias das trilhas BACEN — Analista TI, substitui a cobertura exaustiva por seleção de conteúdo relevante. O painel e o leitor usam a mesma regra. O leitor recupera o contexto salvo da matéria; o painel permite enviar o contexto em edição.

## Regras aprimoradas

- Priorizar conceitos centrais, definições, regras, exceções, fórmulas com condições de uso e diferenças confundíveis.
- Descartar apresentações, publicidade, exemplos ilustrativos, trivialidades e repetições.
- Perguntar internamente se a informação merece revisões futuras; não exigir um número mínimo.
- Criar perguntas específicas, autossuficientes, com um foco de recuperação; respostas diretas em poucas frases.
- Combinar somente uma relação, comparação ou regra-exceção. Não criar cartões com múltiplas perguntas independentes.
- Preservar condições e ressalvas; não inventar fatos, incidência na banca ou conteúdo ausente.
- Deduplicar o lote. Não prometer deduplicação contra o acervo, que não é enviado ao modelo.
- Normalmente 1–4 cartões por página selecionada no PDF, excepcionalmente 5. O servidor limita o total a cinco vezes o número de páginas informado, até 100.
- Texto sem paginação: até 5 por envio. Não estimar páginas pelo tamanho do texto.
- Zero cartões é uma resposta válida.
- Manter o JSON do sistema (`frente`, `verso`, `dificuldade`, `topico`), reutilização de tópicos e regras de LaTeX para matérias matemáticas.

## Referência e manutenção

Referência histórica: [edital BCB 2024, item 18.2](https://bcb.gov.br/content/acessoinformacao/analista_2024/Edital-n-1-de-Abertura-do-concurso.pdf). Os recortes são resumos, não a íntegra do edital. Um trecho de edital inserido no contexto da matéria fornece um recorte mais específico. Não há afirmação de que este seja um edital futuro.

Texto efetivo do perfil: `supabase/functions/_shared/bacen.ts`, função `regrasBacen`.
Composição com formato, tópicos, matemática e contexto: `promptFlashcards` em `_shared/comum.ts`.
A seleção de relevância depende do modelo; os cartões continuam passando pela prévia de revisão antes de salvar.
