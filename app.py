from pathlib import Path

import streamlit as st
from src.utils import carregar_css
from src.ui_components import (
    render_question_form,
    render_question_list,
    render_quiz_question,
    render_sidebar,
)

from src.database import criar_tabelas

criar_tabelas()

st.set_page_config(
    page_title="Assistente de Estudo",
    layout="wide"
)

carregar_css("assets/style.css")


if "perguntas" not in st.session_state:
    st.session_state.perguntas = []


sidebar = render_sidebar()

pagina = sidebar["pagina"]
modelo = sidebar["modelo"]
titulo = sidebar["titulo"]
assunto = sidebar["assunto"]
dificuldade = sidebar["dificuldade"]
quantidade = sidebar["quantidade"]
embaralhar = sidebar["embaralhar"]


if pagina == "Configurar Simulado":
    st.title(titulo)

    st.write(f"**Modelo LLM:** {modelo}")
    st.write(f"**Assunto:** {assunto}")
    st.write(f"**Dificuldade:** {dificuldade}")
    st.write(f"**Quantidade de questões:** {quantidade}")
    st.write(f"**Embaralhar:** {'Sim' if embaralhar else 'Não'}")

    st.divider()

    col1, col2, col3 = st.columns(3)

    with col1:
        st.metric("Perguntas cadastradas", len(st.session_state.perguntas))

    with col2:
        st.metric("Questões desejadas", quantidade)

    with col3:
        faltantes = max(quantidade - len(st.session_state.perguntas), 0)
        st.metric("Faltam cadastrar", faltantes)

    st.divider()

    iniciar = st.button("Iniciar simulado")

    if iniciar:
        if len(st.session_state.perguntas) == 0:
            st.warning("Nenhuma pergunta foi cadastrada ainda.")

        elif len(st.session_state.perguntas) < quantidade:
            st.warning(
                f"Você selecionou {quantidade} questões, mas cadastrou apenas "
                f"{len(st.session_state.perguntas)}."
            )

        else:
            st.subheader("Questões do Simulado")

            perguntas_para_exibir = st.session_state.perguntas[:quantidade]

            for i, pergunta in enumerate(perguntas_para_exibir, start=1):
                render_quiz_question(pergunta, i)
                st.divider()

    else:
        st.info("Configure o simulado na barra lateral e clique em iniciar.")


elif pagina == "Criar Perguntas":
    st.title("Criar Perguntas")

    st.write(
        "Cadastre manualmente as perguntas do simulado. A primeira opção será "
        "considerada a resposta correta; as demais serão consideradas erradas."
    )

    st.divider()

    pergunta = render_question_form(
        assunto=assunto,
        dificuldade=dificuldade
    )

    if pergunta is not None:
        st.session_state.perguntas.append(pergunta)
        st.success("Pergunta adicionada com sucesso.")

    st.divider()

    render_question_list(st.session_state.perguntas)

    st.divider()

    if len(st.session_state.perguntas) > 0:
        if st.button("Limpar todas as perguntas"):
            st.session_state.perguntas = []
            st.rerun()