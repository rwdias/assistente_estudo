def _cadastrar(cliente, email, senha="senhacorreta123"):
    resposta = cliente.post("/api/auth/cadastro", json={"email": email, "senha": senha})
    assert resposta.status_code == 200
    token = resposta.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_usuario_nao_ve_materia_de_outro(cliente):
    cabecalho_a = _cadastrar(cliente, "isolamento-a@example.com")
    cabecalho_b = _cadastrar(cliente, "isolamento-b@example.com")

    materia = cliente.post(
        "/api/materias", json={"nome": "Matéria da A"}, headers=cabecalho_a
    ).json()

    resposta_b = cliente.get(
        f"/api/materias/{materia['id']}/perguntas", headers=cabecalho_b
    )
    assert resposta_b.status_code == 404

    materias_de_b = cliente.get("/api/materias", headers=cabecalho_b).json()
    assert all(m["id"] != materia["id"] for m in materias_de_b)


def test_usuario_nao_deleta_pergunta_de_outro(cliente):
    cabecalho_a = _cadastrar(cliente, "isolamento-c@example.com")
    cabecalho_b = _cadastrar(cliente, "isolamento-d@example.com")

    materia = cliente.post(
        "/api/materias", json={"nome": "Matéria da C"}, headers=cabecalho_a
    ).json()
    pergunta = cliente.post(
        f"/api/materias/{materia['id']}/perguntas",
        json={"enunciado": "2+2=?", "opcoes": ["4", "5"], "dificuldade": "Fácil"},
        headers=cabecalho_a,
    ).json()

    resposta = cliente.delete(
        f"/api/perguntas/{pergunta['id']}", headers=cabecalho_b
    )
    assert resposta.status_code == 404

    # a pergunta continua existindo para o dono
    lista = cliente.get(
        f"/api/materias/{materia['id']}/perguntas", headers=cabecalho_a
    ).json()
    assert any(p["id"] == pergunta["id"] for p in lista)


def test_requisicao_sem_token_e_401(cliente):
    resposta = cliente.get("/api/materias")
    assert resposta.status_code == 401


def test_token_de_outro_formato_e_401(cliente):
    resposta = cliente.get(
        "/api/materias", headers={"Authorization": "Bearer token-invalido"}
    )
    assert resposta.status_code == 401
