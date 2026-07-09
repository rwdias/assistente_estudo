from fastapi import APIRouter, Depends, HTTPException, status

from src.api.deps import get_materia_do_usuario, get_usuario_atual
from src.api.routers.perguntas import serializar_pergunta
from src.api.schemas import PerguntaResponse, ResponderRequest, ResponderResponse
from src.database import (
    Materia,
    Usuario,
    buscar_pergunta_por_id,
    listar_perguntas_para_simulado,
    pergunta_pertence_ao_usuario,
    registrar_resposta,
)
from src.srs import dificuldade_pessoal

router = APIRouter(prefix="/api", tags=["simulado"])


@router.get("/materias/{materia_id}/simulado", response_model=list[PerguntaResponse])
def montar_simulado(
    materia: Materia = Depends(get_materia_do_usuario),
    dificuldade: str | None = None,
    quantidade: int | None = None,
    embaralhar: bool = False,
) -> list[PerguntaResponse]:
    perguntas = listar_perguntas_para_simulado(
        materia.id,
        dificuldade=dificuldade,
        quantidade=quantidade,
        embaralhar=embaralhar,
    )

    return [serializar_pergunta(p) for p in perguntas]


@router.post("/perguntas/{pergunta_id}/responder", response_model=ResponderResponse)
def responder(
    pergunta_id: int,
    dados: ResponderRequest,
    usuario: Usuario = Depends(get_usuario_atual),
) -> ResponderResponse:
    if not pergunta_pertence_ao_usuario(usuario.id, pergunta_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pergunta não encontrada.")

    revisao = registrar_resposta(pergunta_id, dados.correta)
    pergunta = buscar_pergunta_por_id(pergunta_id)

    pessoal = dificuldade_pessoal(
        dificuldade_estatica=pergunta.dificuldade,
        vezes_respondida=revisao.vezes_respondida,
        vezes_acertada=revisao.vezes_acertada,
        ultima_resposta_correta=revisao.ultima_resposta_correta,
    )

    return ResponderResponse(
        intervalo_dias=revisao.intervalo_dias,
        proxima_revisao_em=revisao.proxima_revisao_em,
        dificuldade_pessoal=pessoal,
    )
