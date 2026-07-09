from fastapi import APIRouter, Depends, HTTPException, status

from src.api.deps import get_usuario_atual, verificar_quota_ia
from src.api.schemas import (
    ExtrairRequest,
    PerguntaExtraidaSchema,
    SalvarExtracaoRequest,
    SalvarExtracaoResponse,
)
from src.database import (
    Usuario,
    buscar_materia_por_id,
    buscar_ou_criar_subdivisao,
    listar_perguntas_por_materia,
    salvar_pergunta_json,
    validar_pergunta_json,
)
from src.llm.base import LLMProviderError
from src.llm.factory import get_provider

router = APIRouter(prefix="/api/ia", tags=["ia"])


@router.post("/extrair", response_model=list[PerguntaExtraidaSchema])
def extrair(
    dados: ExtrairRequest,
    usuario: Usuario = Depends(get_usuario_atual),
) -> list[PerguntaExtraidaSchema]:
    materia = buscar_materia_por_id(usuario.id, dados.materia_id)

    if materia is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Matéria não encontrada.")

    verificar_quota_ia(usuario)

    try:
        provider = get_provider(dados.modelo)
        perguntas_extraidas = provider.extract_questions(
            raw_text=dados.texto,
            assunto=materia.nome,
            dificuldade_padrao=dados.dificuldade_padrao,
            max_perguntas=60,
        )
    except LLMProviderError as erro:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(erro)) from erro

    return [PerguntaExtraidaSchema(**pergunta) for pergunta in perguntas_extraidas]


@router.post("/salvar", response_model=SalvarExtracaoResponse)
def salvar(
    dados: SalvarExtracaoRequest,
    usuario: Usuario = Depends(get_usuario_atual),
) -> SalvarExtracaoResponse:
    materia = buscar_materia_por_id(usuario.id, dados.materia_id)

    if materia is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Matéria não encontrada.")

    subdivisao_geral = buscar_ou_criar_subdivisao(materia.id)
    enunciados_existentes = {
        p.enunciado.strip().lower() for p in listar_perguntas_por_materia(materia.id)
    }

    salvas = duplicadas = invalidas = 0

    for pergunta in dados.perguntas:
        pergunta_dict = pergunta.model_dump()

        try:
            validar_pergunta_json(pergunta_dict)
        except ValueError:
            invalidas += 1
            continue

        enunciado_normalizado = pergunta_dict["enunciado"].strip().lower()

        if enunciado_normalizado in enunciados_existentes:
            duplicadas += 1
            continue

        topico = pergunta_dict.get("topico")
        subdivisao_destino = (
            buscar_ou_criar_subdivisao(materia.id, topico)
            if topico
            else subdivisao_geral
        )

        salvar_pergunta_json(
            subdivisao_id=subdivisao_destino.id,
            dados=pergunta_dict,
            origem="llm",
        )

        salvas += 1
        enunciados_existentes.add(enunciado_normalizado)

    return SalvarExtracaoResponse(
        salvas=salvas, duplicadas=duplicadas, invalidas=invalidas
    )
