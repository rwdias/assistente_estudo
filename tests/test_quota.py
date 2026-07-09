from datetime import date, timedelta

from src.auth import registrar_usuario
from src.database import Usuario, get_session, verificar_e_incrementar_quota_ia


def test_quota_bloqueia_apos_limite_diario():
    usuario = registrar_usuario("quota-teste-1@example.com", "senhacorreta123")
    limite = 3

    for _ in range(limite):
        assert verificar_e_incrementar_quota_ia(usuario.id, limite) is True

    assert verificar_e_incrementar_quota_ia(usuario.id, limite) is False


def test_quota_reinicia_em_novo_dia():
    usuario = registrar_usuario("quota-teste-2@example.com", "senhacorreta123")
    limite = 2

    for _ in range(limite):
        assert verificar_e_incrementar_quota_ia(usuario.id, limite) is True
    assert verificar_e_incrementar_quota_ia(usuario.id, limite) is False

    # simula que a última contagem foi ontem
    session = get_session()
    try:
        registro = session.query(Usuario).filter(Usuario.id == usuario.id).first()
        registro.ia_chamadas_data = date.today() - timedelta(days=1)
        session.commit()
    finally:
        session.close()

    assert verificar_e_incrementar_quota_ia(usuario.id, limite) is True
