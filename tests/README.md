# Suíte de testes (pytest)

Plano completo e estratégia em [`docs/TESTES.md`](../docs/TESTES.md).

## Rodar

```bash
venv/bin/pip install -r tests/requirements-dev.txt   # primeira vez
venv/bin/python3 -m pytest              # rápidos e determinísticos (db + rls)
venv/bin/python3 -m pytest -m rls       # só segurança (após mudar policy/função)
venv/bin/python3 -m pytest -m ai        # chama IA (custa quota) — opt-in
venv/bin/python3 -m pytest -m e2e       # Playwright — opt-in
```

Roda contra o Supabase de **produção** usando **usuários descartáveis** criados
via Admin API e removidos no teardown (cascade). Precisa do `.env` na raiz
(`SUPABASE_SERVICE_ROLE_KEY` etc.) — nunca commitado, nunca impresso.

## Já implementado (fase 1)

- `test_srs.py` — SM-2 (`registrar_resposta`): progressão 1→6→round(i×EF), erro,
  piso do EF, 4 níveis do flashcard, equivalência binário, dias úteis.
- `test_rls.py` — adversarial: B×A (leitura/escrita), anon, IDOR de escrita,
  grant por coluna da quota.

## A fazer (ver docs/TESTES.md)

`test_functions.py` · `test_edge_contract.py` · `test_edge_ai.py` (ai) ·
`test_evaluators.py` (Calc/Logica via node) · `tests/e2e/` (ocultar, listas,
flashcards) · CI no GitHub Actions.
