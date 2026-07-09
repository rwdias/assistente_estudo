import os

from src.llm.anthropic_provider import AnthropicProvider
from src.llm.base import LLMProvider, LLMProviderError
from src.llm.grok_provider import GrokProvider
from src.llm.openai_provider import OpenAIProvider

# Mapeia o nome exibido na sidebar para (variável de ambiente da chave,
# variável de ambiente do modelo, classe do provedor).
_CONFIGURACOES = {
    "ChatGPT": ("OPENAI_API_KEY", "OPENAI_MODEL", OpenAIProvider),
    "Claude": ("ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", AnthropicProvider),
    "Grok": ("XAI_API_KEY", "XAI_MODEL", GrokProvider),
}


def get_provider(nome: str) -> LLMProvider:
    """
    Cria o provedor de LLM correspondente ao nome escolhido na sidebar,
    lendo a chave de API e o modelo (se configurado) das variáveis de
    ambiente carregadas do .env.
    """

    configuracao = _CONFIGURACOES.get(nome)

    if configuracao is None:
        raise LLMProviderError(f"Provedor de LLM desconhecido: {nome}")

    env_chave, env_modelo, classe_provedor = configuracao
    api_key = os.environ.get(env_chave)

    if not api_key:
        raise LLMProviderError(
            f"Defina a variável {env_chave} no arquivo .env para usar o "
            f"provedor {nome}. Veja .env.example."
        )

    modelo = os.environ.get(env_modelo) or None

    return classe_provedor(api_key=api_key, model=modelo)
