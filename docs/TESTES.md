# Plano de testes (pytest) — Study Rats

> Hoje a validação é por scripts Playwright avulsos no scratchpad da sessão (somem).
> Este plano transforma isso numa suíte **pytest** versionada. Objetivo: rodar
> `pytest` antes de cada mudança de banco/função/Edge e pegar regressão de SM-2,
> RLS e contrato das Edge Functions **sem depender de teste manual**.

## Por que pytest num projeto 100% serverless

Não há backend Python para testar — mas há **muita lógica testável fora do front**:

| Camada | O que testar | Como |
|---|---|---|
| **Funções SQL** (regras de negócio) | `registrar_resposta` (SM-2), dias úteis, `resumo_materias`, `consumir_quota_ia`, `atualizar_pergunta`, `importar_prova_catalogo`, dedupe de tópico | REST `/rpc/` com JWT de usuário descartável (respeita RLS), ou psycopg no pooler p/ setup |
| **Segurança / RLS** | usuário B contra dados de A, `anon` sem nada, IDOR (leitura E escrita), grant por coluna da quota, hardening de tabela nova | REST com 2 usuários + chave anon, asserções de negação |
| **Edge Functions — contrato** | 401 sem auth, CORS restrito, validação de entrada, 429 de quota | HTTP direto (sem gastar IA) |
| **Edge Functions — IA** (opt-in) | reuso de tópico, forma do structured output, `verificacao` de math | HTTP que chama o provedor (custa quota/tokens) |
| **Avaliadores determinísticos** (`Calc`/`Logica`/`conferir`) | aritmética, lógica proposicional, conferência ✓/⚠ | `subprocess` chamando `node` sobre os `.js` |
| **Fluxos de UI** | ocultar/excluir, estudar lista, undo de flashcard, confirmar + 4 estados | Playwright (Python) contra `web/` servido |

## Isolamento e segurança dos testes (inegociável)

- **Usuário descartável por teste**, criado via Admin API (`service_role`) e
  **removido no teardown** (delete escopado pelo uid → cascade limpa tudo).
  **Nunca** usar a conta real do dono (`rafaelmp.cwb@gmail.com`).
- Alvo de execução: **projeto Supabase de produção** (é o único ambiente) — o
  isolamento vem do usuário descartável, não de um banco separado. Testes que
  precisam de setup com service key (bypassa RLS) devem escrever **só** dentro do
  usuário descartável.
- **Segredos** vêm do `.env` (git-ignorado). **Nunca** imprimir valores do `.env`
  em asserção, log ou mensagem de erro.
- Marcar como `ai`/`e2e`/`slow` tudo que custa dinheiro ou é lento, para o padrão
  (`pytest`) rodar só o barato e determinístico.
- **Free tier pausa o projeto após ~1 semana sem uso** — reativar no painel antes
  de rodar a suíte se estiver dormindo.

## Estrutura

```
tests/
  conftest.py              # fixtures: config, clientes HTTP, usuário descartável, factories
  helpers.py               # Admin API, login, wrappers REST/RPC
  test_srs.py              # registrar_resposta: SM-2 binário, 4 níveis, dias úteis, lapso
  test_functions.py        # resumo_materias, consumir_quota_ia, atualizar_pergunta, catálogo, tópicos
  test_rls.py              # matriz adversarial (B×A, anon, IDOR, quota por coluna)
  test_edge_contract.py    # extrair/reformular/saber_mais: auth, CORS, validação, quota (sem IA)
  test_edge_ai.py          # @pytest.mark.ai — reuso de tópico, schema, verificacao
  test_evaluators.py       # Calc/Logica/conferir via node
  e2e/
    test_ocultar.py        # @pytest.mark.e2e — ocultar/reexibir/excluir + some da revisão
    test_listas.py         # criar lista + estudar (revelar/auto-avaliar/conferência)
    test_flashcards.py     # undo (Backspace), 4 níveis
    test_perguntas.py      # confirmar antes de responder, 4 estados, embaralhamento
pytest.ini                 # markers + addopts
```

## Fixtures (esboço de `conftest.py`)

