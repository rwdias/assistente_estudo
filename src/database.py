import os
import random
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    and_,
    case,
    create_engine,
    event,
    func,
    or_,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from src.srs import calcular_revisao

# =========================
# Configuração do banco
# =========================

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "assistente_estudo.db"

# Permite apontar para outro arquivo (testes de migração, ambiente de CI)
# sem precisar mexer no código.
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

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


@event.listens_for(engine, "connect")
def _habilitar_foreign_keys(conexao_dbapi, _):
    """
    O SQLite ignora `FOREIGN KEY`/`ON DELETE CASCADE` por padrão — precisa
    ser ligado em cada conexão. Sem isso, deletar um Usuario (ou qualquer
    delete em massa que não passe pelo cascade do ORM) pode deixar linhas
    órfãs, e como o SQLite reaproveita ids de linhas apagadas, uma linha
    órfã pode ser "adotada" silenciosamente por um usuário futuro.
    """

    cursor = conexao_dbapi.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def agora_utc() -> datetime:
    return datetime.now(timezone.utc)


# =========================
# Tabelas
# =========================

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    senha_hash = Column(String(255), nullable=False)

    # Controle de quota diária de chamadas de IA (extração/reformulação).
    ia_chamadas_data = Column(Date, nullable=True)
    ia_chamadas_contagem = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=agora_utc, nullable=False)
    updated_at = Column(DateTime, default=agora_utc, onupdate=agora_utc, nullable=False)

    materias = relationship(
        "Materia",
        back_populates="usuario",
        cascade="all, delete-orphan",
    )


class Materia(Base):
    __tablename__ = "materias"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(
        Integer,
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    nome = Column(String(150), nullable=False, index=True)
    descricao = Column(Text, nullable=True)
    created_at = Column(DateTime, default=agora_utc, nullable=False)
    updated_at = Column(DateTime, default=agora_utc, onupdate=agora_utc, nullable=False)

    usuario = relationship(
        "Usuario",
        back_populates="materias",
    )

    subdivisoes = relationship(
        "Subdivisao",
        back_populates="materia",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "usuario_id",
            "nome",
            name="uq_materia_por_usuario",
        ),
    )


