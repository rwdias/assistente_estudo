import os
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from src.database import Usuario, buscar_usuario_por_email, criar_usuario

ALGORITMO_JWT = "HS256"
SENHA_MAX_BYTES = 72  # limite nativo do bcrypt


class AuthError(Exception):
    """Erro de autenticação: e-mail já cadastrado, credenciais inválidas ou
    token JWT ausente/expirado/inválido."""


def _chave_secreta() -> str:
    chave = os.environ.get("JWT_SECRET_KEY")

    if not chave:
        raise AuthError(
            "Defina JWT_SECRET_KEY no arquivo .env para habilitar autenticação."
        )

    return chave


def _minutos_expiracao() -> int:
    return int(os.environ.get("JWT_EXPIRE_MINUTES", "10080"))


def hash_senha(senha: str) -> str:
    if len(senha.encode("utf-8")) > SENHA_MAX_BYTES:
        raise AuthError("A senha não pode ter mais de 72 caracteres.")

    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verificar_senha(senha: str, senha_hash: str) -> bool:
    if len(senha.encode("utf-8")) > SENHA_MAX_BYTES:
        return False

    return bcrypt.checkpw(senha.encode("utf-8"), senha_hash.encode("utf-8"))


def registrar_usuario(email: str, senha: str) -> Usuario:
    email_normalizado = email.strip().lower()

    if not email_normalizado or "@" not in email_normalizado:
        raise AuthError("Informe um e-mail válido.")

    if len(senha) < 8:
        raise AuthError("A senha precisa ter pelo menos 8 caracteres.")

    if buscar_usuario_por_email(email_normalizado) is not None:
        raise AuthError("Já existe uma conta com esse e-mail.")

    return criar_usuario(email_normalizado, hash_senha(senha))


def autenticar_usuario(email: str, senha: str) -> Usuario:
    usuario = buscar_usuario_por_email(email)

    if usuario is None or not verificar_senha(senha, usuario.senha_hash):
        raise AuthError("E-mail ou senha inválidos.")

    return usuario


def criar_token_acesso(usuario_id: int) -> str:
    agora = datetime.now(timezone.utc)
    payload = {
        "sub": str(usuario_id),
        "iat": agora,
        "exp": agora + timedelta(minutes=_minutos_expiracao()),
    }

    return jwt.encode(payload, _chave_secreta(), algorithm=ALGORITMO_JWT)


def usuario_id_do_token(token: str) -> int:
    try:
        payload = jwt.decode(token, _chave_secreta(), algorithms=[ALGORITMO_JWT])
        return int(payload["sub"])

    except (JWTError, KeyError, ValueError) as erro:
        raise AuthError("Token inválido ou expirado.") from erro
