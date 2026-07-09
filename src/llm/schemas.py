from src.llm.base import PerguntaExtraida

DIFICULDADES = ["Fácil", "Média", "Difícil"]

OPCAO_SCHEMA = {
    "type": "object",
    "properties": {
        "texto": {"type": "string"},
        "correta": {"type": "boolean"},
    },
    "required": ["texto", "correta"],
    "additionalProperties": False,
}

PERGUNTA_SCHEMA = {
    "type": "object",
    "properties": {
        "enunciado": {"type": "string"},
        "dificuldade": {"type": "string", "enum": DIFICULDADES},
        "opcoes": {
            "type": "array",
            "items": OPCAO_SCHEMA,
        },
        "topico": {"type": ["string", "null"]},
    },
    "required": ["enunciado", "dificuldade", "opcoes", "topico"],
    "additionalProperties": False,
}

EXTRACAO_SCHEMA = {
    "type": "object",
    "properties": {
        "perguntas": {
            "type": "array",
            "items": PERGUNTA_SCHEMA,
        },
    },
    "required": ["perguntas"],
    "additionalProperties": False,
}


def prompt_extracao(assunto: str, dificuldade_padrao: str, max_perguntas: int) -> str:
    return (
        "Você é um assistente que extrai questões de múltipla escolha de um "
        "texto bruto colado pelo usuário. O texto pode conter uma ou várias "
        "questões, em qualquer formato (com ou sem a resposta correta "
        "marcada, com ou sem numeração, texto de prova real colado sem "
        "formatação, etc).\n\n"
        f"Para cada questão encontrada, no máximo {max_perguntas}, produza:\n"
        '- "enunciado": o texto da pergunta, sem as alternativas.\n'
        '- "opcoes": lista das alternativas, cada uma com "texto" e '
        '"correta" (true/false). Você deve decidir qual alternativa é a '
        "correta usando seu conhecimento sobre o assunto, mesmo que o texto "
        "original não indique isso explicitamente ou indique errado. "
        'Exatamente uma alternativa deve ter "correta": true.\n'
        '- "dificuldade": "Fácil", "Média" ou "Difícil". Se não for '
        f'possível inferir, use "{dificuldade_padrao}".\n'
        f'- "topico": um subtópico curto dentro de "{assunto}" (ex.: "IAM", '
        '"Redes", "Regressão Linear"), ou null se não for possível '
        "determinar.\n\n"
        f"Assunto geral das perguntas: {assunto}.\n"
        "Responda apenas com o JSON pedido, sem texto adicional."
    )


def prompt_reformulacao(pergunta: PerguntaExtraida) -> str:
    opcoes_texto = "\n".join(
        f"- {opcao['texto']} ({'CORRETA' if opcao['correta'] else 'incorreta'})"
        for opcao in pergunta["opcoes"]
    )

    return (
        "Reescreva a pergunta de múltipla escolha abaixo, mudando a redação "
        "do enunciado e das alternativas (parafraseando, trocando exemplos, "
        "mudando a ordem das alternativas), mas mantendo exatamente o mesmo "
        "conceito testado e a mesma resposta correta.\n\n"
        "Regras:\n"
        f"- O número de alternativas deve continuar o mesmo: "
        f"{len(pergunta['opcoes'])}.\n"
        '- Exatamente uma alternativa deve ter "correta": true, e ela deve '
        "testar o mesmo conceito que era a resposta correta original — não "
        "troque qual é o fato correto.\n"
        "- Não copie o enunciado nem as alternativas originais literalmente; "
        "mude a redação.\n"
        f"- Mantenha a mesma dificuldade (\"{pergunta['dificuldade']}\") e o "
        f"mesmo tópico (\"{pergunta.get('topico') or 'geral'}\").\n\n"
        "Pergunta original:\n"
        f"Enunciado: {pergunta['enunciado']}\n"
        "Alternativas:\n"
        f"{opcoes_texto}\n\n"
        "Responda apenas com o JSON pedido, sem texto adicional."
    )