```python
import os, uuid, requests, pytest

URL = "https://scafgcpxjsimzaaviean.supabase.co"

@pytest.fixture(scope="session")
def env():
    e = {}
    for l in open(".env"):
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1); e[k] = v
    return e  # NUNCA logar/printar valores daqui

@pytest.fixture(scope="session")
def anon_key():
    # chave publicável do front (web/js/config.js) — pública por design
    return "sb_publishable_..."

@pytest.fixture
def usuario(env):
    """Usuário descartável: cria via Admin API, entrega (uid, token, headers),
    e REMOVE no teardown (cascade limpa os dados)."""
    sk = env["SUPABASE_SERVICE_ROLE_KEY"]
    admin = {"apikey": sk, "Authorization": f"Bearer {sk}", "Content-Type": "application/json"}
    email, senha = f"t-{uuid.uuid4().hex[:8]}@x.com", "SenhaTeste123!"
    uid = requests.post(f"{URL}/auth/v1/admin/users", headers=admin, json={
        "email": email, "password": senha, "email_confirm": True,
        "user_metadata": {"nome": "T", "objetivo": "t", "nascimento": "2000-01-01"}}).json()["id"]
    tok = requests.post(f"{URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON, "Content-Type": "application/json"},
        json={"email": email, "password": senha}).json()["access_token"]
    h = {"apikey": ANON, "Authorization": f"Bearer {tok}", "Content-Type": "application/json",
         "Prefer": "return=representation"}
    yield {"uid": uid, "token": tok, "headers": h}
    requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=admin)  # teardown

@pytest.fixture
def materia(usuario):
    """Cria matéria + subdivisão 'Geral' do usuário; devolve helpers de factory."""
    ...  # post materias/subdivisoes; retorna ids + função criar_pergunta(...)
```

`pytest.ini`:

```ini
[pytest]
markers =
    db: toca funções SQL / dados (usuário descartável)
    rls: testes adversariais de segurança
    edge: contrato das Edge Functions (sem IA)
    ai: chama provedor de IA (custa quota/tokens) — opt-in
    e2e: Playwright, lento — opt-in
addopts = -m "not ai and not e2e" -q
```

Rodar seletivo: `pytest -m rls` · `pytest -m ai` · `pytest -m e2e` · `pytest` (só o barato).

## O que testar, por camada (casos concretos)

### 1. SM-2 — `test_srs.py` (prioridade máxima)
A peça mais crítica e a que mais quebra em silêncio. Como o baseline antigo
(`src/srs.py`) foi removido, os testes fixam **valores-ouro** (golden):

- **Progressão binária**: novo → acerto vira intervalo 1; 1 → 6; 6 → `round(6×EF)`.
- **Erro**: zera intervalo, reagenda +10min (tempo corrido), EF cai com piso 1.3.
- **4 níveis (flashcard)** via `p_qualidade`: De novo (lapso) · Difícil (< Bom, EF↓)
  · Bom (progressão canônica, EF estável) · Fácil (Bom×1.3, EF↑; card novo pula p/ 4 dias).
- **Equivalência**: chamar sem `p_qualidade` = binário idêntico (matriz de estados).
- **Dias úteis** (0019): a **data** da próxima revisão pula sáb/dom e feriados
  nacionais (fixos + móveis via Páscoa); o **número** do intervalo NÃO muda. Casos:
  acerto na sexta, véspera de feriado, Carnaval/Corpus Christi.
- **Espelho no cliente**: portar o teste de `preverIntervalos` (matriz intervalo ×
  EF × qualidade) para `test_evaluators.py` (via node) — ele deve bater com o
  número do banco.

### 2. Outras funções — `test_functions.py`
- `resumo_materias`: contadores por tipo; **exclui `exercicio`** da fila (0023);
  devolve `tipo` da matéria (0021).
- `consumir_quota_ia`: decrementa antes do provedor; bloqueia no limite; override
  por `perfis.ia_limite_diario`; reset diário.
- `atualizar_pergunta`: troca de alternativas é apagar+inserir atômico; **descarta
  variantes quando o conteúdo muda**, mantém quando muda só o tópico.
- `importar_prova_catalogo`: idempotente por enunciado; cópia passa pelo RLS do
  usuário (INVOKER); copia URL de imagem, não o arquivo.
- **Dedupe de tópico** (core.js `garantirSubdivisao` + `blocoTopico`): "S3"/"s3"
  não duplicam; ingestão reutiliza tópico existente (este último é `ai`).

### 3. Segurança / RLS — `test_rls.py` (rodar após QUALQUER mudança de policy/função)
Matriz adversarial — todas devem **negar**:
- Usuário **B** lê/edita/apaga matéria, pergunta, opção, revisão, variante, lista,
  exercício de **A** → 0 linhas / erro.
