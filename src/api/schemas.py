from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

# --- auth ---


class CadastroRequest(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    senha: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UsuarioResponse(BaseModel):
    id: int
    email: str


# --- matérias ---


class MateriaCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=150)


class MateriaResponse(BaseModel):
    id: int
    nome: str
    total_perguntas: int = 0
    devidas_revisao: int = 0


# --- perguntas ---


class OpcaoResponse(BaseModel):
    texto: str
    correta: bool


class PerguntaCreate(BaseModel):
    enunciado: str = Field(min_length=1)
    # A primeira opção da lista é sempre a correta (mesma convenção de
    # src.database.salvar_pergunta).
    opcoes: list[str] = Field(min_length=2)
    dificuldade: str


class PerguntaResponse(BaseModel):
    id: int
    enunciado: str
    dificuldade: str
    dificuldade_pessoal: str
    origem: str | None
    vezes_respondida: int
    vezes_acertada: int
    madura: bool
    opcoes: list[OpcaoResponse]


class ResponderRequest(BaseModel):
    correta: bool


class ResponderResponse(BaseModel):
    intervalo_dias: int
    proxima_revisao_em: datetime | None
    dificuldade_pessoal: str


class PerguntaReformuladaResponse(BaseModel):
    # id da pergunta original — usado ao chamar /perguntas/{id}/responder,
    # já que o texto reformulado nunca é persistido no banco.
    pergunta_id: int
    enunciado: str
    opcoes: list[OpcaoResponse]


# --- ingestão via IA ---


class ExtrairRequest(BaseModel):
    materia_id: int
    modelo: str
    texto: str = Field(min_length=1)
    dificuldade_padrao: str = "Média"


class OpcaoExtraidaSchema(BaseModel):
    texto: str
    correta: bool


class PerguntaExtraidaSchema(BaseModel):
    enunciado: str
    dificuldade: str
    opcoes: list[OpcaoExtraidaSchema]
    topico: str | None = None


class SalvarExtracaoRequest(BaseModel):
    materia_id: int
    perguntas: list[PerguntaExtraidaSchema]


class SalvarExtracaoResponse(BaseModel):
    salvas: int
    duplicadas: int
    invalidas: int


class ReformularRequest(BaseModel):
    modelo: str
