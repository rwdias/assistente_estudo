import pytest

from src.llm.anthropic_provider import AnthropicProvider
from src.llm.base import LLMProviderError
from src.llm.factory import get_provider
from src.llm.grok_provider import GrokProvider
from src.llm.openai_provider import OpenAIProvider

VARIAVEIS_DE_AMBIENTE = (
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "XAI_API_KEY",
    "XAI_MODEL",
)


@pytest.fixture(autouse=True)
def sem_variaveis_de_ambiente(monkeypatch):
    """Garante que cada teste começa sem nenhuma chave/modelo configurado."""

    for chave in VARIAVEIS_DE_AMBIENTE:
        monkeypatch.delenv(chave, raising=False)


def test_provedor_desconhecido_levanta_erro():
    with pytest.raises(LLMProviderError):
        get_provider("Bard")


@pytest.mark.parametrize(
    "nome,env_chave",
    [
        ("ChatGPT", "OPENAI_API_KEY"),
        ("Claude", "ANTHROPIC_API_KEY"),
        ("Grok", "XAI_API_KEY"),
    ],
)
def test_chave_ausente_levanta_erro_claro(nome, env_chave):
    with pytest.raises(LLMProviderError) as excinfo:
        get_provider(nome)

    assert env_chave in str(excinfo.value)


@pytest.mark.parametrize(
    "nome,env_chave,classe_esperada",
    [
        ("ChatGPT", "OPENAI_API_KEY", OpenAIProvider),
        ("Claude", "ANTHROPIC_API_KEY", AnthropicProvider),
        ("Grok", "XAI_API_KEY", GrokProvider),
    ],
)
def test_provedor_e_instanciado_com_chave_presente(
    monkeypatch, nome, env_chave, classe_esperada
):
    monkeypatch.setenv(env_chave, "chave-fake-para-teste")

    provider = get_provider(nome)

    assert isinstance(provider, classe_esperada)
    assert provider.nome == nome
