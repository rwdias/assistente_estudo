let extracaoPendente = [];

document.getElementById('ia-extrair-btn').addEventListener('click', async () => {
  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const modelo = document.getElementById('ia-modelo').value;
  const texto = document.getElementById('ia-texto').value.trim();

  if (!texto) {
    toast('Cole algum texto primeiro.', 'error');
    return;
  }

  const btn = document.getElementById('ia-extrair-btn');
  btn.disabled = true;
  btn.textContent = `Consultando ${modelo}...`;

  try {
    extracaoPendente = await api('POST', '/api/ia/extrair', {
      materia_id: Estado.materiaId,
      modelo,
      texto,
      dificuldade_padrao: 'Média',
    });
    renderIaPreview();
    toast(`${extracaoPendente.length} pergunta(s) extraída(s).`);
  } catch (erro) {
    toast(erro.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extrair perguntas';
  }
});

function renderIaPreview() {
  const container = document.getElementById('ia-preview');

  if (extracaoPendente.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <h2>Revise antes de salvar</h2>
    ${extracaoPendente.map((p, i) => renderIaItemHTML(p, i)).join('')}
    <button type="button" class="btn btn-primary" id="ia-salvar-btn">Salvar perguntas selecionadas</button>
  `;

  document.getElementById('ia-salvar-btn').addEventListener('click', salvarExtracao);
}

function renderIaItemHTML(pergunta, indice) {
  return `
    <div class="pergunta-card" data-idx="${indice}">
      <label class="checkbox-label">
        <input type="checkbox" class="ia-incluir" checked /> Incluir esta pergunta ao salvar
      </label>

      <label>Enunciado</label>
      <textarea class="ia-enunciado" rows="2">${esc(pergunta.enunciado)}</textarea>

      <label>Dificuldade</label>
      <select class="ia-dificuldade">
        ${['Fácil', 'Média', 'Difícil']
          .map((d) => `<option ${d === pergunta.dificuldade ? 'selected' : ''}>${d}</option>`)
          .join('')}
      </select>

      <label>Alternativas (marque a correta)</label>
      ${pergunta.opcoes
        .map(
          (o, j) => `
        <div class="opcao-row">
          <input type="radio" name="ia-correta-${indice}" class="ia-correta-radio" value="${j}" ${o.correta ? 'checked' : ''} />
          <input type="text" class="ia-opcao-texto" value="${esc(o.texto)}" />
        </div>`
        )
        .join('')}

      <label>Tópico (opcional)</label>
      <input type="text" class="ia-topico" value="${esc(pergunta.topico || '')}" />
    </div>
  `;
}

async function salvarExtracao() {
  const cards = document.querySelectorAll('#ia-preview .pergunta-card');
  const perguntas = [];

  cards.forEach((card) => {
    const incluir = card.querySelector('.ia-incluir').checked;
    if (!incluir) return;

    const enunciado = card.querySelector('.ia-enunciado').value.trim();
    const dificuldade = card.querySelector('.ia-dificuldade').value;
    const topico = card.querySelector('.ia-topico').value.trim() || null;
    const textos = Array.from(card.querySelectorAll('.ia-opcao-texto')).map((i) => i.value.trim());
    const indiceCorreto = Number(card.querySelector('.ia-correta-radio:checked')?.value ?? 0);

    perguntas.push({
      enunciado,
      dificuldade,
      topico,
      opcoes: textos.map((texto, j) => ({ texto, correta: j === indiceCorreto })),
    });
  });

  if (perguntas.length === 0) {
    toast('Nenhuma pergunta selecionada.', 'error');
    return;
  }

  try {
    const resultado = await api('POST', '/api/ia/salvar', {
      materia_id: Estado.materiaId,
      perguntas,
    });
    toast(`Salvas: ${resultado.salvas} · Duplicadas: ${resultado.duplicadas} · Inválidas: ${resultado.invalidas}`);
    extracaoPendente = [];
    document.getElementById('ia-preview').innerHTML = '';
    document.getElementById('ia-texto').value = '';
  } catch (erro) {
    toast(erro.message, 'error');
  }
}
