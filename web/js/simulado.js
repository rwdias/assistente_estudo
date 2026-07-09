let simuladoQuestions = [];
let simuladoAcertos = 0;

document.getElementById('iniciar-simulado-btn').addEventListener('click', iniciarSimulado);

async function iniciarSimulado() {
  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const dificuldade = document.getElementById('simulado-dificuldade').value;
  const quantidade = document.getElementById('simulado-quantidade').value;
  const embaralhar = document.getElementById('simulado-embaralhar').checked;

  const params = new URLSearchParams();
  if (dificuldade) params.set('dificuldade', dificuldade);
  if (quantidade) params.set('quantidade', quantidade);
  params.set('embaralhar', embaralhar);

  try {
    simuladoQuestions = await api(
      'GET',
      `/api/materias/${Estado.materiaId}/simulado?${params.toString()}`
    );
  } catch (erro) {
    toast(erro.message, 'error');
    return;
  }

  if (simuladoQuestions.length === 0) {
    toast('Nenhuma pergunta encontrada com esses filtros.', 'error');
    return;
  }

  simuladoAcertos = 0;
  document.getElementById('simulado-config').style.display = 'none';
  document.getElementById('simulado-quiz').style.display = 'block';
  renderSimulado();
}

function atualizarPlacarSimulado() {
  const el = document.getElementById('simulado-score');
  if (el) el.textContent = `${simuladoAcertos}/${simuladoQuestions.length}`;
}

function renderSimulado() {
  const container = document.getElementById('simulado-quiz');

  container.innerHTML = `
    <div class="stat-grid stat-grid-3">
      <div class="stat-card">
        <div class="stat-valor brand" id="simulado-score">0/${simuladoQuestions.length}</div>
        <div class="stat-rotulo">acertos</div>
      </div>
    </div>
    ${simuladoQuestions.map((p, i) => renderPerguntaQuizHTML(p, `sim-${i}`)).join('')}
    <button type="button" class="btn btn-secondary" id="novo-simulado-btn">Novo simulado</button>
  `;

  simuladoQuestions.forEach((pergunta, i) => {
    wirePerguntaQuiz(pergunta, `sim-${i}`, async (correta) => {
      if (correta) simuladoAcertos += 1;
      atualizarPlacarSimulado();

      try {
        await api('POST', `/api/perguntas/${pergunta.id}/responder`, { correta });
      } catch (erro) {
        toast(erro.message, 'error');
      }
    });
  });

  document.getElementById('novo-simulado-btn').addEventListener('click', () => {
    document.getElementById('simulado-quiz').style.display = 'none';
    document.getElementById('simulado-config').style.display = 'block';
  });
}
