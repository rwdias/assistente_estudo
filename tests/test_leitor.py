"""Progresso persistente e isolamento usando somente contas descartáveis."""
def test_progresso_retoma_e_ignora_requisicao_atrasada(usuario, criar_usuario, anon):
    caminho = f'{usuario.uid}/1/material.pdf'
    p = dict(p_caminho=caminho, p_pagina=42, p_atualizado_em='2026-09-16T12:00:00Z')
    usuario.rpc('salvar_progresso_leitura', p).raise_for_status()
    usuario.rpc('salvar_progresso_leitura', dict(p, p_pagina=12, p_atualizado_em='2026-09-17T12:00:00Z')).raise_for_status()
    usuario.rpc('salvar_progresso_leitura', p).raise_for_status()
    r = usuario.get('progresso_leitura')
    r.raise_for_status()
    assert len(r.json()) == 1
    assert r.json()[0]['pagina'] == 12
    outro = criar_usuario()
    assert outro.get('progresso_leitura').json() == []
    assert not outro.rpc('salvar_progresso_leitura', p).ok
    assert not anon.rpc('salvar_progresso_leitura', p).ok
    assert not usuario.rpc('salvar_progresso_leitura', dict(p, p_pagina=0)).ok
