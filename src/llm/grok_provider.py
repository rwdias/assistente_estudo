from src.llm.openai_provider import OpenAIProvider

# A xAI expõe um endpoint compatível com a API da OpenAI
# (https://docs.x.ai), incluindo o mesmo formato de structured output via
# `response_format={"type": "json_schema", ...}`. Por isso reaproveitamos o
# client `openai` com uma base_url diferente, em vez de uma SDK dedicada.
XAI_BASE_URL = "https://api.x.ai/v1"
DEFAULT_MODEL = "grok-4.3"


class GrokProvider(OpenAIProvider):
    nome = "Grok"

    def __init__(self, api_key: str, model: str | None = None):
        super().__init__(
            api_key=api_key,
            model=model or DEFAULT_MODEL,
            base_url=XAI_BASE_URL,
        )
