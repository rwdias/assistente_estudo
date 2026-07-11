# Study Rats — instruções do projeto

Plataforma multi-usuário de estudo (simulados, flashcards estilo Anki,
repetição espaçada SM-2 e ingestão de questões por IA).
**App público:** <https://rwdias.github.io/assistente_estudo/>

Idioma do projeto: **pt-BR** em tudo — código (nomes de funções/variáveis),
UI, mensagens de commit e comunicação.

## Arquitetura (100% serverless — NÃO existe backend próprio)

| Camada | Onde |
|---|---|
| Front-end | SPA em HTML/CSS/JS **puro, sem build step** (`web/`), publicada no GitHub Pages |
| Banco + Auth + autorização | Supabase (Postgres + Auth + **RLS**), projeto ref `scafgcpxjsimzaaviean`, região `sa-east-1` |
| Regras de negócio no banco | Funções SQL: `registrar_resposta` (SM-2), `resumo_materias`, `consumir_quota_ia` |
| Chamadas de IA | Edge Functions Deno/TS: `supabase/functions/extrair` e `reformular` |

O backend Python (FastAPI/SQLAlchemy/alembic) foi **removido** — não recriar.
O SQLite antigo (`assistente_estudo.db`, `backups/`) é só fallback histórico.

## Modelo de dados (Postgres, schema em `supabase/migrations/`)

```
auth.users (Supabase)
└── perfis            (quota diária de IA + nome/objetivo/nascimento do
    │                  cadastro; quota SÓ via função definer — o UPDATE do
    │                  usuário tem grant POR COLUNA nas 3 de perfil)
└── materias          (usuario_id uuid, nome, contexto_ia md p/ flashcards)
    └── subdivisoes   ("tópicos"; "Geral" é o padrão implícito)
        └── perguntas (tipo 'pergunta'|'flashcard'; frente=enunciado, verso;
            │          dificuldade existe mas é INTERNA — nunca exibir na UI)
            ├── opcoes             (só tipo 'pergunta'; exatamente 1 correta)
            └── revisoes_perguntas (estado SM-2: 1:1 com pergunta)
```

Toda FK tem `ON DELETE CASCADE`. Ids são `bigint identity`.

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

### SM-2 / Aprendizado (conceitos centrais)
- Acerto = q5, erro = q2; EF piso 1.3; progressão 1 → 6 → round(i×EF) dias;
  erro zera intervalo e reagenda +10min. Implementação canônica: função SQL
  `registrar_resposta` (portada e validada 1:1 contra o antigo src/srs.py).
- Item nunca respondido = **"a aprender"** (novo); respondido e vencido =
  **"a revisar"**. Errou na sessão → volta ao fim da fila como
  **"reaprendendo"** até acertar (espelho do Anki; lógica em `web/js/revisao.js`).
- "Madura" = intervalo ≥ 21 dias → oferece reformulação por IA (só perguntas).
- Simulado usa apenas `tipo='pergunta'`; flashcards vivem no Aprendizado.
- Simulado tem 2 fontes: "Minhas matérias" e **"Banco de questões"** (monta
  do catálogo público com filtros combináveis fonte/ano/área/prova/tópico,
  sem importar). Questão do banco é treino livre — `doBanco:true` NÃO chama
  `registrar_resposta` (não toca no SM-2). Lógica em `web/js/simulado.js`.

## Segurança (inegociável)

- **RLS deny-by-default**: `anon` não tem NENHUM privilégio; `authenticated`
  só acessa as próprias linhas, com `WITH CHECK` em toda a cadeia
  materia→subdivisão→pergunta→opção/revisão (bloqueia IDOR de leitura E escrita).
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
  Pages. Quota (`IA_QUOTA_DIARIA`, padrão 20/dia) consumida ANTES do provedor.
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
  antes de formatar — nunca interpretar HTML vindo de dado.
- Sidebar é rail (72px) que expande no hover, com pin persistido; seletor de
  matéria é dropdown próprio no header (select nativo não aceita estilo).

## Deploy

- **SPA**: push em `main` tocando `web/**` dispara `.github/workflows/pages.yml`
  (com **cache busting** — assets ganham `?v=<sha>`; não remover esse passo).
  Verificar: `gh run watch` + `curl ... | grep 'js/core.js?v='`.
- **Edge Functions**: `SUPABASE_ACCESS_TOKEN=... supabase functions deploy
  extrair reformular --project-ref scafgcpxjsimzaaviean --use-api`.
- Commits **sem trailer de coautoria**, mensagens em pt-BR.

## Testes (não há suíte permanente — validação por E2E)

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