class Subdivisao(Base):
    __tablename__ = "subdivisoes"

    id = Column(Integer, primary_key=True, index=True)
    materia_id = Column(
        Integer, ForeignKey("materias.id", ondelete="CASCADE"), nullable=False
    )
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
    subdivisao_id = Column(
        Integer, ForeignKey("subdivisoes.id", ondelete="CASCADE"), nullable=False
    )

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
    pergunta_id = Column(
        Integer, ForeignKey("perguntas.id", ondelete="CASCADE"), nullable=False
    )

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
    pergunta_id = Column(
        Integer,
        ForeignKey("perguntas.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

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

def criar_materia(usuario_id: int, nome: str, descricao: str | None = None) -> Materia:
    session = get_session()

    try:
        materia = Materia(
            usuario_id=usuario_id,
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


def resumo_materias(usuario_id: int) -> list[dict]:
    """
    Lista as matérias do usuário com contagem de perguntas e de perguntas
    devidas para revisão — alimenta o dashboard sem N+1 de queries.
    """

    session = get_session()

    try:
        agora = agora_utc()

        pergunta_devida = and_(
            Pergunta.id.isnot(None),
            or_(
                RevisaoPergunta.proxima_revisao_em.is_(None),
                RevisaoPergunta.proxima_revisao_em <= agora,
            ),
        )

        linhas = (
            session.query(
                Materia.id,
                Materia.nome,
                func.count(Pergunta.id),
                func.sum(case((pergunta_devida, 1), else_=0)),
            )
            .outerjoin(Subdivisao, Subdivisao.materia_id == Materia.id)
            .outerjoin(Pergunta, Pergunta.subdivisao_id == Subdivisao.id)
            .outerjoin(RevisaoPergunta, RevisaoPergunta.pergunta_id == Pergunta.id)
            .filter(Materia.usuario_id == usuario_id)
            .group_by(Materia.id, Materia.nome)
            .order_by(Materia.nome.asc())
            .all()
        )

        return [
            {
                "id": materia_id,
                "nome": nome,
                "total_perguntas": total or 0,
                "devidas_revisao": int(devidas or 0),
            }
            for materia_id, nome, total, devidas in linhas
        ]

    finally:
        session.close()


def listar_materias(usuario_id: int) -> list[Materia]:
    session = get_session()

    try:
        return (
            session.query(Materia)
            .filter(Materia.usuario_id == usuario_id)
            .order_by(Materia.nome.asc())
            .all()
        )

    finally:
        session.close()


def buscar_materia_por_nome(usuario_id: int, nome: str) -> Materia | None:
    session = get_session()

    try:
        return (
            session.query(Materia)
            .filter(
                Materia.usuario_id == usuario_id,
                Materia.nome == nome.strip(),
            )
            .first()
        )

    finally:
        session.close()


def buscar_materia_por_id(usuario_id: int, materia_id: int) -> Materia | None:
    """
    Busca uma matéria por id, mas apenas se ela pertencer ao usuário
    informado — usado pela camada de API para checar ownership antes de
    qualquer leitura/escrita em perguntas daquela matéria.
    """

    session = get_session()

    try:
        return (
            session.query(Materia)
            .filter(
                Materia.id == materia_id,
                Materia.usuario_id == usuario_id,
            )
            .first()
        )

    finally:
        session.close()


def buscar_ou_criar_materia(usuario_id: int, nome: str) -> Materia:
    materia = buscar_materia_por_nome(usuario_id, nome)

    if materia is not None:
        return materia

    return criar_materia(usuario_id, nome)


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


def buscar_subdivisao_por_nome(materia_id: int, nome: str) -> Subdivisao | None:
    session = get_session()

    try:
        return (
            session.query(Subdivisao)
            .filter(
                Subdivisao.materia_id == materia_id,
                Subdivisao.nome == nome.strip(),
            )
            .first()
        )

    finally:
        session.close()


def buscar_ou_criar_subdivisao(materia_id: int, nome: str = "Geral") -> Subdivisao:
    subdivisao = buscar_subdivisao_por_nome(materia_id, nome)

    if subdivisao is not None:
        return subdivisao

    return criar_subdivisao(materia_id, nome)


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
            _ = pergunta.opcoes
            _ = pergunta.revisao

        return perguntas

    finally:
        session.close()


def listar_perguntas_por_materia(materia_id: int) -> list[Pergunta]:
    """
    Lista todas as perguntas de uma matéria, em qualquer subdivisão
    (tópico) dela. As perguntas cadastradas manualmente vão por padrão
    para a subdivisão "Geral", mas a ingestão via IA pode espalhá-las por
    várias subdivisões (uma por tópico sugerido) — por isso a listagem
    usada nas páginas de simulado, cadastro e revisão precisa considerar a
    matéria inteira, não uma única subdivisão.
    """

    session = get_session()

    try:
        perguntas = (
            session.query(Pergunta)
            .join(Subdivisao)
            .filter(Subdivisao.materia_id == materia_id)
            .order_by(Pergunta.created_at.desc())
            .all()
        )

        for pergunta in perguntas:
            _ = pergunta.opcoes
            _ = pergunta.revisao

        return perguntas

    finally:
        session.close()


def buscar_pergunta_por_id(pergunta_id: int) -> Pergunta | None:
    session = get_session()

    try:
        pergunta = session.query(Pergunta).filter(Pergunta.id == pergunta_id).first()

        if pergunta is not None:
            _ = pergunta.opcoes
            _ = pergunta.revisao

        return pergunta

    finally:
        session.close()


def pergunta_pertence_ao_usuario(usuario_id: int, pergunta_id: int) -> bool:
    """
    Confirma que a pergunta existe e pertence (via Subdivisao -> Materia) ao
    usuário informado. A camada de API deve chamar isso antes de qualquer
    leitura/escrita em uma pergunta a partir de um id recebido do cliente
    (responder, deletar, reformular) — é a barreira contra um usuário
    acessar/alterar dados de outro (IDOR).
    """

    session = get_session()

    try:
        existe = (
            session.query(Pergunta.id)
            .join(Subdivisao)
            .join(Materia)
            .filter(
                Pergunta.id == pergunta_id,
                Materia.usuario_id == usuario_id,
            )
            .first()
        )

        return existe is not None

    finally:
        session.close()


def listar_perguntas_para_simulado(
    materia_id: int,
    dificuldade: str | None = None,
    quantidade: int | None = None,
    embaralhar: bool = False,
) -> list[Pergunta]:
    """
    Seleciona perguntas de uma matéria (em qualquer subdivisão/tópico) para
    montar um simulado.

    Aplica o filtro de dificuldade (se informado), embaralha (se pedido) e
    corta na quantidade desejada, nessa ordem.
    """

    perguntas = listar_perguntas_por_materia(materia_id)

    if dificuldade:
        perguntas = [p for p in perguntas if p.dificuldade == dificuldade]

    if embaralhar:
        perguntas = perguntas.copy()
        random.shuffle(perguntas)

    if quantidade is not None:
        perguntas = perguntas[:quantidade]

    return perguntas


def registrar_resposta(pergunta_id: int, correta: bool) -> RevisaoPergunta:
    """
    Registra o resultado de uma resposta e recalcula o agendamento de
    revisão (SM-2) daquela pergunta.
    """

    session = get_session()

    try:
        revisao = (
            session.query(RevisaoPergunta)
            .filter(RevisaoPergunta.pergunta_id == pergunta_id)
            .first()
        )

        if revisao is None:
            raise ValueError(
                f"Pergunta {pergunta_id} não possui registro de revisão."
            )

        agora = agora_utc()

        novo_fator_facilidade, novo_intervalo_dias, proxima_revisao_em = (
            calcular_revisao(
                fator_facilidade=revisao.fator_facilidade,
                intervalo_dias=revisao.intervalo_dias,
                correta=correta,
                agora=agora,
            )
        )

        revisao.vezes_respondida += 1
        revisao.vezes_acertada += 1 if correta else 0
        revisao.vezes_errada += 0 if correta else 1
        revisao.ultima_resposta_correta = correta
        revisao.ultima_respondida_em = agora
        revisao.fator_facilidade = novo_fator_facilidade
        revisao.intervalo_dias = novo_intervalo_dias
        revisao.proxima_revisao_em = proxima_revisao_em

        session.commit()
        session.refresh(revisao)

        return revisao

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()


def listar_perguntas_para_revisao(
    materia_id: int | None = None,
    limite: int | None = None,
) -> list[Pergunta]:
    """
    Lista perguntas devidas para revisão: nunca respondidas ou com
    `proxima_revisao_em` no passado, ordenadas das mais atrasadas primeiro.

    Quando `materia_id` é informado, considera perguntas de qualquer
    subdivisão (tópico) daquela matéria.
    """

    session = get_session()

    try:
        agora = agora_utc()

        query = (
            session.query(Pergunta)
            .join(RevisaoPergunta)
            .filter(
                (RevisaoPergunta.proxima_revisao_em.is_(None))
                | (RevisaoPergunta.proxima_revisao_em <= agora)
            )
        )

        if materia_id is not None:
            query = query.join(
                Subdivisao, Pergunta.subdivisao_id == Subdivisao.id
            ).filter(Subdivisao.materia_id == materia_id)

        query = query.order_by(RevisaoPergunta.proxima_revisao_em.asc().nullsfirst())

        if limite is not None:
            query = query.limit(limite)

        perguntas = query.all()

        for pergunta in perguntas:
            _ = pergunta.opcoes
            _ = pergunta.revisao

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
# Funções de usuário e quota de IA
# =========================

def criar_usuario(email: str, senha_hash: str) -> Usuario:
    session = get_session()

    try:
        usuario = Usuario(email=email.strip().lower(), senha_hash=senha_hash)

        session.add(usuario)
        session.commit()
        session.refresh(usuario)

        return usuario

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()


def buscar_usuario_por_email(email: str) -> Usuario | None:
    session = get_session()

    try:
        return (
            session.query(Usuario)
            .filter(Usuario.email == email.strip().lower())
            .first()
        )

    finally:
        session.close()


def buscar_usuario_por_id(usuario_id: int) -> Usuario | None:
    session = get_session()

    try:
        return session.query(Usuario).filter(Usuario.id == usuario_id).first()

    finally:
        session.close()


def verificar_e_incrementar_quota_ia(usuario_id: int, limite_diario: int) -> bool:
    """
    Verifica se o usuário ainda tem chamadas de IA disponíveis hoje e, se
    tiver, já incrementa o contador (evita condição de corrida entre checar
    e incrementar em requisições separadas). A contagem reinicia sozinha a
    cada novo dia (comparando `ia_chamadas_data` com a data de hoje).

    Retorna True se a chamada pode prosseguir, False se a quota diária já
    foi atingida.
    """

    session = get_session()

    try:
        usuario = session.query(Usuario).filter(Usuario.id == usuario_id).first()

        if usuario is None:
            raise ValueError(f"Usuário {usuario_id} não encontrado.")

        hoje = date.today()

        if usuario.ia_chamadas_data != hoje:
            usuario.ia_chamadas_data = hoje
            usuario.ia_chamadas_contagem = 0

        if usuario.ia_chamadas_contagem >= limite_diario:
            session.commit()
            return False

        usuario.ia_chamadas_contagem += 1
        session.commit()

        return True

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