"""Utilitários compartilhados pela suíte.

Regras de ouro (ver docs/TESTES.md):
- Todo dado de teste vive num USUÁRIO DESCARTÁVEL, removido no teardown.
- NUNCA imprimir valores do .env (segredos) em log/asserção.
- url e anon key vêm do próprio front (web/js/config.js) — a anon key é PÚBLICA
  por design; a barreira é o RLS.
"""
import os
import re
import uuid

import requests

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def carregar_env():
    """Lê o .env (git-ignorado) para um dict. Não logar os valores."""
    env = {}
    caminho = os.path.join(RAIZ, ".env")
    with open(caminho) as f:
        for linha in f:
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                env[k] = v
    return env


def config_front():
    """Extrai url + anon key de web/js/config.js (fonte única, evita drift)."""
    texto = open(os.path.join(RAIZ, "web", "js", "config.js")).read()
    url = re.search(r"url:\s*'([^']+)'", texto).group(1)
    anon = re.search(r"anonKey:\s*'([^']+)'", texto).group(1)
    return url, anon


class Cliente:
    """Cliente REST/RPC autenticado como um usuário (respeita RLS)."""

    def __init__(self, url, anon, token=None):
        self.url = url
        self.anon = anon
        self.token = token

    def _headers(self, extra=None):
        # Sem token => papel 'anon' (deve ser barrado pelo RLS em quase tudo).
        h = {
            "apikey": self.anon,
            "Authorization": f"Bearer {self.token or self.anon}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def get(self, tabela, params="", **extra_headers):
        return requests.get(
            f"{self.url}/rest/v1/{tabela}{params}",
            headers=self._headers(extra_headers),
        )

    def post(self, tabela, body, retornar=True):
        h = self._headers({"Prefer": "return=representation"} if retornar else None)
        return requests.post(f"{self.url}/rest/v1/{tabela}", headers=h, json=body)

    def patch(self, tabela, params, body):
        return requests.patch(
            f"{self.url}/rest/v1/{tabela}{params}",
            headers=self._headers({"Prefer": "return=representation"}),
            json=body,
        )

    def delete(self, tabela, params):
        return requests.delete(f"{self.url}/rest/v1/{tabela}{params}", headers=self._headers())

    def rpc(self, funcao, args):
        """Chama uma função SQL (SECURITY INVOKER roda sob o RLS deste usuário)."""
        return requests.post(
            f"{self.url}/rest/v1/rpc/{funcao}",
            headers=self._headers(),
            json=args,
        )

    def edge(self, funcao, body, origin="http://localhost:8001"):
        """Chama uma Edge Function (auth validada DENTRO da função)."""
        h = self._headers({"Origin": origin})
        return requests.post(f"{self.url}/functions/v1/{funcao}", headers=h, json=body)


class Admin:
    """Operações com service_role (bypassa RLS) — só para criar/limpar
    usuários descartáveis e para asserções de verificação fora do RLS."""

    def __init__(self, url, service_key):
        self.url = url
        self.h = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def criar_usuario(self):
        email = f"t-{uuid.uuid4().hex[:8]}@example.com"
        senha = "SenhaTeste123!"
        r = requests.post(
            f"{self.url}/auth/v1/admin/users",
            headers=self.h,
            json={
                "email": email,
                "password": senha,
                "email_confirm": True,
                "user_metadata": {"nome": "T", "objetivo": "t", "nascimento": "2000-01-01"},
            },
        )
        r.raise_for_status()
        return {"uid": r.json()["id"], "email": email, "senha": senha}

    def token(self, email, senha, anon):
        r = requests.post(
            f"{self.url}/auth/v1/token?grant_type=password",
            headers={"apikey": anon, "Content-Type": "application/json"},
            json={"email": email, "password": senha},
        )
        r.raise_for_status()
        return r.json()["access_token"]

    def deletar_usuario(self, uid):
        requests.delete(f"{self.url}/auth/v1/admin/users/{uid}", headers=self.h)

    def get(self, tabela, params=""):
        # leitura fora do RLS, para verificar o estado real do banco
        return requests.get(f"{self.url}/rest/v1/{tabela}{params}", headers=self.h)
