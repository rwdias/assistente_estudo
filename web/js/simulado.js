let simuladoQuestions = [];
let simuladoAcertos = 0;

document.getElementById('iniciar-simulado-btn').addEventListener('click', iniciarSimulado);

async function iniciarSimulado() {
  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const quantidade = Number(document.getElementById('simulado-quantidade').value) || 5;
  const embaralhar = document.getElementById('simulado-embaralhar').checked;

  let perguntas;
  try {
    perguntas = await buscarPerguntasDaMateria(Estado.materiaId);
  } catch (erro) {
    toast(erro.message, 'error');
    return;
  }

  // simulado é só múltipla escolha — flashcards vivem na Revisão
  perguntas = perguntas.filter((p) => p.tipo !== 'flashcard');

  if (embaralhar) {
    for (let i = perguntas.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perguntas[i], perguntas[j]] = [perguntas[j], perguntas[i]];
    }
  }

  simuladoQuestions = perguntas.slice(0, quantidade);

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

      const { error } = await sb.rpc('registrar_resposta', {
        p_pergunta_id: pergunta.id,
        p_correta: correta,
      });
      if (error) toast(error.message, 'error');
    });
  });

  document.getElementById('novo-simulado-btn').addEventListener('click', () => {
    document.getElementById('simulado-quiz').style.display = 'none';
    document.getElementById('simulado-config').style.display = 'block';
  });
}
