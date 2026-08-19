# Revisão de segurança — Study Rats

Auditoria das 5 falhas clássicas de app web. Data: 2026-08-19.
Veredito: **nenhuma das 5 presente.** Este arquivo é também o **checklist a
seguir em toda criação nova** (ver "Regras para código novo" no fim).

Arquitetura: SPA estática (GitHub Pages) + Supabase (Postgres/Auth/RLS) +
Edge Functions. Não há backend próprio — a barreira de dados é o **RLS**, não
o cliente.

---

## 1. Banco sem tranca (RLS)

**Status: OK — RLS ativo em 100% das tabelas de `public`.**

Verificado via catálogo (`pg_class.relrowsecurity`):

| Tabela | RLS | Escrita p/ `authenticated` |
|---|---|---|
| `materias`, `subdivisoes`, `perguntas`, `opcoes`, `revisoes_perguntas`, `pergunta_variantes` | ✅ | policies próprias (dono) |
| `perfis` | ✅ | só colunas de perfil (quota via definer) |
| `catalogo_provas`, `catalogo_questoes`, `catalogo_alternativas` | ✅ | **nenhuma** (só leitura) |

- Policies do dono, com a cadeia completa `materia → subdivisão → pergunta →
  opção/revisão/variante`, em `supabase/migrations/0001_schema.sql:123-284` e
  `0014_variantes_pergunta.sql:44-79`.
- `anon` não tem **nenhum** privilégio de tabela (auditado: lista vazia).
  `alter default privileges ... revoke all from anon` em `0001_schema.sql:107-109`.
- Hardening extra: `TRUNCATE/TRIGGER/REFERENCES` revogados de `authenticated`
  (`0012_hardening_grants.sql:8-10`), repetido para a tabela nova em
  `0014_variantes_pergunta.sql:81-82`. Auditado: nenhum sobrou.
- Event trigger `ensure_rls` (função `rls_auto_enable`, DEFINER com
  `search_path=pg_catalog`) força RLS em qualquer tabela nova de `public` —
  rede de segurança contra esquecimento.
- Policies do catálogo usam `USING (true)`, mas **só para SELECT e só para
  `authenticated`** — é leitura pública intencional (banco de provas), não
  furo. Escrita não tem policy nenhuma.

## 2. Permissão definida no navegador

**Status: OK — nenhuma decisão de autorização vive no cliente.**

- O front (`web/js/*`) nunca decide "pode/não pode": ele emite queries e o
  **RLS as filtra no servidor**. Ex.: `buscarPerguntasDaMateria`
  (`core.js:113`) filtra por `materia_id`, mas mesmo sem o filtro o RLS só
  devolveria linhas do dono.
- Quota de IA: consumida **dentro** da Edge Function, antes de chamar o
  provedor (`reformular/index.ts:88`, `extrair/index.ts:77`), via RPC
  `consumir_quota_ia` — que é `SECURITY DEFINER` e faz `SELECT ... FOR UPDATE`
  atômico (`0001_schema.sql:404-423`). O cliente não controla o limite.
- Limite por usuário (`ia_limite_diario`): **sem grant de UPDATE** ao usuário
  (`0013_quota_por_usuario.sql`) — só admin via service key.
- Edição de item: validações repetidas no servidor (`atualizar_pergunta`,
  `0016`/`0018`), não confia nos limites do formulário.
- A gateway das Edge Functions NÃO valida JWT (API keys novas), então a
  autenticação é conferida **na função**: `usuarioAutenticado()` em
  `_shared/comum.ts:39-51` (bate no `/auth/v1/user`), chamada logo no início
  de `extrair/index.ts:32` e `reformular/index.ts:38`.

## 3. Rotas entregando dados por ID (IDOR)

**Status: OK — todo acesso por ID passa pelo RLS ou por `WITH CHECK`.**

Não há "rotas" próprias; o acesso é PostgREST + RPC. Cada caminho:

- **Leitura por ID** (`?id=eq.N`): a policy de SELECT exige dono, então ID de
  outro usuário devolve `[]` (provado no teste adversarial de variantes: B
  pediu a variante de A e recebeu vazio).
- **Escrita por ID**: `WITH CHECK` na cadeia de dono bloqueia inserir/alterar
  em recurso alheio (`opcoes_insert/update`, `revisoes_*`, `variantes_*`).
- **`atualizar_pergunta`** (`0016_editar_pergunta.sql`, SECURITY INVOKER): o
  SELECT inicial é filtrado por RLS (pergunta de outro nem aparece), e mover
  via `p_subdivisao_id` esbarra no `WITH CHECK` de `perguntas_update`
  (`0001_schema.sql:194-198`) — não dá para jogar a pergunta na matéria de
  outra pessoa. Testado: "B não edita pergunta de A" → 400.
- **`importar_prova_catalogo`** (SECURITY INVOKER): a cópia passa pelo RLS do
  chamador, então o usuário só grava na própria conta. `EXECUTE` para PUBLIC
  é inofensivo aqui porque a função não escala privilégio (é invoker).

## 4. Chaves expostas no código (hardcode)

**Status: OK — só a chave pública-por-design está no front.**

- `web/js/config.js:7` — `anonKey: 'sb_publishable_...'`. É **pública por
  design**: a proteção vem do RLS, não do sigilo dela (documentado no próprio
  arquivo, linhas 2-6). Toda instalação Supabase expõe a anon key no front.
