#!/usr/bin/env python3
"""Interface web LOCAL de curadoria de provas do Study Rats.

  python curadoria.py            # abre http://127.0.0.1:8777

Serve a UI (curadoria.html) e uma API JSON por cima do núcleo de provas.py:
extração roda em thread de background (a IA demora minutos); revisão edita
os JSONs de revisao/; publicação vai ao catálogo no Supabase.

Só escuta em 127.0.0.1 — nunca expor: usa as credenciais do .env.
"""
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import provas

PORTA = 8777
BASE = Path(__file__).resolve().parent

# estado do job de extração (1 por vez)
JOB = {"ativo": False, "log": [], "erro": None, "arquivo": None}


def rodar_extracao(ano, area, maximo):
    JOB.update(ativo=True, log=[], erro=None, arquivo=None)
    try:
        destino = provas.extrair_enem(ano, area, maximo, log=JOB["log"].append)
        JOB["arquivo"] = destino.name
    except Exception as erro:  # noqa: BLE001 — erro vai para a UI
        JOB["erro"] = str(erro)
    finally:
        JOB["ativo"] = False


def nome_seguro(nome):
    """Restringe a arquivos .json dentro de revisao/ (sem path traversal)."""
    caminho = (provas.REVISAO / Path(nome).name).resolve()
    if caminho.suffix != ".json" or caminho.parent != provas.REVISAO.resolve():
        raise ValueError("arquivo inválido")
    return caminho


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # silencia o log de acesso

    def responder(self, corpo, status=200, tipo="application/json"):
        dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", f"{tipo}; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def corpo_json(self):
        tamanho = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(tamanho) or b"{}")

    def do_GET(self):
        try:
            if self.path in ("/", "/index.html"):
                self.responder((BASE / "curadoria.html").read_bytes(), tipo="text/html")
            elif self.path == "/api/config":
                self.responder({
                    "fontes": {"enem": {"areas": list(provas.ENEM_AREAS),
                                        "nomes": provas.ENEM_NOMES,
                                        "anos": list(range(2024, 2016, -1))}},
                })
            elif self.path.startswith("/api/imagem/"):
                import urllib.parse

                rel = urllib.parse.unquote(self.path.split("/api/imagem/", 1)[1])
                base = provas.CACHE.resolve()
                caminho = (base / rel).resolve()
                if not caminho.is_relative_to(base) or caminho.suffix != ".png":
                    raise ValueError("imagem inválida")
                self.responder(caminho.read_bytes(), tipo="image/png")
            elif self.path == "/api/job":
                self.responder(JOB)
            elif self.path == "/api/revisoes":
                provas.REVISAO.mkdir(exist_ok=True)
                arquivos = []
                for f in sorted(provas.REVISAO.glob("*.json")):
                    if ".bak-" in f.name:
                        continue
                    doc = json.loads(f.read_text())
                    qs = doc.get("questoes", [])
                    arquivos.append({
                        "arquivo": f.name, "nome": doc.get("nome"),
                        "questoes": len(qs),
                        "aprovadas": sum(1 for q in qs if q.get("aprovada")),
                    })
                self.responder(arquivos)
            elif self.path.startswith("/api/revisao/"):
                caminho = nome_seguro(self.path.split("/api/revisao/", 1)[1])
                self.responder(json.loads(caminho.read_text()))
            elif self.path == "/api/catalogo":
                self.responder(provas.listar_catalogo())
            else:
                self.responder({"erro": "rota desconhecida"}, 404)
        except FileNotFoundError:
            self.responder({"erro": "arquivo não encontrado"}, 404)
        except Exception as erro:  # noqa: BLE001
            self.responder({"erro": str(erro)}, 500)

    def do_PUT(self):
        try:
            if self.path.startswith("/api/revisao/"):
                caminho = nome_seguro(self.path.split("/api/revisao/", 1)[1])
                doc = self.corpo_json()
                if "questoes" not in doc:
                    raise ValueError("documento sem 'questoes'")
                caminho.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
                self.responder({"ok": True})
            else:
                self.responder({"erro": "rota desconhecida"}, 404)
        except Exception as erro:  # noqa: BLE001
            self.responder({"erro": str(erro)}, 500)

    def do_POST(self):
        try:
            if self.path == "/api/extrair":
                if JOB["ativo"]:
                    raise ValueError("já existe uma extração em andamento")
                corpo = self.corpo_json()
                if corpo.get("fonte") != "enem":
                    raise ValueError("fonte ainda não implementada (só 'enem')")
                ano = int(corpo["ano"])
                area = corpo["area"]
                maximo = int(corpo["max"]) if corpo.get("max") else None
                threading.Thread(
                    target=rodar_extracao, args=(ano, area, maximo), daemon=True
                ).start()
                self.responder({"ok": True})
            elif self.path == "/api/publicar":
                corpo = self.corpo_json()
                caminho = nome_seguro(corpo["arquivo"])
                r = provas.publicar_arquivo(caminho, bool(corpo.get("substituir")))
                self.responder(r)
            else:
                self.responder({"erro": "rota desconhecida"}, 404)
        except ValueError as erro:
            self.responder({"erro": str(erro)}, 400)
        except Exception as erro:  # noqa: BLE001
            self.responder({"erro": str(erro)}, 500)


def main():
    import sys

    servidor = ThreadingHTTPServer(("127.0.0.1", PORTA), Handler)
    url = f"http://127.0.0.1:{PORTA}"
    print(f"Curadoria de provas: {url}  (Ctrl+C para sair)")
    if "--sem-navegador" not in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nencerrado")


if __name__ == "__main__":
    main()
