import pytest

from src.auth import (
    AuthError,
    autenticar_usuario,
    criar_token_acesso,
    hash_senha,
    registrar_usuario,
    usuario_id_do_token,
    verificar_senha,
)


def test_hash_senha_roundtrip():
    senha_hash = hash_senha("minhasenha123")

    assert verificar_senha("minhasenha123", senha_hash)
    assert not verificar_senha("senhaerrada", senha_hash)


def test_registrar_usuario_e_autenticar():
    usuario = registrar_usuario("auth-teste-1@example.com", "senhacorreta123")

    autenticado = autenticar_usuario("auth-teste-1@example.com", "senhacorreta123")
    assert autenticado.id == usuario.id


def test_autenticar_usuario_com_senha_errada_falha():
    registrar_usuario("auth-teste-2@example.com", "senhacorreta123")

    with pytest.raises(AuthError):
        autenticar_usuario("auth-teste-2@example.com", "senhaerrada")


def test_autenticar_usuario_inexistente_falha():
    with pytest.raises(AuthError):
        autenticar_usuario("nao-existe@example.com", "qualquer")


def test_registrar_usuario_com_email_duplicado_falha():
    registrar_usuario("auth-teste-3@example.com", "senhacorreta123")

    with pytest.raises(AuthError):
        registrar_usuario("auth-teste-3@example.com", "outrasenha123")


def test_registrar_usuario_com_senha_curta_falha():
    with pytest.raises(AuthError):
        registrar_usuario("auth-teste-4@example.com", "curta")


def test_token_roundtrip():
    usuario = registrar_usuario("auth-teste-5@example.com", "senhacorreta123")
    token = criar_token_acesso(usuario.id)

    assert usuario_id_do_token(token) == usuario.id


def test_token_invalido_levanta_autherror():
    with pytest.raises(AuthError):
        usuario_id_do_token("token-completamente-invalido")
