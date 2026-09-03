# Study Rats — instruções do projeto

Plataforma multi-usuário de estudo (simulados, flashcards estilo Anki,
repetição espaçada SM-2 e ingestão de questões por IA).
**App público:** <https://rwdias.github.io/assistente_estudo/>

Idioma do projeto: **pt-BR** em tudo — código (nomes de funções/variáveis),
UI, mensagens de commit e comunicação.

**Código bem comentado é obrigatório** (inegociável): todo código novo explica
O QUE faz e, principalmente, **POR QUÊ** — a intenção e a decisão por trás
(trade-off, armadilha evitada, regra de negócio), não o óbvio. Vale para SQL,
Edge Functions e front. Comentar como quem explica para o próximo a manter.

## Arquitetura (100% serverless — NÃO existe backend próprio)

| Camada | Onde |
|---|---|
| Front-end | SPA em HTML/CSS/JS **puro, sem build step** (`web/`), publicada no GitHub Pages |
| Banco + Auth + autorização | Supabase (Postgres + Auth + **RLS**), projeto ref `scafgcpxjsimzaaviean`, região `sa-east-1` |
| Regras de negócio no banco | Funções SQL: `registrar_resposta` (SM-2), `resumo_materias`, `consumir_quota_ia` |
| Chamadas de IA | Edge Functions Deno/TS: `supabase/functions/extrair` e `reformular` |

Edição de item usa a RPC `atualizar_pergunta` (não UPDATE direto): trocar
alternativas é apagar+inserir, e precisa ser atômico. Ela também descarta as
variantes quando o conteúdo muda (não quando muda só o tópico).

O backend Python (FastAPI/SQLAlchemy/alembic) foi **removido** — não recriar.
O SQLite antigo (`assistente_estudo.db`, `backups/`) é só fallback histórico.

## Modelo de dados (Postgres, schema em `supabase/migrations/`)

```
auth.users (Supabase)
└── perfis            (quota diária de IA + nome/objetivo/nascimento do
    │                  cadastro; quota SÓ via função definer — o UPDATE do
    │                  usuário tem grant POR COLUNA nas 3 de perfil)
└── trilhas           (agrupam matérias do mesmo contexto: curso,
    │                   certificação, concursos. SÓ organização — o estudo
    │                   segue por matéria. materias.trilha_id é ON DELETE
    │                   SET NULL: apagar a trilha NÃO apaga as matérias)
└── materias          (usuario_id uuid, nome, trilha_id, contexto_ia md p/ flashcards)
    └── subdivisoes   ("tópicos"; "Geral" é o padrão implícito)
        └── perguntas (tipo 'pergunta'|'flashcard'; frente=enunciado, verso;
            │          dificuldade existe mas é INTERNA — nunca exibir na UI)
            ├── opcoes             (só tipo 'pergunta'; exatamente 1 correta)
            ├── revisoes_perguntas (estado SM-2: 1:1 com pergunta)
            └── pergunta_variantes (versões reformuladas por IA do MESMO
                                    conceito; `opcoes` jsonb; soft-delete via
                                    `descartada`. NÃO tem SM-2 próprio)
```

Toda FK tem `ON DELETE CASCADE` — **exceto `materias.trilha_id`**, que é
`ON DELETE SET NULL` (a trilha é etiqueta de organização, não dona do conteúdo).
Ids são `bigint identity`.

### Banco de provas (catálogo público)
`catalogo_provas` → `catalogo_questoes` → `catalogo_alternativas`:
leitura para todo `authenticated`, **nenhuma política de escrita** — a
curadoria roda fora do app (`ferramentas/provas/`, ver README de lá:
scraping de fontes oficiais + revisão em JSON + publicação via pooler).
Hierarquia do catálogo: `nivel` → `categoria` (vestibular/concurso) →
`fonte` (banca/instituição) → `orgao`+`cargo` (só concurso) → `area`
(matéria) → `topico` (canônico, sem sinônimos). Fontes: ENEM em
`ferramentas/provas/provas.py`, concursos (CESGRANRIO) em `concurso.py`.
Usuário importa com `rpc('importar_prova_catalogo')` (SECURITY INVOKER —
cópia passa pelo RLS dele; idempotente por enunciado). UI: seção "Banco
de provas" no Início (`carregarCatalogo` em `web/js/materias.js`).
**Imagens das questões**: bucket público `provas` no Storage (upload SÓ
pela curadoria com service key; sem política de escrita); URLs em
`imagens jsonb` (catálogo e `perguntas` — a importação copia a URL, não
o arquivo). Render: `renderImagensPergunta` em core.js, que descarta URLs
fora do Storage do projeto; CSP `img-src` inclui o host do Supabase.

