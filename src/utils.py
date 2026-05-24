from pathlib import Path
import streamlit as st


def carregar_css(caminho_css: str) -> None:
    css_path = Path(caminho_css)

    if not css_path.exists():
        st.warning(f"Arquivo CSS não encontrado: {caminho_css}")
        return

    with open(css_path, "r", encoding="utf-8") as arquivo:
        css = arquivo.read()

    st.markdown(
        f"<style>{css}</style>",
        unsafe_allow_html=True
    )

carregar_css("assets/style.css")
