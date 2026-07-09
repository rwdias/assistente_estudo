from typing import Protocol, TypedDict


class OpcaoExtraida(TypedDict):
    texto: str
    correta: bool


class PerguntaExtraida(TypedDict):
    enunciado: str
    dificuldade: str  # "Fácil" | "Média" | "Difícil"
    opcoes: list[OpcaoExtraida]
    topico: str | None  # sugestão de nome de Subdivisao, opcional


class LLMProviderError(Exception):
    """Erro ao chamar um provedor de LLM: chave ausente, API indisponível ou
    resposta inválida."""


class LLMProvider(Protocol):
    nome: str

    def extract_questions(
        self,
        raw_text: str,
        assunto: str,
        dificuldade_padrao: str,
        max_perguntas: int = 60,
    ) -> list[PerguntaExtraida]:
        """
        Extrai uma ou mais perguntas de múltipla escolha de um texto bruto.

        O provedor decide sozinho qual alternativa é a correta — o chamador
        nunca deve tratar a marcação de "correta" feita pelo usuário no texto
        de origem como confiável.
        """
        ...

    def reformulate_question(self, pergunta: PerguntaExtraida) -> PerguntaExtraida:
        """
        Reescreve o enunciado e as alternativas com redação diferente,
        mantendo o mesmo número de alternativas e a mesma resposta correta.
        """
        ...
