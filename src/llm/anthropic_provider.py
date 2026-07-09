import json

import anthropic

from src.llm.base import LLMProviderError, PerguntaExtraida
from src.llm.schemas import (
    EXTRACAO_SCHEMA,
    PERGUNTA_SCHEMA,
    prompt_extracao,
    prompt_reformulacao,
)

DEFAULT_MODEL = "claude-sonnet-5"


class AnthropicProvider:
    nome = "Claude"

    def __init__(self, api_key: str, model: str | None = None):
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model or DEFAULT_MODEL

    def _chamar(
        self,
        system: str | None,
        mensagem: str,
        schema: dict,
        max_tokens: int,
    ) -> dict:
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": mensagem}],
                output_config={
                    "format": {"type": "json_schema", "schema": schema}
                },
            )
        except anthropic.APIStatusError as exc:
            raise LLMProviderError(f"Erro na API da Anthropic: {exc}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMProviderError(
                f"Falha de conexão com a Anthropic: {exc}"
            ) from exc

        texto = next(
            (bloco.text for bloco in response.content if bloco.type == "text"), None
        )

        if texto is None:
            raise LLMProviderError("A resposta da Anthropic não contém JSON.")

        try:
            return json.loads(texto)
        except json.JSONDecodeError as exc:
            raise LLMProviderError(
                f"A resposta da Anthropic não é um JSON válido: {exc}"
            ) from exc

    def extract_questions(
        self,
        raw_text: str,
        assunto: str,
        dificuldade_padrao: str,
        max_perguntas: int = 60,
    ) -> list[PerguntaExtraida]:
        system = prompt_extracao(assunto, dificuldade_padrao, max_perguntas)
        dados = self._chamar(system, raw_text, EXTRACAO_SCHEMA, max_tokens=16000)
        return dados["perguntas"][:max_perguntas]

    def reformulate_question(self, pergunta: PerguntaExtraida) -> PerguntaExtraida:
        prompt = prompt_reformulacao(pergunta)
        return self._chamar(None, prompt, PERGUNTA_SCHEMA, max_tokens=4000)
