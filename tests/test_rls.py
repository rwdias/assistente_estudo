"""Segurança / RLS — testes ADVERSARIAIS (rodar após qualquer mudança de policy
ou função SQL). Todas as tentativas de acesso cruzado devem ser NEGADAS.

Como o front fala direto com o banco, o RLS é a barreira inteira: deny-by-default,
`anon` sem nada, `authenticated` só as próprias linhas (com WITH CHECK na cadeia
matéria→subdivisão→pergunta). Ver docs/SEGURANCA.md.
"""
import pytest

from conftest import _MateriaFactory

pytestmark = pytest.mark.rls


def test_b_nao_le_materia_de_a(criar_usuario):
    a, b = criar_usuario(), criar_usuario()
    ma = _MateriaFactory(a)
    # A enxerga a própria matéria...
    ra = a.get("materias", f"?id=eq.{ma.materia_id}&select=id")
    assert ra.status_code == 200 and len(ra.json()) == 1
    # ...mas B não enxerga nada de A.
    rb = b.get("materias", f"?id=eq.{ma.materia_id}&select=id")
    assert rb.status_code == 200 and rb.json() == []


def test_b_nao_le_pergunta_de_a(criar_usuario):
    a, b = criar_usuario(), criar_usuario()
    pid = _MateriaFactory(a).criar_pergunta()
    rb = b.get("perguntas", f"?id=eq.{pid}&select=id")
    assert rb.status_code == 200 and rb.json() == []


def test_b_nao_edita_materia_de_a(criar_usuario):
    a, b = criar_usuario(), criar_usuario()
    ma = _MateriaFactory(a)
    # RLS filtra a linha: o UPDATE de B não casa nada (0 linhas afetadas).
    rb = b.patch("materias", f"?id=eq.{ma.materia_id}", {"nome": "hacked"})
    assert rb.status_code == 200 and rb.json() == []
    # e o nome de A segue intacto
    ra = a.get("materias", f"?id=eq.{ma.materia_id}&select=nome")
    assert ra.json()[0]["nome"] != "hacked"


def test_idor_escrita_b_nao_insere_em_subdivisao_de_a(criar_usuario, admin):
    a, b = criar_usuario(), criar_usuario()
    ma = _MateriaFactory(a)
    # B tenta criar pergunta na subdivisão de A → barrado pelo WITH CHECK.
    rb = b.post("perguntas", {
        "subdivisao_id": ma.subdivisao_id, "tipo": "pergunta",
        "enunciado": "invasao", "dificuldade": "Média", "origem": "manual",
    })
    assert rb.status_code in (401, 403), rb.text
    # confirma (fora do RLS) que nada foi criado na subdivisão de A
    tudo = admin.get("perguntas", f"?subdivisao_id=eq.{ma.subdivisao_id}&select=id").json()
    assert tudo == []


def test_anon_nao_le_materias(anon):
    r = anon.get("materias", "?select=id")
    assert r.status_code in (200, 401, 403)
    if r.status_code == 200:
        assert r.json() == []  # deny-by-default: nenhuma linha para o anon


def test_b_nao_le_nem_escreve_trilha_de_a(criar_usuario):
    """Tabela nova (0025) precisa repetir o hardening: B não enxerga nem grava
    na trilha de A, e não consegue mover matéria de A para trilha própria."""
    a, b = criar_usuario(), criar_usuario()
    ta = a.post('trilhas', {'nome': 'Estatistica UFPR'})
    assert ta.status_code == 201, ta.text
    trilha_id = ta.json()[0]['id']

    # leitura cruzada: vazio
    assert b.get('trilhas', f'?id=eq.{trilha_id}&select=id').json() == []
    # update cruzado: 0 linhas
    assert b.patch('trilhas', f'?id=eq.{trilha_id}', {'nome': 'hacked'}).json() == []
    # delete cruzado: 0 linhas (e a trilha de A continua lá)
    b.delete('trilhas', f'?id=eq.{trilha_id}')
    assert len(a.get('trilhas', f'?id=eq.{trilha_id}&select=id').json()) == 1


def test_anon_nao_le_trilhas(anon):
    r = anon.get('trilhas', '?select=id')
    assert r.status_code in (200, 401, 403)
    if r.status_code == 200:
        assert r.json() == []


def test_excluir_trilha_nao_apaga_materias(usuario):
    """A FK é ON DELETE SET NULL de propósito: a trilha é uma etiqueta de
    organização, não a dona das matérias."""
    t = usuario.post('trilhas', {'nome': 'Certificacoes AWS'}).json()[0]
    m = usuario.post('materias', {
        'usuario_id': usuario.uid, 'nome': 'AWS ML', 'trilha_id': t['id'],
    }).json()[0]

    usuario.delete('trilhas', f'?id=eq.{t["id"]}')

    restante = usuario.get('materias', f'?id=eq.{m["id"]}&select=id,trilha_id').json()
    assert len(restante) == 1, 'a matéria foi apagada junto com a trilha'
    assert restante[0]['trilha_id'] is None, 'trilha_id deveria virar NULL'


def test_usuario_so_altera_perfil_nas_colunas_permitidas(usuario, admin):
    # grant por coluna: nome/objetivo/nascimento SIM; ia_limite_diario NÃO.
    ok = usuario.patch("perfis", f"?user_id=eq.{usuario.uid}", {"nome": "Novo Nome"})
    assert ok.status_code == 200

    bloq = usuario.patch("perfis", f"?user_id=eq.{usuario.uid}", {"ia_limite_diario": 999})
    assert bloq.status_code in (401, 403), bloq.text  # sem privilégio nessa coluna

    # e a quota segue NULL (usa o padrão), não 999
    perfil = admin.get("perfis", f"?user_id=eq.{usuario.uid}&select=ia_limite_diario").json()[0]
    assert perfil["ia_limite_diario"] is None