- **anon** (só a chave publicável) não acessa nada.
- IDOR de **escrita**: B tenta inserir pergunta em subdivisão de A (WITH CHECK).
- **Quota**: usuário comum não consegue `UPDATE perfis.ia_limite_diario`
  (grant por coluna) nem furar a quota chamando a função direto.
- **Catálogo**: `authenticated` lê `catalogo_*`, mas não tem escrita.
- **Regressão de hardening**: toda tabela nova precisa repetir o padrão de 0012 —
  um teste que varre `information_schema` e falha se `anon` ganhou algum privilégio.

### 4. Edge Functions — contrato, sem IA — `test_edge_contract.py`
- `extrair`/`reformular`/`saber_mais` **sem** `Authorization` → 401.
- CORS: `Origin` fora do Pages → sem cabeçalho permissivo.
- Validação: texto vazio / grande demais / tipo inválido → 400.
- Quota: esgotar `ia_limite_diario` e checar 429 (dá para forçar setando o limite
  baixo via service key no usuário descartável, sem chamar o provedor).

### 5. Edge Functions — IA, opt-in — `test_edge_ai.py` (`@pytest.mark.ai`)
Poucos, caros, tolerantes a variação:
- `extrair` com `topicos_existentes=["S3","IAM"]` + texto sobre "S3 versioning" →
  `topico` volta "S3"/"IAM" (reuso) e novo serviço no nível de serviço.
- Forma do structured output: campos obrigatórios presentes, `opcoes` com ≥1 correta.
- Math: `verificacoes` por subitem com `tipo` válido; tradução vira `tipo:"nenhuma"`.

### 6. Avaliadores — `test_evaluators.py`
`subprocess` rodando `node` sobre `web/js/{calculo,logica,conferir}.js`:
- `Calc`: precedência (`-5^2 = -25`), `\frac`/`\sqrt`/`^{}`, tolerância p/ irracionais.
- `Logica`: `¬∧∨→↔`, tabela-verdade, resolver incógnitas por enumeração.
- `conferir`: ✓ quando bate, ⚠ quando IA≠código (caso real da lista de lógica).

### 7. E2E — `tests/e2e/` (`@pytest.mark.e2e`)
Playwright contra `web/` servido em `:8001` (origem já liberada no CORS), login
via `#ld-entrar` → `#form-login`. Afastar o mouse (`page.mouse.move(700,400)`)
após navegar (a sidebar em hover intercepta clique).
- **Ocultar/excluir**: ocultar some da revisão + badge; reexibir; excluir via modal.
- **Lista**: criar por IA (`ai`), estudar (revelar + gabarito + conferência + auto-avaliar).
- **Flashcard**: undo com Backspace restaura fila + SM-2; 4 níveis.
- **Pergunta**: confirmar antes de responder, 4 estados de resultado, embaralhamento.

## CI (GitHub Actions) — proposta

- **Em push que toca `supabase/**`**: roda `pytest -m "db or rls or edge"` +
  `test_evaluators.py` (rápidos, determinísticos, sem IA). Segredos via
  `secrets` do repositório (service key, senha do pooler, anon key).
- **Manual / agendado (semanal)**: `pytest -m ai` e `pytest -m e2e` (custam
  tokens e são lentos; o agendamento também serve para **não deixar o free tier
  pausar**).
- Caveat: o runner precisa de IPv4 → usar o **pooler** para psycopg
  (`aws-1-sa-east-1.pooler.supabase.com`), não o host direto (IPv6-only).

## Rollout em fases

1. **Fundação + SM-2 + RLS** — `conftest.py`, `helpers.py`, `test_srs.py`,
   `test_rls.py`. É o maior retorno: as duas coisas que, se quebrarem, corrompem
   dados/segurança em silêncio.
2. **Funções + contrato Edge** — `test_functions.py`, `test_edge_contract.py`.
3. **Avaliadores** — `test_evaluators.py` (rápido, alto valor p/ o modo math).
4. **CI** dos rápidos no push.
5. **E2E + IA** (opt-in) — portar os scripts de sessão (ocultar, lista) para
   `tests/e2e/`; smoke de IA agendado.

## Convenções

- Todo teste que escreve dados usa a fixture `usuario`/`materia` (limpeza garantida
  no `yield`/teardown).
- Asserções de RLS afirmam **negação** (0 linhas ou erro), não só "não deu 200".
- Testes de IA são tolerantes (afirmam forma/propriedade, não texto exato).
- Reexecutar `pytest -m rls` **sempre** após mudar policy ou função SQL.
