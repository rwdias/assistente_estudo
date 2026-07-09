from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from src.api.routers import auth, ia, materias, perguntas, revisao, simulado
from src.database import criar_tabelas

load_dotenv()
criar_tabelas()

app = FastAPI(title="Study Rats")

app.include_router(auth.router)
app.include_router(materias.router)
app.include_router(perguntas.router)
app.include_router(simulado.router)
app.include_router(revisao.router)
app.include_router(ia.router)

WEB_DIR = Path(__file__).resolve().parent.parent.parent / "web"
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
