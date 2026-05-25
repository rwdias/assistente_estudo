import streamlit as st


def render_sidebar() -> dict:
    """
    Renderiza a sidebar principal do aplicativo.

    Retorna um dicionário com todos os valores configurados pelo usuário.
    """

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

    return {
        "pagina": pagina,
        "modelo": modelo,
        "token": token,
        "titulo": titulo,
        "assunto": assunto,
        "dificuldade": dificuldade,
        "quantidade": quantidade,
        "embaralhar": embaralhar,
    }


def render_question_form(assunto: str, dificuldade: str) -> dict | None:
    """
    Renderiza o formulário de criação de pergunta.

    Regra atual:
    - A primeira opção é sempre a correta.
    - As demais opções são incorretas.

    Retorna um dicionário com a pergunta salva ou None se nada for enviado.
    """

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

        if not salvar:
            return None

        opcoes_validas = [opcao.strip() for opcao in opcoes if opcao.strip()]

        if not enunciado.strip():
            st.error("O enunciado da pergunta é obrigatório.")
            return None

        if len(opcoes_validas) != quantidade_opcoes:
            st.error("Preencha todas as opções antes de salvar.")
            return None

        return {
            "enunciado": enunciado.strip(),
            "opcoes": opcoes_validas,
            "indice_correto": 0,
            "resposta_correta": opcoes_validas[0],
            "assunto": assunto,
            "dificuldade": dificuldade,
        }


def render_question_list(perguntas: list[dict]) -> None:
    """
    Renderiza a lista de perguntas cadastradas em memória.
    """

    st.subheader("Perguntas cadastradas")

    if len(perguntas) == 0:
        st.info("Nenhuma pergunta cadastrada ainda.")
        return

    for i, pergunta in enumerate(perguntas, start=1):
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


def render_quiz_question(pergunta: dict, numero: int) -> None:
    """
    Renderiza uma pergunta durante o simulado.
    """

    st.markdown(
        f"""
        <div class="question-card">
            <div class="question-title">Questão {numero}</div>
            <p>{pergunta["enunciado"]}</p>
        </div>
        """,
        unsafe_allow_html=True
    )

    resposta = st.radio(
        "Selecione uma alternativa:",
        pergunta["opcoes"],
        key=f"resposta_simulado_{numero}"
    )

    if resposta == pergunta["resposta_correta"]:
        st.success("Resposta correta.")
    else:
        st.error("Resposta incorreta.")