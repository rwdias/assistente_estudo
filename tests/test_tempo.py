"""Tempo de estudo: usuários descartáveis, sem tocar nos dados do dono."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4


def payload(materia_id, segundos=60):
    fim = datetime.now(timezone.utc) - timedelta(seconds=1)
    return dict(p_id=str(uuid4()), p_materia_id=materia_id, p_modo='livre',
                p_inicio=(fim-timedelta(seconds=segundos)).isoformat(), p_fim=fim.isoformat())


def test_tempo_idempotente_e_monotonico(usuario, materia):
    p = payload(materia.materia_id)
    usuario.rpc('salvar_tempo_estudo', p).raise_for_status()
    usuario.rpc('salvar_tempo_estudo', p).raise_for_status()
    antigo = dict(p, p_fim=(datetime.fromisoformat(p['p_fim'])-timedelta(seconds=20)).isoformat())
    usuario.rpc('salvar_tempo_estudo', antigo).raise_for_status()
    r = usuario.rpc('resumo_tempo_estudo', {'p_fuso':'America/Sao_Paulo'})
    r.raise_for_status()
    assert len(r.json()) == 1
    assert r.json()[0]['total_segundos'] == 60


def test_tempo_isolado_por_usuario(usuario, materia, criar_usuario, anon):
    outro = criar_usuario()
    p = payload(materia.materia_id)
    usuario.rpc('salvar_tempo_estudo', p).raise_for_status()
    assert outro.get('sessoes_estudo').json() == []
    assert outro.rpc('resumo_tempo_estudo', {}).json() == []
    assert not outro.rpc('salvar_tempo_estudo', payload(materia.materia_id)).ok
    assert not outro.rpc('salvar_tempo_estudo', p).ok
    assert not anon.rpc('resumo_tempo_estudo', {}).ok


def test_tempo_cruza_meia_noite(usuario, materia):
    agora = datetime.now(timezone.utc)
    meia_noite = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    p = dict(p_id=str(uuid4()), p_materia_id=materia.materia_id, p_modo='pomodoro',
             p_inicio=(meia_noite-timedelta(seconds=30)).isoformat(),
             p_fim=(meia_noite+timedelta(seconds=30)).isoformat())
    usuario.rpc('salvar_tempo_estudo', p).raise_for_status()
    r = usuario.rpc('resumo_tempo_estudo', {'p_fuso':'UTC'})
    r.raise_for_status()
    assert r.json()[0]['total_segundos'] == 60
    assert r.json()[0]['hoje_segundos'] == min(30, int((agora-meia_noite).total_seconds()))