### Materiais da matéria (arquivos)
Bucket **PRIVADO** `materiais` (0027), separado do bucket público `provas`:
guarda livros/PDFs/slides do usuário, que não podem ficar acessíveis por URL
pública. Caminho `{usuario_id}/{materia_id}/{arquivo}` — o uid como PRIMEIRO
segmento é o que sustenta a política (`storage.foldername(name)[1] =
auth.uid()`), então ninguém alcança a pasta de outro; o `materia_id` no segundo
segmento é a "pasta por matéria". Acesso só por **URL assinada** de 5 min
(`createSignedUrl`), gerada ao clicar em Abrir. Limite de 50 MB/arquivo
(`file_size_limit` no bucket, espelhado no cliente). UI: painel "Materiais"
(`web/js/materiais.js`), com upload múltiplo, listar, abrir e excluir. Nome do
arquivo é sanitizado (sem acento/espaço) e `upsert:false` — sobrescrever em
silêncio faria perder a versão anterior. Não há tabela de metadados: a listagem
vem do próprio Storage (evita sincronia para manter).

### SM-2 / Aprendizado (conceitos centrais)
- Acerto = q5, erro = q2; EF piso 1.3; progressão 1 → 6 → round(i×EF) dias;
  erro zera intervalo e reagenda +10min. Implementação canônica: função SQL
  `registrar_resposta` (portada e validada 1:1 contra o antigo src/srs.py).
- **Flashcards usam 4 níveis** (estilo Anki), via `p_qualidade` na mesma
  função: 2 De novo (lapso, +10min) · 3 Difícil (volta antes do Bom, EF cai)
  · 4 Bom (progressão canônica, EF estável) · 5 Fácil (Bom×1.3, EF sobe;
  cartão novo pula p/ 4 dias). Atalhos 1–4, e Enter = Bom.
  Perguntas e simulado seguem **binários** — chamam sem `p_qualidade` e o
  comportamento é idêntico ao de sempre (provado por teste de regressão que
  compara a função antiga e a nova em 80 combinações de estado).
- **Agendamento em DIAS ÚTEIS** (0019): a DATA da próxima revisão pula
  sáb/dom e feriados nacionais do BR (fixos + móveis via Páscoa: Carnaval,
  Sexta Santa, Corpus Christi) — funções `eh_feriado_nacional`/
  `adiciona_dias_uteis`, fuso America/Sao_Paulo. Objetivo: não acumular
  matéria depois de fds/feriado (nada vence em dia não-útil). O **número** do
  intervalo (1, 6, round(i×EF)) NÃO muda — só a data derivada dele; o lapso
  de +10min segue em tempo corrido. SM-2 provado idêntico à 0017 em 200 casos.
- **A revisão vence à MEIA-NOITE** do dia alvo (0026), não na hora em que se
  estudou: `adiciona_dias_uteis` devolve o início do dia em America/Sao_Paulo.
  Antes ela preservava a hora local (`d + local::time`), então quem estudava às
  15h só via o item voltar às 15h — estudar de manhã era impossível. O lapso de
  erro (+10min) NÃO passa por essa função, de propósito (senão o item voltaria
  só no dia seguinte, em vez da mesma sessão). Armadilha de SQL: use
  `(d + time '00:00') at time zone ...` — escrever `d at time zone ...` casta o
  `date` para timestamptz e converte duas vezes, devolvendo a hora errada.
- O prazo mostrado em cima de cada botão vem de `preverIntervalos` (core.js),
  espelho do **número** do intervalo do banco (há teste numa matriz intervalo
  × EF × qualidade). Atenção: o rótulo mostra o intervalo em dias ÚTEIS de
  estudo (ex.: "6 dias"), então a data real cai alguns dias corridos depois
  (fds/feriados pulados) — `preverIntervalos` NÃO replica o calendário de
  feriados de propósito (evita duplicar essa lógica no cliente).
