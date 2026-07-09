let revisaoFila = [];
let revisaoIndice = 0;
let revisaoAcertos = 0;
let revisaoErros = 0;

async function carregarRevisao() {
  const resumo = document.getElementById('revisao-resumo');
  const atual = document.getElementById('revisao-atual');

  if (!Estado.materiaId) {
    resumo.innerHTML = '';
    atual.innerHTML = '<p>Crie ou selecione uma matéria primeiro.</p>';
    return;
  }

  atual.innerHTML = '<p>Carregando...</p>';

  try {
    revisaoFila = await api('GET', `/api/materias/${Estado.materiaId}/revisao`);
  } catch (erro) {
    toast(erro.message, 'error');
    return;
  }

  revisaoIndice = 0;
  revisaoAcertos = 0;
  revisaoErros = 0;
  renderRevisaoAtual();
}

function renderResumoRevisao() {
  document.getElementById('revisao-resumo').innerHTML = `
    <div class="stat-card">
      <div class="stat-valor brand">${Math.max(revisaoFila.length - revisaoIndice, 0)}</div>
      <div class="stat-rotulo">restantes</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor">${revisaoAcertos}</div>
      <div class="stat-rotulo">acertos</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor ${revisaoErros > 0 ? 'alerta' : ''}">${revisaoErros}</div>
      <div class="stat-rotulo">erros</div>
    </div>
  `;
}

function renderRevisaoAtual() {
  renderResumoRevisao();
  const container = document.getElementById('revisao-atual');

  if (revisaoIndice >= revisaoFila.length) {
    container.innerHTML =
      revisaoFila.length === 0
        ? '<p>Nenhuma pergunta devida para revisão agora. 🎉</p>'
        : '<p>Revisão concluída por agora. 🎉</p>';
    return;
  }

  const pergunta = revisaoFila[revisaoIndice];

  container.innerHTML = `
    ${
      pergunta.madura
        ? `<div class="card" style="padding:14px 18px">
             <span class="reformulado-aviso">Esta pergunta está dominada — que tal tentar reformulada?</span>
             <div style="display:flex; gap:8px; align-items:center; margin-top:8px">
               <select id="revisao-reformular-modelo">
                 <option>ChatGPT</option><option>Claude</option><option>Grok</option>
               </select>
               <button type="button" class="btn btn-secondary btn-sm" id="revisao-reformular-btn">Reformular com IA</button>
             </div>
           </div>`
        : ''
    }
    <div id="revisao-pergunta-container"></div>
  `;

  renderPerguntaRevisao(pergunta);

  if (pergunta.madura) {
    document
      .getElementById('revisao-reformular-btn')
      .addEventListener('click', reformularAtual);
  }
}

function renderPerguntaRevisao(pergunta) {
  const container = document.getElementById('revisao-pergunta-container');
  container.innerHTML =
    renderPerguntaQuizHTML(pergunta, 'revisao-atual') +
    '<button type="button" class="btn btn-primary" id="revisao-proxima-btn" style="display:none">Próxima pergunta</button>';

  wirePerguntaQuiz(pergunta, 'revisao-atual', async (correta) => {
    if (correta) revisaoAcertos += 1;
    else revisaoErros += 1;
    renderResumoRevisao();
    document.getElementById('revisao-proxima-btn').style.display = 'inline-flex';

    try {
      await api('POST', `/api/perguntas/${pergunta.id}/responder`, { correta });
    } catch (erro) {
      toast(erro.message, 'error');
    }
  });

  document.getElementById('revisao-proxima-btn').addEventListener('click', () => {
    revisaoIndice += 1;
    renderRevisaoAtual();
  });
}

async function reformularAtual() {
  const pergunta = revisaoFila[revisaoIndice];
  const modelo = document.getElementById('revisao-reformular-modelo').value;
  const btn = document.getElementById('revisao-reformular-btn');

  btn.disabled = true;
  btn.textContent = `Consultando ${modelo}...`;

  try {
    const reformulada = await api('POST', `/api/revisao/${pergunta.id}/reformular`, { modelo });
    renderPerguntaRevisao({
      id: reformulada.pergunta_id,
      enunciado: reformulada.enunciado,
      opcoes: reformulada.opcoes,
    });
    toast('Pergunta reformulada pela IA.');
  } catch (erro) {
    toast(erro.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reformular com IA';
  }
}
