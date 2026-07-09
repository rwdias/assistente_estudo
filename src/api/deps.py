import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.auth import AuthError, usuario_id_do_token
from src.database import (
    Materia,
    Usuario,
    buscar_materia_por_id,
    buscar_usuario_por_id,
    verificar_e_incrementar_quota_ia,
)

_bearer = HTTPBearer(auto_error=False)


def get_usuario_atual(
    credenciais: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Usuario:
    if credenciais is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado.")

    try:
        usuario_id = usuario_id_do_token(credenciais.credentials)
    except AuthError as erro:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(erro)) from erro

    usuario = buscar_usuario_por_id(usuario_id)

    if usuario is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário não encontrado.")

    return usuario


def get_materia_do_usuario(
    materia_id: int,
    usuario: Usuario = Depends(get_usuario_atual),
) -> Materia:
    materia = buscar_materia_por_id(usuario.id, materia_id)

    if materia is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Matéria não encontrada.")

    return materia


def verificar_quota_ia(usuario: Usuario) -> None:
    """
    Verifica e consome uma chamada da quota diária de IA do usuário.
    Levanta 429 se o limite (IA_QUOTA_DIARIA, padrão 20/dia) já foi
    atingido — protege a chave de API do dono contra uso excessivo por
    visitantes públicos.
    """

    limite = int(os.environ.get("IA_QUOTA_DIARIA", "20"))

    if not verificar_e_incrementar_quota_ia(usuario.id, limite):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Limite diário de {limite} chamadas de IA atingido. "
            "Tente novamente amanhã.",
        )
