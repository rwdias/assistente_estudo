from fastapi import APIRouter, Depends, status

from src.api.deps import get_usuario_atual
from src.api.schemas import MateriaCreate, MateriaResponse
from src.database import (
    Usuario,
    buscar_ou_criar_materia,
    buscar_ou_criar_subdivisao,
    resumo_materias,
)

router = APIRouter(prefix="/api/materias", tags=["materias"])


@router.get("", response_model=list[MateriaResponse])
def listar(usuario: Usuario = Depends(get_usuario_atual)) -> list[MateriaResponse]:
    return [MateriaResponse(**resumo) for resumo in resumo_materias(usuario.id)]


@router.post("", response_model=MateriaResponse, status_code=status.HTTP_201_CREATED)
def criar(
    dados: MateriaCreate,
    usuario: Usuario = Depends(get_usuario_atual),
) -> MateriaResponse:
    materia = buscar_ou_criar_materia(usuario.id, dados.nome)
    buscar_ou_criar_subdivisao(materia.id)  # garante a subdivisão "Geral"

    resumo = next(
        (r for r in resumo_materias(usuario.id) if r["id"] == materia.id),
        {"id": materia.id, "nome": materia.nome},
    )

    return MateriaResponse(**resumo)
