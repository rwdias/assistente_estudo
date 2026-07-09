from fastapi import APIRouter, Depends, HTTPException, status

from src.api.deps import get_usuario_atual
from src.api.schemas import (
    CadastroRequest,
    LoginRequest,
    TokenResponse,
    UsuarioResponse,
)
from src.auth import (
    AuthError,
    autenticar_usuario,
    criar_token_acesso,
    registrar_usuario,
)
from src.database import Usuario

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/cadastro", response_model=TokenResponse)
def cadastro(dados: CadastroRequest) -> TokenResponse:
    try:
        usuario = registrar_usuario(dados.email, dados.senha)
    except AuthError as erro:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(erro)) from erro

    return TokenResponse(access_token=criar_token_acesso(usuario.id))


@router.post("/login", response_model=TokenResponse)
def login(dados: LoginRequest) -> TokenResponse:
    try:
        usuario = autenticar_usuario(dados.email, dados.senha)
    except AuthError as erro:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(erro)) from erro

    return TokenResponse(access_token=criar_token_acesso(usuario.id))


@router.get("/me", response_model=UsuarioResponse)
def me(usuario: Usuario = Depends(get_usuario_atual)) -> UsuarioResponse:
    return UsuarioResponse(id=usuario.id, email=usuario.email)
