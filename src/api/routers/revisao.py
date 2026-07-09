from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status

from src.api.deps import get_materia_do_usuario, get_usuario_atual, verificar_quota_ia
from src.api.routers.perguntas import serializar_pergunta
from src.api.schemas import (
    OpcaoResponse,
    PerguntaReformuladaResponse,
    PerguntaResponse,
    ReformularRequest,
)
from src.database import (
    Materia,
    Usuario,
    buscar_pergunta_por_id,
    listar_perguntas_para_revisao,
    pergunta_pertence_ao_usuario,
)
from src.llm.base import LLMProviderError, PerguntaExtraida
from src.llm.factory import get_provider

router = APIRouter(prefix="/api", tags=["revisao"])

# Cache em memória (processo único) da reformulação por (usuario, pergunta,
# dia) — evita chamar a IA de novo a cada reload da mesma pergunta no
# mesmo dia. Não sobrevive a um restart do servidor, o que é aceitável:
# na pior hipótese o usuário recebe uma nova reformulação (custa 1 chamada
# extra da quota), nunca perde dados.
_cache_reformulacao: dict[tuple[int, int, str], PerguntaExtraida] = {}


@router.get("/materias/{materia_id}/revisao", response_model=list[PerguntaResponse])
def listar_devidas(
    materia: Materia = Depends(get_materia_do_usuario),
) -> list[PerguntaResponse]:
    perguntas = listar_perguntas_para_revisao(materia_id=materia.id)
    return [serializar_pergunta(p) for p in perguntas]


@router.post(
    "/revisao/{pergunta_id}/reformular",
    response_model=PerguntaReformuladaResponse,
)
def reformular(
    pergunta_id: int,
    dados: ReformularRequest,
    usuario: Usuario = Depends(get_usuario_atual),
) -> PerguntaReformuladaResponse:
    if not pergunta_pertence_ao_usuario(usuario.id, pergunta_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pergunta não encontrada.")

    pergunta = buscar_pergunta_por_id(pergunta_id)

    chave_cache = (usuario.id, pergunta_id, date.today().isoformat())
    dados_reformulados = _cache_reformulacao.get(chave_cache)

    if dados_reformulados is None:
        verificar_quota_ia(usuario)

        try:
            provider = get_provider(dados.modelo)
            dados_reformulados = provider.reformulate_question(
                {
                    "enunciado": pergunta.enunciado,
                    "dificuldade": pergunta.dificuldade,
                    "opcoes": [
                        {"texto": opcao.texto, "correta": opcao.correta}
                        for opcao in pergunta.opcoes
                    ],
                    "topico": None,
                }
            )
        except LLMProviderError as erro:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(erro)) from erro

        _cache_reformulacao[chave_cache] = dados_reformulados

    return PerguntaReformuladaResponse(
        pergunta_id=pergunta.id,
        enunciado=dados_reformulados["enunciado"],
        opcoes=[
            OpcaoResponse(texto=opcao["texto"], correta=opcao["correta"])
            for opcao in dados_reformulados["opcoes"]
        ],
    )