- **Modo "Foco 100"** (4º filtro do Aprendizado): sessão curta e FINITA para
  quando a fila tem centenas de itens. Mistura perguntas E flashcards vencidos,
  ordena por prioridade e corta em `FOCO_LIMITE` (100). Pontuação em
  `pontuarPrioridade` (revisao.js): `3×` taxa de erro do TÓPICO + `2×` erro do
  próprio item + `1×` atraso (satura em 30 dias) + `2` se reaprendendo. As taxas
  usam suavização de Laplace `(erradas+1)/(respondidas+2)` — sem ela, "1 erro de
  1" passaria na frente de "20 de 50". Estatística de tópico vem da matéria
  INTEIRA (não só dos vencidos). A faixa `#revisao-foco-info` explica a escolha
  e o item ganha badge "tópico difícil" (`topicosFracos` só considera tópico com
  ≥ 3 respostas — histórico ralo não vira "fraco").
- **A fila mistura perguntas e flashcards** de propósito. Elas chegam do banco
  por `created_at` e são criadas em lotes por tipo, então qualquer EMPATE na
  ordenação (todos novos = `proxima_revisao_em` null; ou mesma pontuação no
  Foco) fazia a fila sair em blocos ("todas as perguntas, depois todos os
  flashcards"). `desempateEstavel` (hash do id) embaralha os empates de forma
  determinística — mesma ordem a cada carregamento — e no Foco a comparação é
  por FAIXAS de 0,5 para que urgências semelhantes também se misturem.
- Item nunca respondido = **"a aprender"** (novo); respondido e vencido =
  **"a revisar"**. Errou na sessão → volta ao fim da fila como
  **"reaprendendo"** até acertar (espelho do Anki; lógica em `web/js/revisao.js`).
- "Madura" = intervalo ≥ 21 dias.
- **Alternativas são embaralhadas** na exibição (`embaralharOpcoes` em
  core.js), com semente `(id, vezes_respondida)`: ordem estável dentro da
  mesma tentativa (sobrevive a reload e ao "Voltar") e diferente na próxima.
  Alternativas que citam posição ("todas as anteriores", "apenas I e II")
  são detectadas por `RE_OPCAO_POSICIONAL` e mantêm a ordem original.
- **Variantes** (só perguntas — flashcard não tem alternativas p/ reformular).
  A ação "Gerar versões" fica no **menu de engrenagem da lista de Perguntas**
  (modal `#modal-variantes` para escolher o provedor) e está SEMPRE disponível;
  `pode_variar` (`acertos_seguidos ≥ 3` OU madura, e sem variante) virou só
  **sugestão**: badge "pronta para variar" na lista e o card de aviso na tela de
  estudo. Isso é deliberado — antes a ação só existia na fila de revisão e a
  pergunta qualificava justo quando o SM-2 a mandava para semanas à frente, então
  o botão quase nunca aparecia (30 qualificadas, 0 geradas na conta do dono).
  A geração vive em `gerarVariantesPara` (core.js), usada pelos dois lugares.
  1 chamada de IA grava 3 variantes (`reformular` com `quantidade`), que depois
  se revezam com o original de graça: `vezes_respondida % (1 + nº de variantes)`.
  O SM-2 continua na pergunta-pai — variante é só apresentação, não entra na fila
  como item novo. Botão "Descartar esta versão" (soft-delete) para quando a
  IA errar a mão.
- Simulado usa apenas `tipo='pergunta'`; flashcards vivem no Aprendizado.
- Simulado tem 2 fontes: "Minhas matérias" e **"Banco de questões"** (monta
  do catálogo público com filtros combináveis fonte/ano/área/prova/tópico,
  sem importar). Questão do banco é treino livre — `doBanco:true` NÃO chama
  `registrar_resposta` (não toca no SM-2). Lógica em `web/js/simulado.js`.

## Segurança (inegociável)

> Auditoria completa das 5 falhas clássicas (RLS, permissão no cliente, IDOR,
> hardcode, XSS) e **checklist para código novo** em `docs/SEGURANCA.md` —
> consultar antes de adicionar tabela, RPC, Edge Function ou render de dado.


- **RLS deny-by-default**: `anon` não tem NENHUM privilégio; `authenticated`
  só acessa as próprias linhas, com `WITH CHECK` em toda a cadeia
  materia→subdivisão→pergunta→opção/revisão/variante (bloqueia IDOR de
  leitura E escrita). Tabela nova precisa repetir o hardening de 0012 — o
  `revoke ... on all tables` de lá só valeu para as que existiam na época.
- A anon key do front (`web/js/config.js`) é **pública por design** — a
  barreira é o RLS. As chaves sensíveis ficam:
  - `.env` local (git-ignorado): `SUPABASE_DB_PASSWORD`,
    `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, chaves de IA.
  - `supabase secrets`: chaves de IA usadas pelas Edge Functions.
- **NUNCA imprimir valores do `.env` em chat/logs** — usar via variável de
  ambiente/`grep ... | cut` sem echo.
- Edge Functions: o projeto usa API keys novas (`sb_publishable_`/`sb_secret_`),
  então o gateway NÃO valida JWT — a validação é **dentro da função**
  (`usuarioAutenticado()` em `_shared/comum.ts`). CORS restrito à origem do
  Pages. Quota consumida ANTES do provedor: limite padrão em `IA_QUOTA_DIARIA`
  (secret; hoje 3/dia) com override por usuário em `perfis.ia_limite_diario`
  (admin-only, sem grant de UPDATE ao usuário; NULL = usa o padrão). O dono do
  projeto tem override alto (ilimitado). Lógica em `consumir_quota_ia`.
- Função `SECURITY DEFINER` sempre com `SET search_path = ''`.
- Mudança de schema: escrever `supabase/migrations/NNNN_*.sql`, aplicar via
  psycopg com a connection string, **testando antes contra cópia quando
  houver risco a dados**. Jamais `DELETE`/`DROP` sem escopo explícito.

### Conexão ao Postgres (para migrações/admin)
Pooler IPv4: host `aws-1-sa-east-1.pooler.supabase.com`, porta 5432,
user `postgres.scafgcpxjsimzaaviean`, senha no `.env`. (O host direto
`db.*.supabase.co` é IPv6-only e instável daqui.)

## Front-end (`web/`)

- Sem framework e sem build: `index.html` + `css/app.css` + `js/*.js`
  (escopo global, carregados em ordem: config → core → auth → materias →
  perguntas → simulado → revisao → ia → app).
- **CSP via `<meta>`** no `index.html` e supabase-js **pinado com SRI**
  (versão exata + `integrity`): trocar a versão exige recalcular o hash
  sha384 do arquivo do CDN. A CSP proíbe handlers inline (`onclick=`) —
  usar `addEventListener` (padrão `data-fechar-modal` nos modais).
- Panels trocados via `goPanel(id)` (SPA sem router). "Início" é a landing;
  "Aprendizado" (id interno `revisao`) é a área principal de estudo.
- Design: fonte Sora (títulos) + Inter; teal educacional; dark mode NEUTRO
  via tokens em `:root` (claro), `:root[data-theme=dark]` e media query —
  **tokens escuros duplicados de propósito, editar nos DOIS blocos**.
- **Nunca usar emojis na UI — só ícones SVG** de traço (stroke, currentColor).
- **Dificuldade é interna**: existe nos dados, mas não aparece em nenhuma tela.
- Todo dado dinâmico injetado via innerHTML passa por `esc()` (XSS).
- Enunciados/versos aceitam **Markdown restrito** (convenção válida para
  toda fonte de prova): tabelas `| a | b |`, citações `> linha`, fonte
  `*REF...*`. Renderização SÓ via `formatarTexto()` (core.js), que escapa
  antes de formatar — nunca interpretar HTML vindo de dado. Chamadas padrão
  preservam o comportamento histórico das questões/simulados, incluindo
  quebras de linha e `*...*` como referência em bloco; flashcards usam
  `formatarTexto(texto, { compacto: true })`, juntando quebras "moles" e
  mantendo `**negrito**`/`*ênfase*` inline.
- Sidebar é rail (72px) que expande no hover, com pin persistido; seletor de
  matéria é dropdown próprio no header (select nativo não aceita estilo).
- Cada item (pergunta/flashcard) tem menu de engrenagem — `renderMenuItemHTML`
  + `wireMenuItem` em core.js, usado na lista de Perguntas (Editar/Remover) e
  na tela de estudo (Editar). Editar durante o estudo recarrega só aquele item
  (`recarregarItemAtual`), preservando o lugar na sessão; exibindo variante,
  o que se edita é sempre a pergunta original.
- **"Saber mais"** (aprofundamento, ≤ 3 complementos): a decisão cache-ou-IA
  é do SERVIDOR (Edge Function `saber_mais`), de propósito — o front NUNCA
  recebe o conteúdo salvo no carregamento (`saber_mais` saiu de
  `SELECT_PERGUNTA`) e sempre manda a mesma chamada (`pergunta_id` + `vistos`).
  Cache e IA retornam a mesma forma `{complementos,total}`, então nem pelo
  devtools dá para distinguir. O bloco começa recolhido; `consultarSaberMais`
  (core.js) é a única ação. A função lê a questão por RLS (IDOR-safe), devolve
  do cache com piso de latência e sem quota, ou gera via `chamarProvedor` +
  grava por `adicionar_saber_mais`. **Não** reexpor o cache no cliente.

## Deploy

- **SPA**: push em `main` tocando `web/**` dispara `.github/workflows/pages.yml`
  (com **cache busting** — assets ganham `?v=<sha>`; não remover esse passo).
  Verificar: `gh run watch` + `curl ... | grep 'js/core.js?v='`.
- **Edge Functions**: `SUPABASE_ACCESS_TOKEN=... supabase functions deploy
  extrair reformular saber_mais --project-ref scafgcpxjsimzaaviean --use-api`
  (mudou `_shared/comum.ts`? redeploy as três, que o compartilham).
- Commits **sem trailer de coautoria**, mensagens em pt-BR.

## Testes (ainda por E2E; plano de suíte pytest em `docs/TESTES.md`)

- **`docs/TESTES.md`**: plano para migrar a validação avulsa para uma suíte
  pytest versionada (camadas: funções SQL, RLS, contrato das Edge Functions,
  avaliadores, E2E), com fixtures de usuário descartável, marcadores
  (`db/rls/edge/ai/e2e`) e rollout em fases. Consultar/atualizar ao criar testes.
- Playwright (chromium) do `venv/` local contra `web/` servida com
  `python3 -m http.server 8001` (origem permitida no CORS) ou contra a URL
  pública. Scripts-modelo no scratchpad da sessão.
- **Todo teste contra produção usa usuário descartável** criado via Admin
  API (service_role) e **removido ao final** (delete escopado pelo uid —
  cascade limpa os dados). Nunca usar a conta real do dono em testes.
- Testes adversariais de RLS (usuário B contra dados de A, anon, quota)
  devem ser re-rodados após qualquer mudança de política/função SQL.
- Nos testes de UI: a sidebar em hover intercepta cliques — afastar o mouse
  (`page.mouse.move(700, 400)`) após navegar, ou fixar com o pin.

## Operacional

- Free tier do Supabase **pausa o projeto após ~1 semana sem uso** —
  reativar no painel se o app parar de responder.
- **O repositório precisa ser PÚBLICO**: GitHub Pages gratuito não serve
  repo privado — torná-lo privado apaga o site na hora (aconteceu em
  2026-07-10; recriar via `gh api -X POST repos/.../pages -f build_type=workflow`).
- Login social: Google OAuth via Supabase Auth (`signInWithOAuth` em
  `web/js/auth.js`); credenciais no Google Cloud Console do dono e no
  config do Auth (Management API); `site_url` e `uri_allow_list` apontam
  para o Pages + localhost:8001.
- Cadastro coleta nome/objetivo/nascimento → metadados do signUp → trigger
  `criar_perfil` grava em `perfis`. Conta sem perfil completo (Google,
  antigas) recebe o modal `#modal-completar-perfil` no primeiro acesso
  (`aplicarPerfilUsuario` em auth.js).
- Confirmação de e-mail no signup está DESLIGADA (sem SMTP próprio);
  senha mínima 8. HIBP (senha vazada) exige plano Pro — pendente.
- Gerenciamento via Management API (`api.supabase.com`) requer header
  `User-Agent: curl/...` (o UA padrão do urllib é bloqueado pelo Cloudflare).
