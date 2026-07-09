import json

import openai

from src.llm.base import LLMProviderError, PerguntaExtraida
from src.llm.schemas import (
    EXTRACAO_SCHEMA,
    PERGUNTA_SCHEMA,
    prompt_extracao,
    prompt_reformulacao,
)

DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIProvider:
    nome = "ChatGPT"

    def __init__(
        self,
        api_key: str,
        model: str | None = None,
        base_url: str | None = None,
    ):
        self._client = openai.OpenAI(api_key=api_key, base_url=base_url)
        self._model = model or DEFAULT_MODEL

    def _chamar(
        self,
        system: str | None,
        mensagem: str,
        schema: dict,
        nome_schema: str,
    ) -> dict:
        mensagens = []

        if system:
            mensagens.append({"role": "system", "content": system})

        mensagens.append({"role": "user", "content": mensagem})

        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=mensagens,
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": nome_schema,
                        "schema": schema,
                        "strict": True,
                    },
                },
            )
        except openai.APIConnectionError as exc:
            raise LLMProviderError(f"Falha de conexão com {self.nome}: {exc}") from exc
        except openai.APIStatusError as exc:
            raise LLMProviderError(f"Erro na API da {self.nome}: {exc}") from exc

        texto = response.choices[0].message.content

        if texto is None:
            raise LLMProviderError(f"A resposta da {self.nome} não contém JSON.")

        try:
            return json.loads(texto)
        except json.JSONDecodeError as exc:
            raise LLMProviderError(
                f"A resposta da {self.nome} não é um JSON válido: {exc}"
            ) from exc

    def extract_questions(
        self,
        raw_text: str,
        assunto: str,
        dificuldade_padrao: str,
        max_perguntas: int = 60,
    ) -> list[PerguntaExtraida]:
        system = prompt_extracao(assunto, dificuldade_padrao, max_perguntas)
        dados = self._chamar(system, raw_text, EXTRACAO_SCHEMA, "extracao_perguntas")
        return dados["perguntas"][:max_perguntas]

    def reformulate_question(self, pergunta: PerguntaExtraida) -> PerguntaExtraida:
        prompt = prompt_reformulacao(pergunta)
        return self._chamar(None, prompt, PERGUNTA_SCHEMA, "pergunta_reformulada")
