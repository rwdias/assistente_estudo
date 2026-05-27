from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker


# =========================
# Configuração do banco
# =========================

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "assistente_estudo.db"

DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)

Base = declarative_base()


def agora_utc() -> datetime:
    return datetime.now(timezone.utc)


# =========================
# Tabelas
# =========================

class Materia(Base):
    __tablename__ = "materias"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(150), nullable=False, unique=True, index=True)
    descricao = Column(Text, nullable=True)
    created_at = Column(DateTime, default=agora_utc, nullable=False)
    updated_at = Column(DateTime, default=agora_utc, onupdate=agora_utc, nullable=False)

    subdivisoes = relationship(
        "Subdivisao",
        back_populates="materia",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return (
            f"<Materia("
            f"id={self.id}, "
            f"nome='{self.nome}', "
            f"descricao='{self.descricao}', "
            f"created_at={self.created_at}, "
            f"updated_at={self.updated_at}"
            f")>"
        )

class Subdivisao(Base):
    __tablename__ = "subdivisoes"

    id = Column(Integer, primary_key=True, index=True)
    materia_id = Column(Integer, ForeignKey("materias.id"), nullable=False)
    nome = Column(String(150), nullable=False, index=True)
    descricao = Column(Text, nullable=True)
    created_at = Column(DateTime, default=agora_utc, nullable=False)
    updated_at = Column(DateTime, default=agora_utc, onupdate=agora_utc, nullable=False)

    materia = relationship(
        "Materia",
        back_populates="subdivisoes",
    )

    perguntas = relationship(
        "Pergunta",
        back_populates="subdivisao",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "materia_id",
            "nome",
            name="uq_subdivisao_por_materia",
        ),
    )


class Pergunta(Base):
    __tablename__ = "perguntas"

    id = Column(Integer, primary_key=True, index=True)
    subdivisao_id = Column(Integer, ForeignKey("subdivisoes.id"), nullable=False)

    enunciado = Column(Text, nullable=False)
    dificuldade = Column(String(50), nullable=False)
    origem = Column(String(50), nullable=True)  # manual, llm, importacao etc.

    created_at = Column(DateTime, default=agora_utc, nullable=False)
    updated_at = Column(DateTime, default=agora_utc, onupdate=agora_utc, nullable=False)

    subdivisao = relationship(
        "Subdivisao",
        back_populates="perguntas",
    )

    opcoes = relationship(
        "Opcao",
        back_populates="pergunta",
        cascade="all, delete-orphan",
        order_by="Opcao.ordem",
    )

    revisao = relationship(
        "RevisaoPergunta",
        back_populates="pergunta",
        cascade="all, delete-orphan",
        uselist=False,
    )


class Opcao(Base):
    __tablename__ = "opcoes"

    id = Column(Integer, primary_key=True, index=True)
    pergunta_id = Column(Integer, ForeignKey("perguntas.id"), nullable=False)

    texto = Column(Text, nullable=False)
    correta = Column(Boolean, default=False, nullable=False)
    ordem = Column(Integer, nullable=False)

    created_at = Column(DateTime, default=agora_utc, nullable=False)

    pergunta = relationship(
        "Pergunta",
        back_populates="opcoes",
    )


class RevisaoPergunta(Base):
    __tablename__ = "revisoes_perguntas"

    id = Column(Integer, primary_key=True, index=True)
    pergunta_id = Column(Integer, ForeignKey("perguntas.id"), nullable=False, unique=True)

    vezes_respondida = Column(Integer, default=0, nullable=False)
    vezes_acertada = Column(Integer, default=0, nullable=False)
    vezes_errada = Column(Integer, default=0, nullable=False)

    ultima_resposta_correta = Column(Boolean, nullable=True)
    ultima_respondida_em = Column(DateTime, nullable=True)
    proxima_revisao_em = Column(DateTime, nullable=True)

    intervalo_dias = Column(Integer, default=0, nullable=False)
    fator_facilidade = Column(Integer, default=250, nullable=False)

    created_at = Column(DateTime, default=agora_utc, nullable=False)
    updated_at = Column(DateTime, default=agora_utc, onupdate=agora_utc, nullable=False)

    pergunta = relationship(
        "Pergunta",
        back_populates="revisao",
    )


# =========================
# Funções básicas
# =========================

def criar_tabelas() -> None:
    Base.metadata.create_all(bind=engine)


def get_session():
    return SessionLocal()


# =========================
# Funções de matéria
# =========================

def criar_materia(nome: str, descricao: str | None = None) -> Materia:
    session = get_session()

    try:
        materia = Materia(
            nome=nome.strip(),
            descricao=descricao.strip() if descricao else None,
        )

        session.add(materia)
        session.commit()
        session.refresh(materia)

        return materia

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()


def listar_materias() -> list[Materia]:
    session = get_session()

    try:
        return session.query(Materia).order_by(Materia.nome.asc()).all()

    finally:
        session.close()


def buscar_materia_por_nome(nome: str) -> Materia | None:
    session = get_session()

    try:
        return (
            session.query(Materia)
            .filter(Materia.nome == nome.strip())
            .first()
        )

    finally:
        session.close()


# =========================
# Funções de subdivisão
# =========================

