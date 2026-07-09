from fastapi import APIRouter, Depends, HTTPException, status

from src.api.deps import get_materia_do_usuario, get_usuario_atual
from src.api.schemas import OpcaoResponse, PerguntaCreate, PerguntaResponse
from src.database import (
    Materia,
    Pergunta,
    Usuario,
    buscar_ou_criar_subdivisao,
    deletar_pergunta,
    listar_perguntas_por_materia,
    pergunta_pertence_ao_usuario,
    salvar_pergunta,
)
from src.srs import dificuldade_pessoal, pergunta_esta_madura

router = APIRouter(prefix="/api", tags=["perguntas"])


def serializar_pergunta(pergunta: Pergunta) -> PerguntaResponse:
    revisao = pergunta.revisao

    vezes_respondida = revisao.vezes_respondida if revisao else 0
    vezes_acertada = revisao.vezes_acertada if revisao else 0
    ultima_correta = revisao.ultima_resposta_correta if revisao else None
    intervalo_dias = revisao.intervalo_dias if revisao else 0

    return PerguntaResponse(
        id=pergunta.id,
        enunciado=pergunta.enunciado,
        dificuldade=pergunta.dificuldade,
        dificuldade_pessoal=dificuldade_pessoal(
            dificuldade_estatica=pergunta.dificuldade,
            vezes_respondida=vezes_respondida,
            vezes_acertada=vezes_acertada,
            ultima_resposta_correta=ultima_correta,
        ),
        origem=pergunta.origem,
        vezes_respondida=vezes_respondida,
        vezes_acertada=vezes_acertada,
        madura=pergunta_esta_madura(intervalo_dias),
        opcoes=[
            OpcaoResponse(texto=opcao.texto, correta=opcao.correta)
            for opcao in pergunta.opcoes
        ],
    )


@router.get("/materias/{materia_id}/perguntas", response_model=list[PerguntaResponse])
def listar(
    materia: Materia = Depends(get_materia_do_usuario),
) -> list[PerguntaResponse]:
    return [serializar_pergunta(p) for p in listar_perguntas_por_materia(materia.id)]


@router.post(
    "/materias/{materia_id}/perguntas",
    response_model=PerguntaResponse,
    status_code=status.HTTP_201_CREATED,
)
def criar(
    dados: PerguntaCreate,
    materia: Materia = Depends(get_materia_do_usuario),
) -> PerguntaResponse:
    subdivisao = buscar_ou_criar_subdivisao(materia.id)

    try:
        pergunta = salvar_pergunta(
            subdivisao_id=subdivisao.id,
            enunciado=dados.enunciado,
            opcoes=dados.opcoes,
            dificuldade=dados.dificuldade,
        )
    except ValueError as erro:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(erro)) from erro

    perguntas = listar_perguntas_por_materia(materia.id)
    pergunta_recarregada = next(p for p in perguntas if p.id == pergunta.id)

    return serializar_pergunta(pergunta_recarregada)


@router.delete("/perguntas/{pergunta_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar(pergunta_id: int, usuario: Usuario = Depends(get_usuario_atual)) -> None:
    if not pergunta_pertence_ao_usuario(usuario.id, pergunta_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pergunta não encontrada.")

    deletar_pergunta(pergunta_id)
