# Study Rats 🐭

Plataforma multi-usuário de estudo para certificações (AWS, Databricks, etc.):
simulados, repetição espaçada estilo Anki (SM-2) e ingestão de questões por IA
(ChatGPT, Claude ou Grok).

## Stack

- **Backend:** FastAPI + SQLAlchemy + SQLite, autenticação JWT (bcrypt),
  migrações com Alembic.
- **Frontend:** SPA em HTML/CSS/JS puro (sem build step), servida pelo próprio
  FastAPI, com tema claro/escuro.
- **IA:** extração e reformulação de questões via OpenAI, Anthropic ou xAI,
  com quota diária por usuário.

## Estrutura

```
├── src/
│   ├── api/            # FastAPI: main, deps (auth/quota), schemas, routers/
│   ├── llm/            # provedores de IA (interface única + 3 adapters)
│   ├── auth.py         # hash de senha, JWT
│   ├── database.py     # modelos SQLAlchemy + camada de persistência
│   └── srs.py          # algoritmo SM-2 + dificuldade pessoal (puro, sem DB)
├── web/                # SPA (index.html, css/, js/)
├── alembic/            # migrações de schema versionadas
├── tests/              # pytest (SRS, auth, isolamento entre usuários, quota)
├── docs/               # documentação de apoio
└── backups/            # backups locais do banco (fora do git)
```

## Como rodar

```bash
python -m venv venv
./venv/bin/pip install -e ".[dev]"

cp .env.example .env    # preencha as chaves (IA + JWT_SECRET_KEY)

./venv/bin/alembic upgrade head
./venv/bin/uvicorn src.api.main:app --port 8001
```

Abra <http://localhost:8001>, crie sua conta e comece.

### Variáveis de ambiente (`.env`)

| Variável | Para quê |
|---|---|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `XAI_API_KEY` | provedores de IA (preencha ao menos um) |
| `JWT_SECRET_KEY` | assinatura dos tokens de login (gere um valor próprio) |
| `IA_QUOTA_DIARIA` | chamadas de IA por usuário/dia (padrão 20) |

## Testes e lint

```bash
./venv/bin/python -m pytest
./venv/bin/ruff check src/ tests/
```
