"""Fixtures da suíte. Ver docs/TESTES.md para o plano completo.

Toda escrita de dados acontece dentro de um USUÁRIO DESCARTÁVEL, removido no
teardown (delete escopado pelo uid → cascade limpa matérias/perguntas/etc.).
"""
import pytest

from helpers import Admin, Cliente, carregar_env, config_front


@pytest.fixture(scope="session")
def env():
    return carregar_env()  # NUNCA imprimir valores daqui


@pytest.fixture(scope="session")
def front():
    """(url, anon_key) lidos de web/js/config.js."""
    return config_front()


@pytest.fixture(scope="session")
def admin(env, front):
    url, _ = front
    return Admin(url, env["SUPABASE_SERVICE_ROLE_KEY"])


@pytest.fixture
def criar_usuario(admin, front):
    """Factory: cria usuários descartáveis e os REMOVE todos no teardown.

    Uso: `u = criar_usuario()` -> Cliente autenticado (respeita RLS).
    Chame quantas vezes precisar (ex.: usuário A e B para testes de RLS).
    """
    url, anon = front
    criados = []

    def _novo():
        u = admin.criar_usuario()
        token = admin.token(u["email"], u["senha"], anon)
        cli = Cliente(url, anon, token)
        cli.uid = u["uid"]
        criados.append(u["uid"])
        return cli

    yield _novo

    for uid in criados:
        admin.deletar_usuario(uid)


@pytest.fixture
def usuario(criar_usuario):
    """Um único usuário descartável autenticado."""
    return criar_usuario()


@pytest.fixture
def anon(front):
    """Cliente sem token (papel 'anon' — deve ser barrado pelo RLS)."""
    url, anon_key = front
    return Cliente(url, anon_key, token=None)


@pytest.fixture
def materia(usuario):
    """Cria uma matéria + subdivisão 'Geral' do `usuario` e devolve um objeto
    com ids e factories (criar_pergunta / criar_flashcard) já ligados a ele."""
    return _MateriaFactory(usuario)


class _MateriaFactory:
    def __init__(self, cli, nome="Teste", tipo="normal"):
        self.cli = cli
        m = cli.post("materias", {"usuario_id": cli.uid, "nome": nome, "tipo": tipo})
        m.raise_for_status()
        self.materia_id = m.json()[0]["id"]
        s = cli.post("subdivisoes", {"materia_id": self.materia_id, "nome": "Geral"})
        s.raise_for_status()
        self.subdivisao_id = s.json()[0]["id"]

    def criar_pergunta(self, enunciado="Pergunta?", dificuldade="Média"):
        """Cria pergunta de múltipla escolha + 2 opções + linha SM-2 zerada.
        Devolve o id da pergunta."""
        p = self.cli.post("perguntas", {
            "subdivisao_id": self.subdivisao_id, "tipo": "pergunta",
            "enunciado": enunciado, "dificuldade": dificuldade, "origem": "manual",
        })
        p.raise_for_status()
        pid = p.json()[0]["id"]
        self.cli.post("opcoes", [
            {"pergunta_id": pid, "texto": "certa", "correta": True, "ordem": 0},
            {"pergunta_id": pid, "texto": "errada", "correta": False, "ordem": 1},
        ])
        self.cli.post("revisoes_perguntas", {"pergunta_id": pid})
        return pid

    def criar_flashcard(self, frente="Frente?", verso="Verso"):
        p = self.cli.post("perguntas", {
            "subdivisao_id": self.subdivisao_id, "tipo": "flashcard",
            "enunciado": frente, "verso": verso, "dificuldade": "Média", "origem": "manual",
        })
        p.raise_for_status()
        pid = p.json()[0]["id"]
        self.cli.post("revisoes_perguntas", {"pergunta_id": pid})
        return pid

    def revisao(self, pid):
        """Estado SM-2 atual da pergunta (via RLS do próprio usuário)."""
        r = self.cli.get("revisoes_perguntas", f"?pergunta_id=eq.{pid}&select=*")
        r.raise_for_status()
        return r.json()[0]
