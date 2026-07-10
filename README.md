# Study Rats 🐭

Plataforma multi-usuário de estudo para certificações (AWS, Databricks, etc.):
simulados, repetição espaçada estilo Anki (SM-2) e ingestão de questões por IA
(ChatGPT, Claude ou Grok).

**App:** <https://rwdias.github.io/assistente_estudo/>

## Arquitetura

100% serverless — sem servidor próprio:

| Camada | Onde roda |
|---|---|
| Front-end (SPA HTML/CSS/JS puro, sem build) | GitHub Pages (`web/`) |
| Banco, auth e autorização | Supabase (Postgres + Auth + RLS) |
| Algoritmo SM-2 e resumo do dashboard | Funções SQL no Postgres (`registrar_resposta`, `resumo_materias`) |
| Chamadas de IA (extração/reformulação) | Edge Functions Deno/TS (`supabase/functions/`) com quota diária por usuário |

## Segurança

- **RLS deny-by-default**: o papel `anon` não tem acesso a nada; usuários
  autenticados só enxergam/alteram as próprias linhas, com `WITH CHECK` em
  toda a cadeia (matéria → subdivisão → pergunta → opção/revisão).
- A **anon key no front é pública por design** — a barreira de segurança é o
  RLS, não o sigilo da chave.
- Quota de IA (`perfis`) não é editável pelo usuário: escrita apenas via
  função `SECURITY DEFINER` com `search_path` fixado.
- Edge Functions verificam o JWT internamente, limitam o tamanho da entrada
  e usam CORS restrito à origem do GitHub Pages.
- Chaves dos provedores de IA vivem só em `supabase secrets`.

## Estrutura

```
├── web/                    # SPA (index.html, css/, js/)
├── supabase/
│   ├── migrations/         # schema + RLS + funções SQL
│   └── functions/          # Edge Functions extrair/ e reformular/
├── .github/workflows/      # deploy do web/ no GitHub Pages
├── docs/                   # documentação de apoio
└── backups/                # backups locais do SQLite antigo (fora do git)
```

## Desenvolvimento

Front-end local (aponta para o Supabase de produção):

```bash
cd web && python3 -m http.server 8001
```

Mudanças de schema: adicionar arquivo em `supabase/migrations/` e aplicar via
SQL Editor do painel ou `psql`. Edge Functions:

```bash
supabase functions deploy extrair reformular --project-ref <ref> --use-api
```

## Observações operacionais

- **Free tier do Supabase pausa o projeto após ~1 semana sem uso** — reative
  pelo painel se o app parar de responder.
- Cadastro está com confirmação de e-mail desativada (sem SMTP próprio);
  senha mínima de 8 caracteres.
