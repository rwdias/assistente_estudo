const MAX_OPCOES = 6;

function renderOpcoesForm() {
  const container = document.getElementById('pergunta-opcoes-container');
  const linhas = container.querySelectorAll('.opcao-row').length;

  const row = document.createElement('div');
  row.className = 'opcao-row';
  row.innerHTML = `
    <input type="text" class="opcao-input" placeholder="${linhas === 0 ? 'Resposta correta' : 'Resposta errada'}" required />
    ${linhas === 0 ? '<span class="opcao-correta-badge">correta</span>' : ''}
  `;
  container.appendChild(row);
}

document.getElementById('add-opcao-btn').addEventListener('click', () => {
  const container = document.getElementById('pergunta-opcoes-container');
  if (container.querySelectorAll('.opcao-row').length >= MAX_OPCOES) {
    toast('Máximo de 6 alternativas.', 'error');
    return;
  }
  renderOpcoesForm();
});

function resetarFormPergunta() {
  document.getElementById('form-nova-pergunta').reset();
  const container = document.getElementById('pergunta-opcoes-container');
  container.innerHTML = '';
  renderOpcoesForm();
  renderOpcoesForm();
}

document.getElementById('form-nova-pergunta').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const enunciado = document.getElementById('pergunta-enunciado').value.trim();
  const dificuldade = document.getElementById('pergunta-dificuldade').value;
  const opcoes = Array.from(document.querySelectorAll('#pergunta-opcoes-container .opcao-input'))
    .map((i) => i.value.trim())
    .filter(Boolean);

  if (opcoes.length < 2) {
    toast('Preencha pelo menos duas alternativas.', 'error');
    return;
  }

  try {
    await api('POST', `/api/materias/${Estado.materiaId}/perguntas`, { enunciado, dificuldade, opcoes });
    toast('Pergunta adicionada.');
    resetarFormPergunta();
    carregarPerguntas();
  } catch (erro) {
    toast(erro.message, 'error');
  }
});

let perguntaParaRemover = null;

async function carregarPerguntas() {
  const lista = document.getElementById('lista-perguntas');

  if (!Estado.materiaId) {
    lista.innerHTML = '<p>Crie ou selecione uma matéria primeiro.</p>';
    return;
  }

  lista.innerHTML = '<p>Carregando...</p>';
  const perguntas = await api('GET', `/api/materias/${Estado.materiaId}/perguntas`);

  if (perguntas.length === 0) {
    lista.innerHTML = '<p>Nenhuma pergunta cadastrada ainda.</p>';
    return;
  }

  lista.innerHTML = perguntas
    .map(
      (p) => `
      <div class="pergunta-card">
        <div class="pergunta-enunciado">${esc(p.enunciado)}</div>
        <div class="pergunta-meta">
          <span class="badge badge-blue">Prova: ${esc(p.dificuldade)}</span>
          <span class="badge badge-amber">Para você: ${esc(p.dificuldade_pessoal)}</span>
          <span>${p.vezes_acertada}/${p.vezes_respondida} acertos</span>
          ${p.madura ? '<span class="badge badge-green">dominada</span>' : ''}
        </div>
        ${p.opcoes
          .map(
            (o) => `
            <div class="opcao-lista ${o.correta ? 'correta' : ''}">
              <span class="marcador"></span>
              <span>${esc(o.texto)}</span>
            </div>`
          )
          .join('')}
        <button type="button" class="btn btn-danger btn-sm remover-pergunta-btn" data-id="${p.id}" style="margin-top:10px">Remover</button>
      </div>`
    )
    .join('');

  lista.querySelectorAll('.remover-pergunta-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      perguntaParaRemover = Number(btn.dataset.id);
      openModal('modal-delete');
    });
  });
}

document.getElementById('modal-delete-confirm').addEventListener('click', async () => {
  if (perguntaParaRemover == null) return;

  try {
    await api('DELETE', `/api/perguntas/${perguntaParaRemover}`);
    closeModal('modal-delete');
    toast('Pergunta removida.');
    carregarPerguntas();
  } catch (erro) {
    toast(erro.message, 'error');
  } finally {
    perguntaParaRemover = null;
  }
});

resetarFormPergunta();
