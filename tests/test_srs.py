"""SM-2 (repetição espaçada) — a lógica mais crítica do produto.

Testa a função SQL `registrar_resposta` (migr. 0019) por VALORES-OURO derivados
da própria função (o baseline antigo src/srs.py foi removido). EF é guardado
como inteiro ×100 (250 = 2.5; piso 130 = 1.3).

Fórmula do EF: ef' = max(ef + (0.1 - (5-q)*(0.08 + (5-q)*0.02)), 1.3)
  q=5 -> +0.10 | q=4 -> +0.00 | q=3 -> -0.14 | q=2 -> -0.32
Intervalo: lapso(q<=2)->0 (+10min corridos) | novo->1 | 1->6 | i->round(i*ef)
Fácil (q=5 com p_qualidade): card novo -> 4 dias; senão Bom×1.3.
A DATA da próxima revisão pula fim de semana/feriado (dias úteis); o NÚMERO não.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

pytestmark = pytest.mark.db

SP = ZoneInfo("America/Sao_Paulo")


def _responder(materia, pid, correta, qualidade=None):
    args = {"p_pergunta_id": pid, "p_correta": correta}
    if qualidade is not None:
        args["p_qualidade"] = qualidade
    r = materia.cli.rpc("registrar_resposta", args)
    assert r.status_code == 200, r.text
    return r.json()


def _eh_dia_util(iso):
    # A regra de dias úteis vale no fuso America/Sao_Paulo — converter antes de
    # olhar o dia da semana (em UTC, perto da meia-noite, o dia "vira"). O que
    # importa: um passo de SUCESSO nunca cai em sáb/dom. weekday(): 5=sáb,6=dom.
    d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(SP)
    return d.weekday() < 5


# ------------------------- binário (pergunta/simulado) -------------------------

def test_acerto_novo_vira_intervalo_1(materia):
    pid = materia.criar_pergunta()
    _responder(materia, pid, True)
    r = materia.revisao(pid)
    assert r["intervalo_dias"] == 1
    assert r["fator_facilidade"] == 260  # 2.5 -> 2.6
    assert r["vezes_respondida"] == 1
    assert r["vezes_acertada"] == 1
    assert r["acertos_seguidos"] == 1
    assert r["ultima_resposta_correta"] is True
    assert _eh_dia_util(r["proxima_revisao_em"])


def test_progressao_1_6_round(materia):
    pid = materia.criar_pergunta()
    _responder(materia, pid, True)                    # -> 1 (ef 2.6)
    assert materia.revisao(pid)["intervalo_dias"] == 1
    _responder(materia, pid, True)                    # 1 -> 6 (ef 2.7)
    assert materia.revisao(pid)["intervalo_dias"] == 6
    _responder(materia, pid, True)                    # 6 -> round(6*2.8)=17 (ef 2.8)
    r = materia.revisao(pid)
    assert r["intervalo_dias"] == 17
    assert r["fator_facilidade"] == 280
    assert r["acertos_seguidos"] == 3


def test_erro_zera_intervalo_e_reduz_ef(materia):
    pid = materia.criar_pergunta()
    _responder(materia, pid, True)                    # sobe para 1
    res = _responder(materia, pid, False)             # erro
    r = materia.revisao(pid)
    assert r["intervalo_dias"] == 0
    assert r["fator_facilidade"] == 228               # 2.6 -> 2.28 (q=2: -0.32)
    assert r["acertos_seguidos"] == 0
    assert r["ultima_resposta_correta"] is False
    assert res["qualidade"] == 2


def test_ef_tem_piso_1_3(materia):
    pid = materia.criar_pergunta()
    for _ in range(8):                                # muitos erros seguidos
        _responder(materia, pid, False)
    assert materia.revisao(pid)["fator_facilidade"] == 130  # não desce de 1.3


# ------------------------- 4 níveis (flashcard, Anki) -------------------------

def test_flashcard_de_novo_e_lapso(materia):
    pid = materia.criar_flashcard()
    _responder(materia, pid, False, qualidade=2)      # "De novo"
    r = materia.revisao(pid)
    assert r["intervalo_dias"] == 0                   # lapso
    assert r["fator_facilidade"] == 218               # 2.5 -> 2.18
    assert r["acertos_seguidos"] == 0


def test_flashcard_dificil_bom_facil_ordem_dos_intervalos(materia):
    # cada um num flashcard novo (mesmo estado inicial) para comparar limpo
    d = materia.revisao(_grade_novo(materia, 3))
    b = materia.revisao(_grade_novo(materia, 4))
    f = materia.revisao(_grade_novo(materia, 5))
    # Difícil e Bom, em card novo, dão 1 dia; Fácil pula para 4.
    assert d["intervalo_dias"] == 1 and d["fator_facilidade"] == 236  # -0.14
    assert b["intervalo_dias"] == 1 and b["fator_facilidade"] == 250  # +0.00
    assert f["intervalo_dias"] == 4 and f["fator_facilidade"] == 260  # +0.10
    # EF cresce do Difícil ao Fácil (regra do Anki)
    assert d["fator_facilidade"] < b["fator_facilidade"] < f["fator_facilidade"]


def test_binario_equivale_a_sem_qualidade(materia):
    # acerto binário (q=5 implícito, p_qualidade NULL) NÃO aplica o bônus do Fácil:
    # card novo -> intervalo 1 (e não 4). É o que garante a compatibilidade.
    pid = materia.criar_pergunta()
    _responder(materia, pid, True)
    assert materia.revisao(pid)["intervalo_dias"] == 1


def _grade_novo(materia, qualidade):
    pid = materia.criar_flashcard()
    _responder(materia, pid, qualidade >= 3, qualidade=qualidade)
    return pid
