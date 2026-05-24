from pathlib import Path
from utils import carregar_css

import streamlit as st

# =========================
# Configuração inicial
# =========================

st.set_page_config(
    page_title="Assistente de Estudo",
    layout="wide"
)

# =========================
# Carregar CSS
# =========================

carregar_css("assets/style.css")

# =========================
# Estado da aplicação
# =========================

if "perguntas" not in st.session_state:
    st.session_state.perguntas = []


# =========================
# Sidebar
# =========================

with st.sidebar:
    st.header("Assistente de Estudo")

    pagina = st.radio(
        "Navegação",
        ["Configurar Simulado", "Criar Perguntas"],
        index=0
    )

    st.divider()

    modelo = st.selectbox(
        "Modelo LLM",
        ["ChatGPT", "Grok", "Claude"]
    )

    token = st.text_input(
        "Insira seu Token",
        type="password"
    )

    titulo = st.text_input(
        "Título do simulado",
        "Simulado de Machine Learning"
    )

    assunto = st.selectbox(
        "Assunto",
        ["Machine Learning", "Python", "Estatística", "Databricks", "MLOps"]
    )

    dificuldade = st.selectbox(
        "Dificuldade",
        ["Fácil", "Média", "Difícil"]
    )

    quantidade = st.slider(
        "Quantidade de questões",
        min_value=1,
        max_value=60,
        value=5
    )

    embaralhar = st.checkbox(
        "Embaralhar questões",
        value=True
    )


# =========================
# Página: Configurar Simulado
# =========================

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
                st.markdown(
                    f"""
                    <div class="question-card">
                        <div class="question-title">Questão {i}</div>
                        <p>{pergunta["enunciado"]}</p>
                    </div>
                    """,
                    unsafe_allow_html=True
                )

                resposta = st.radio(
                    "Selecione uma alternativa:",
                    pergunta["opcoes"],
                    key=f"resposta_simulado_{i}"
                )

                if resposta == pergunta["resposta_correta"]:
                    st.success("Resposta correta.")
                else:
                    st.error("Resposta incorreta.")

                st.divider()

    else:
        st.info("Configure o simulado na barra lateral e clique em iniciar.")


# =========================
# Página: Criar Perguntas
# =========================

elif pagina == "Criar Perguntas":
    st.title("Criar Perguntas")

    st.write(
        "Cadastre manualmente as perguntas do simulado. A primeira opção será "
        "considerada a resposta correta; as demais serão consideradas erradas."
    )

    st.divider()

    with st.form("form_criar_pergunta", clear_on_submit=True):
        enunciado = st.text_area(
            "Enunciado da pergunta",
            placeholder="Digite a pergunta aqui...",
            height=120
        )

        quantidade_opcoes = st.selectbox(
            "Quantidade de opções",
            [2, 3, 4, 5, 6],
            index=2
        )

        opcoes = []

        st.markdown(
            """
            <div class="answer-instruction">
                A primeira opção será considerada a resposta correta. 
                As demais serão respostas erradas.
            </div>
            """,
            unsafe_allow_html=True
        )

        for i in range(quantidade_opcoes):
            if i == 0:
                st.markdown(
                    '<div class="correct-option-label">Resposta correta</div>',
                    unsafe_allow_html=True
                )

                opcao = st.text_input(
                    "Opção 1",
                    key=f"opcao_{i}",
                    placeholder="Digite a resposta correta"
                )

            else:
                st.markdown(
                    f'<div class="wrong-option-label">Resposta errada {i}</div>',
                    unsafe_allow_html=True
                )

                opcao = st.text_input(
                    f"Opção {i + 1}",
                    key=f"opcao_{i}",
                    placeholder=f"Digite a resposta errada {i}"
                )

            opcoes.append(opcao)

        salvar = st.form_submit_button("Adicionar pergunta")

        if salvar:
            opcoes_validas = [opcao.strip() for opcao in opcoes if opcao.strip()]

            if not enunciado.strip():
                st.error("O enunciado da pergunta é obrigatório.")

            elif len(opcoes_validas) != quantidade_opcoes:
                st.error("Preencha todas as opções antes de salvar.")

            else:
                pergunta = {
                    "enunciado": enunciado.strip(),
                    "opcoes": opcoes_validas,
                    "indice_correto": 0,
                    "resposta_correta": opcoes_validas[0],
                    "assunto": assunto,
                    "dificuldade": dificuldade
                }

                st.session_state.perguntas.append(pergunta)
                st.success("Pergunta adicionada com sucesso.")

    st.divider()

    st.subheader("Perguntas cadastradas")

    if len(st.session_state.perguntas) == 0:
        st.info("Nenhuma pergunta cadastrada ainda.")

    else:
        for i, pergunta in enumerate(st.session_state.perguntas, start=1):
            with st.expander(f"Pergunta {i}: {pergunta['enunciado'][:80]}"):
                st.write(f"**Enunciado:** {pergunta['enunciado']}")
                st.write(f"**Assunto:** {pergunta['assunto']}")
                st.write(f"**Dificuldade:** {pergunta['dificuldade']}")

                st.write("**Opções:**")

                for j, opcao in enumerate(pergunta["opcoes"], start=1):
                    if j - 1 == pergunta["indice_correto"]:
                        st.markdown(f"- **{j}. {opcao}** ← correta")
                    else:
                        st.markdown(f"- {j}. {opcao}")

                remover = st.button(
                    f"Remover pergunta {i}",
                    key=f"remover_{i}"
                )

                if remover:
                    st.session_state.perguntas.pop(i - 1)
                    st.rerun()

        st.divider()

        if st.button("Limpar todas as perguntas"):
            st.session_state.perguntas = []
            st.rerun()