def criar_subdivisao(
    materia_id: int,
    nome: str,
    descricao: str | None = None,
) -> Subdivisao:
    session = get_session()

    try:
        subdivisao = Subdivisao(
            materia_id=materia_id,
            nome=nome.strip(),
            descricao=descricao.strip() if descricao else None,
        )

        session.add(subdivisao)
        session.commit()
        session.refresh(subdivisao)

        return subdivisao

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()


def listar_subdivisoes(materia_id: int | None = None) -> list[Subdivisao]:
    session = get_session()

    try:
        query = session.query(Subdivisao)

        if materia_id is not None:
            query = query.filter(Subdivisao.materia_id == materia_id)

        return query.order_by(Subdivisao.nome.asc()).all()

    finally:
        session.close()


# =========================
# Funções de perguntas
# =========================

def salvar_pergunta(
    subdivisao_id: int,
    enunciado: str,
    opcoes: list[str],
    dificuldade: str,
    origem: str = "manual",
) -> Pergunta:
    """
    Salva uma pergunta no banco.

    Regra atual:
    - A primeira opção da lista é considerada correta.
    - As demais opções são consideradas erradas.
    """

    if not enunciado.strip():
        raise ValueError("O enunciado da pergunta não pode estar vazio.")

    if len(opcoes) < 2:
        raise ValueError("A pergunta precisa ter pelo menos duas opções.")

    opcoes_limpas = [opcao.strip() for opcao in opcoes if opcao.strip()]

    if len(opcoes_limpas) != len(opcoes):
        raise ValueError("Todas as opções devem estar preenchidas.")

    session = get_session()

    try:
        pergunta = Pergunta(
            subdivisao_id=subdivisao_id,
            enunciado=enunciado.strip(),
            dificuldade=dificuldade.strip(),
            origem=origem.strip(),
        )

        for indice, texto_opcao in enumerate(opcoes_limpas, start=1):
            opcao = Opcao(
                texto=texto_opcao,
                correta=(indice == 1),
                ordem=indice,
            )
            pergunta.opcoes.append(opcao)

        pergunta.revisao = RevisaoPergunta(
            vezes_respondida=0,
            vezes_acertada=0,
            vezes_errada=0,
            intervalo_dias=0,
            fator_facilidade=250,
        )

        session.add(pergunta)
        session.commit()
        session.refresh(pergunta)

        return pergunta

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()


def listar_perguntas(subdivisao_id: int | None = None) -> list[Pergunta]:
    session = get_session()

    try:
        query = session.query(Pergunta)

        if subdivisao_id is not None:
            query = query.filter(Pergunta.subdivisao_id == subdivisao_id)

        perguntas = query.order_by(Pergunta.created_at.desc()).all()

        for pergunta in perguntas:
            pergunta.opcoes
            pergunta.revisao

        return perguntas

    finally:
        session.close()


def deletar_pergunta(pergunta_id: int) -> None:
    session = get_session()

    try:
        pergunta = (
            session.query(Pergunta)
            .filter(Pergunta.id == pergunta_id)
            .first()
        )

        if pergunta is not None:
            session.delete(pergunta)
            session.commit()

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()


# =========================
# Funções para JSON vindo do LLM
# =========================

def validar_pergunta_json(dados: dict) -> None:
    campos_obrigatorios = [
        "enunciado",
        "dificuldade",
        "opcoes",
    ]

    for campo in campos_obrigatorios:
        if campo not in dados:
            raise ValueError(f"Campo obrigatório ausente: {campo}")

    if not isinstance(dados["opcoes"], list):
        raise ValueError("O campo 'opcoes' deve ser uma lista.")

    if len(dados["opcoes"]) < 2:
        raise ValueError("A pergunta deve ter pelo menos duas opções.")

    corretas = [
        opcao for opcao in dados["opcoes"]
        if opcao.get("correta") is True
    ]

    if len(corretas) != 1:
        raise ValueError("A pergunta deve ter exatamente uma opção correta.")

    for opcao in dados["opcoes"]:
        if "texto" not in opcao or not opcao["texto"].strip():
            raise ValueError("Todas as opções devem ter texto.")


def salvar_pergunta_json(
    subdivisao_id: int,
    dados: dict,
    origem: str = "llm",
) -> Pergunta:
    """
    Salva uma pergunta recebida em JSON.

    Espera formato:
    {
        "enunciado": "...",
        "dificuldade": "Média",
        "opcoes": [
            {"texto": "...", "correta": true},
            {"texto": "...", "correta": false}
        ]
    }
    """

    validar_pergunta_json(dados)

    session = get_session()

    try:
        pergunta = Pergunta(
            subdivisao_id=subdivisao_id,
            enunciado=dados["enunciado"].strip(),
            dificuldade=dados["dificuldade"].strip(),
            origem=origem,
        )

        for indice, opcao_json in enumerate(dados["opcoes"], start=1):
            opcao = Opcao(
                texto=opcao_json["texto"].strip(),
                correta=bool(opcao_json["correta"]),
                ordem=indice,
            )
            pergunta.opcoes.append(opcao)

        pergunta.revisao = RevisaoPergunta(
            vezes_respondida=0,
            vezes_acertada=0,
            vezes_errada=0,
            intervalo_dias=0,
            fator_facilidade=250,
        )

        session.add(pergunta)
        session.commit()
        session.refresh(pergunta)

        return pergunta

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()