import os
import tempfile

# Precisa ser definido antes de qualquer import de src.database (que lê
# DATABASE_URL no nível de módulo) — por isso fica no topo do conftest,
# que o pytest carrega antes de coletar os módulos de teste.
_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db.name}"
os.environ.setdefault("JWT_SECRET_KEY", "chave-de-teste-nao-usar-em-producao")
os.environ.setdefault("IA_QUOTA_DIARIA", "3")

import pytest  # noqa: E402

from src.database import criar_tabelas  # noqa: E402

criar_tabelas()


@pytest.fixture
def cliente():
    from fastapi.testclient import TestClient

    from src.api.main import app

    return TestClient(app)