- Auditoria `git grep` no `web/`: **zero** ocorrência de `sb_secret_`,
  `service_role` ou `SUPABASE_DB_PASSWORD`.
- Segredos reais só em `.env` (git-ignorado — confirmado por
  `git check-ignore`) e em `supabase secrets`. `.env.example` tem só
  placeholders vazios.
- Único arquivo versionado que cita "sb_secret_" é `CLAUDE.md`, e é como
  **nome de conceito**, não valor.

## 5. Inputs sem tratamento (XSS)

**Status: OK — todo dado dinâmico é escapado, e a CSP é a 2ª barreira.**

- `esc()` (`core.js:771-776`) escapa `& < > " '`. Todo texto de usuário
  injetado via `innerHTML` passa por ele — auditado nos 39 pontos de
  `innerHTML`; as interpolações sem `esc()` são numéricas/booleanas
  (contadores, ids em atributo, flags).
- Markdown restrito (`formatarTexto`, `core.js:423-425`) **escapa ANTES de
  formatar** (`esc(texto).split('\n')`), então tag em enunciado/verso vira
  texto literal, nunca HTML.
- Menu da engrenagem: rótulos passam por `esc()` (`renderMenuItemHTML`,
  `core.js`); testado com `<img onerror>` → escapado.
- Imagens de prova: `renderImagensPergunta` (`core.js`) descarta URL fora do
  Storage do projeto.
- **CSP** via `<meta>` (`index.html`): `default-src 'self'`, `script-src`
  sem `unsafe-inline`, `object-src 'none'`, `base-uri 'self'`,
  `connect-src` restrito ao host do Supabase. Zero handler inline
  (`onclick=` etc.) — auditado: 0 ocorrências. supabase-js pinado com SRI.

---

## Pentest grey-box (2026-08-19)

Bateria de ataques ativos contra a **produção**, com usuários descartáveis,
sem DoS e sem tocar dados reais. **Resultado: 0 vulnerabilidades.**

| Vetor | Ataques | Resultado |
|---|---|---|
| **Anon** | ler 8 tabelas, criar matéria, chamar 4 RPCs sem login | tudo 401/404 |
| **IDOR leitura** | B lê materias/subdivisoes/perguntas/opcoes/revisoes/variantes/perfil de A | tudo `[]` |
| **IDOR escrita** | B altera/apaga pergunta de A; injeta opção/variante; `registrar_resposta` e `atualizar_pergunta` na pergunta de A | tudo 400/403, dado de A intacto |
| **Escalonamento** | B eleva `ia_limite_diario`; zera contador de quota; escreve no catálogo; forja `usuario_id` de A; INSERT em `perfis` c/ limite alto | tudo 403 |
| **Burla de quota** | UPDATE nas 3 colunas de quota de `perfis` | 403 (grant por coluna) — impossível resetar |
| **Edge Functions** | `reformular`/`extrair` sem auth; token forjado; CORS de `evil.example.com` | 401 / 401 / sem `Allow-Origin` |
| **Injeção** | `' OR 1=1--`, `; drop table`, `id=gt.0`, `like.*` no filtro; 500 alternativas na RPC | 403 ou 0 linhas; RPC barra em 400 |
| **XSS armazenado** | `<img onerror>` gravado como enunciado | aceito cru, mas render escapa (`esc`/`formatarTexto`) — sem sink de HTML |

Notas:
- `consumir_quota_ia` aceita `p_limite` do cliente, mas chamá-la direto só
  **incrementa** o próprio contador (auto-dano) — não reseta e não altera o
  limite que a Edge Function usa (ela passa o próprio, do secret). Sem bypass.
- Não é pentest de infra Supabase nem de rede — é de aplicação (authz/RLS/
  IDOR/quota/JWT/CORS/injeção). Reexecutar após mudança de policy/função.

## Regras para código novo (checklist obrigatório)

Toda adição de feature deve preservar as 5 barreiras acima:

1. **Tabela nova** → `enable row level security` + policies de dono com
   `WITH CHECK` em INSERT/UPDATE + `revoke all from anon` +
   `revoke truncate, trigger, references from authenticated`. (O event
   trigger liga RLS sozinho, mas as **policies** são por sua conta — sem
   elas, RLS ligado = ninguém acessa.)
2. **Nunca** decidir autorização no JS. O cliente pede; o RLS filtra. Se
   precisar de lógica privilegiada, use função `SECURITY DEFINER` com
   `SET search_path = ''` e valide `auth.uid()` dentro.
3. **Acesso por ID** já é coberto pelo RLS — mas confira que a policy de
   escrita tem `WITH CHECK`, não só `USING`, senão dá para escrever em
   recurso alheio. Re-rode o teste adversarial (usuário B vs dados de A).
4. **Segredo novo** → só em `.env` (git-ignored) e/ou `supabase secrets`.
   Nunca em `web/`. Só a anon key pode estar no front.
5. **Todo dado dinâmico no innerHTML** passa por `esc()`, ou por
   `formatarTexto()` se aceitar markdown. Nunca concatenar HTML de dado cru.
   Nada de `onclick=` inline (CSP bloqueia) — usar `addEventListener`.
6. **Edge Function nova** → `usuarioAutenticado()` no topo, CORS via
   `corsHeaders` (allowlist, nunca `*`), quota consumida ANTES de chamar
   provedor externo, limites de tamanho de entrada validados na função.
7. **RPC de escrita nova** → validar limites de tamanho/quantidade DENTRO da
   função (o cliente é contornável via PostgREST direto).
