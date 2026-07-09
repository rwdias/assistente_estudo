from datetime import datetime, timedelta

# Fora desse limiar de intervalo (dias), uma pergunta é considerada "madura":
# o usuário acertou consecutivamente o suficiente para justificar reformular
# o enunciado na próxima revisão, em vez de mostrar o texto memorizado.
MATURIDADE_DIAS = 21

# Piso do fator de facilidade, igual ao SM-2 clássico: evita que o fator
# caia a ponto de o intervalo nunca mais crescer.
FATOR_FACILIDADE_MINIMO = 1.3


def calcular_revisao(
    fator_facilidade: int,
    intervalo_dias: int,
    correta: bool,
    agora: datetime,
) -> tuple[int, int, datetime]:
    """
    Calcula os novos valores de fator_facilidade, intervalo_dias e
    proxima_revisao_em a partir de uma resposta certa/errada, seguindo uma
    variante binária do algoritmo SM-2.

    Como a interface só produz um sinal certo/errado, a "qualidade" de
    0 a 5 do SM-2 original é simplificada para dois valores: um acerto
    conta como q=5 (lembrou bem) e um erro conta como q=2 (não lembrou,
    mas sem ser o pior caso possível) — assim mantemos a fórmula contínua
    do fator de facilidade sem precisar de uma UI de graduação 0-5.

    `intervalo_dias == 0` funciona como sentinela de "pergunta nova ou que
    acabou de ser errada": qualquer erro zera o intervalo, então o próximo
    acerto volta naturalmente para o primeiro degrau (1 dia), replicando o
    reset do contador de repetições do SM-2 clássico sem precisar de uma
    coluna extra no banco.
    """

    q = 5 if correta else 2

    fator_facilidade_atual = fator_facilidade / 100.0
    novo_fator_facilidade = fator_facilidade_atual + (
        0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
    )
    novo_fator_facilidade = max(novo_fator_facilidade, FATOR_FACILIDADE_MINIMO)

    if q < 3:
        novo_intervalo_dias = 0
        proxima_revisao_em = agora + timedelta(minutes=10)
    else:
        if intervalo_dias <= 0:
            novo_intervalo_dias = 1
        elif intervalo_dias == 1:
            novo_intervalo_dias = 6
        else:
            novo_intervalo_dias = round(intervalo_dias * novo_fator_facilidade)

        proxima_revisao_em = agora + timedelta(days=novo_intervalo_dias)

    return round(novo_fator_facilidade * 100), novo_intervalo_dias, proxima_revisao_em


def pergunta_esta_madura(intervalo_dias: int) -> bool:
    return intervalo_dias >= MATURIDADE_DIAS


# Limiares de taxa de acerto usados para classificar a dificuldade pessoal.
TAXA_ACERTO_FACIL = 0.75
TAXA_ACERTO_MEDIA = 0.4


def dificuldade_pessoal(
    dificuldade_estatica: str,
    vezes_respondida: int,
    vezes_acertada: int,
    ultima_resposta_correta: bool | None,
) -> str:
    """
    Calcula a dificuldade "pessoal" (Fácil/Média/Difícil) de uma pergunta
    a partir do histórico de respostas do usuário, em vez da dificuldade
    estática atribuída na criação (que reflete o nível da prova/exame, não
    o quão difícil aquilo é *para essa pessoa*).

    Antes da primeira resposta ainda não há histórico, então a dificuldade
    estática é usada como ponto de partida. Errar a resposta mais recente
    classifica a pergunta como "Difícil" independente do histórico anterior
    — reflete que ela está difícil *agora*. Acertando a mais recente, a
    classificação vem da taxa de acerto acumulada.
    """

    if vezes_respondida == 0:
        return dificuldade_estatica

    if ultima_resposta_correta is False:
        return "Difícil"

    taxa_acerto = vezes_acertada / vezes_respondida

    if taxa_acerto >= TAXA_ACERTO_FACIL:
        return "Fácil"

    if taxa_acerto >= TAXA_ACERTO_MEDIA:
        return "Média"

    return "Difícil"
