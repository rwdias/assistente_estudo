from pathlib import Path

import streamlit as st
from src.utils import carregar_css
from src.ui_components import (
    render_question_form,
    render_question_list,
    render_quiz_question,
    render_sidebar,
)

from src.database import criar_tabelas, criar_materia, listar_materias, buscar_materia_por_nome, criar_subdivisao

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
# titulo = sidebar["titulo"]
# assunto = sidebar["assunto"]
# dificuldade = sidebar["dificuldade"]
# quantidade = sidebar["quantidade"]
# embaralhar = sidebar["embaralhar"]


if pagina == "Configurar Simulado":
    st.title("titulo")

    st.write(f"**Modelo LLM:** {modelo}")

    st.divider()




elif pagina == "Criar Perguntas":
    st.title("Criar Perguntas")

    st.write(
        "Cadastre manualmente as perguntas do simulado. A primeira opção será "
        "considerada a resposta correta; as demais serão consideradas erradas."
    )

    st.divider()
    
    
    materias = listar_materias(so_nome=True)
    materia = st.selectbox(
            "Selecione a matéria",
            materias)
        
    id_materia = int(buscar_materia_por_nome(materia, so_id=True))


            
            
elif pagina == "Criar Matéria":
    st.title("Criar Matérias e Assuntos")

    st.write(
        "Cadastre as matérias a serem utilizadas"
    )

    st.divider()
    with st.form("form_criar_materias", clear_on_submit=True):
        materia = st.text_input(
                        "Matéria",
                        key=f"materia",
                        placeholder="Digite a matéria a ser inserida"
                    )
        

        descricao = st.text_input(
                        "Descrição",
                        key=f"descricao",
                        placeholder="Insira uma descrição"
                    )
        
        
        salvar = st.form_submit_button("Adicionar matéria")
        
        if salvar:
            if not materia.strip() or not descricao.strip():
                st.error("Nenhum campo pode estar vazio.")
            else:
                # Executa a lógica de salvar no banco de dados aqui
                criar_materia(materia.strip(), descricao.strip())
                st.success("Pergunta adicionada com sucesso!")
        
    st.divider()

    st.subheader("Criar subdivisões / temas para matérias")
    
    with st.form("form_criar_subdivisoes", clear_on_submit=True):
        materias = listar_materias(so_nome=True)
        materia = st.selectbox(
            "Selecione a matéria",
            materias)
        
        id_materia = int(buscar_materia_por_nome(materia, so_id=True))
        
        
        subdivisao = st.text_input(
            "Subdivisão",
            key="subdivisao",
            placeholder="Digite os temas separados por vírgula (Ex: Álgebra, Geometria)"
        ) 

        subdivisao_list = [item.strip() for item in subdivisao.split(",") if item.strip()]
        
        
        
        salvar = st.form_submit_button("Adicionar matéria")
        if salvar:
            if not subdivisao.strip():
                st.error("Nenhum campo pode estar vazio.")
            else:
                # Executa a lógica de salvar no banco de dados aqui
                for item in subdivisao_list:
                    criar_subdivisao(id_materia, item)
                st.success("Pergunta adicionada com sucesso!")
        
    
    
    
