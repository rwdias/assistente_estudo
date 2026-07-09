from datetime import datetime, timedelta, timezone

from src.srs import (
    FATOR_FACILIDADE_MINIMO,
    MATURIDADE_DIAS,
    calcular_revisao,
    dificuldade_pessoal,
    pergunta_esta_madura,
)

AGORA = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_primeiro_acerto_agenda_para_um_dia():
    fator, intervalo, proxima = calcular_revisao(
        fator_facilidade=250, intervalo_dias=0, correta=True, agora=AGORA
    )

    assert intervalo == 1
    assert proxima == AGORA + timedelta(days=1)
    assert fator > 250


def test_segundo_acerto_consecutivo_agenda_para_seis_dias():
    fator, intervalo, proxima = calcular_revisao(
        fator_facilidade=260, intervalo_dias=1, correta=True, agora=AGORA
    )

    assert intervalo == 6
    assert proxima == AGORA + timedelta(days=6)


def test_acertos_seguintes_crescem_pelo_fator_de_facilidade():
    fator, intervalo, proxima = calcular_revisao(
        fator_facilidade=260, intervalo_dias=6, correta=True, agora=AGORA
    )

    fator_esperado = 2.6 + (0.1 - 0 * (0.08 + 0 * 0.02))
    intervalo_esperado = round(6 * fator_esperado)

    assert intervalo == intervalo_esperado
    assert intervalo > 6
    assert proxima == AGORA + timedelta(days=intervalo_esperado)


def test_erro_apos_sequencia_longa_reseta_intervalo():
    fator, intervalo, proxima = calcular_revisao(
        fator_facilidade=280, intervalo_dias=30, correta=False, agora=AGORA
    )

    assert intervalo == 0
    assert proxima == AGORA + timedelta(minutes=10)
    assert fator < 280


def test_fator_facilidade_nao_cai_abaixo_do_piso():
    fator, _, _ = calcular_revisao(
        fator_facilidade=130, intervalo_dias=10, correta=False, agora=AGORA
    )

    assert fator >= round(FATOR_FACILIDADE_MINIMO * 100)


def test_pergunta_madura_a_partir_do_limiar():
    assert not pergunta_esta_madura(MATURIDADE_DIAS - 1)
    assert pergunta_esta_madura(MATURIDADE_DIAS)
    assert pergunta_esta_madura(MATURIDADE_DIAS + 10)


def test_dificuldade_pessoal_sem_historico_usa_estatica():
    resultado = dificuldade_pessoal(
        dificuldade_estatica="Difícil",
        vezes_respondida=0,
        vezes_acertada=0,
        ultima_resposta_correta=None,
    )

    assert resultado == "Difícil"


def test_dificuldade_pessoal_erro_recente_e_sempre_dificil():
    resultado = dificuldade_pessoal(
        dificuldade_estatica="Fácil",
        vezes_respondida=10,
        vezes_acertada=9,
        ultima_resposta_correta=False,
    )

    assert resultado == "Difícil"


def test_dificuldade_pessoal_taxa_de_acerto_alta_e_facil():
    resultado = dificuldade_pessoal(
        dificuldade_estatica="Difícil",
        vezes_respondida=4,
        vezes_acertada=4,
        ultima_resposta_correta=True,
    )

    assert resultado == "Fácil"


def test_dificuldade_pessoal_taxa_de_acerto_intermediaria_e_media():
    resultado = dificuldade_pessoal(
        dificuldade_estatica="Fácil",
        vezes_respondida=5,
        vezes_acertada=3,
        ultima_resposta_correta=True,
    )

    assert resultado == "Média"


def test_dificuldade_pessoal_taxa_de_acerto_baixa_e_dificil():
    resultado = dificuldade_pessoal(
        dificuldade_estatica="Fácil",
        vezes_respondida=5,
        vezes_acertada=1,
        ultima_resposta_correta=True,
    )

    assert resultado == "Difícil"
