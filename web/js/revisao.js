let revisaoFila = [];
let revisaoIndice = 0;
let revisaoAcertos = 0;
let revisaoErros = 0;

// Cache por dia da versão reformulada (mesma semântica do backend antigo):
// evita gastar quota re-reformulando a mesma pergunta em reloads.
const cacheReformulacao = {};

async function carregarRevisao() {
  const resumo = document.getElementById('revisao-resumo');
  const atual = document.getElementById('revisao-atual');

  if (!Estado.materiaId) {
    resumo.innerHTML = '';
    atual.innerHTML = '<p>Crie ou selecione uma matéria primeiro.</p>';
    return;
  }

  atual.innerHTML = '<p>Carregando...</p>';

  let perguntas;
  try {
    perguntas = await buscarPerguntasDaMateria(Estado.materiaId);
  } catch (erro) {
    toast(erro.message, 'error');
    return;
  }

  const agora = new Date();
  revisaoFila = perguntas
    .filter((p) => p.proxima_revisao_em === null || new Date(p.proxima_revisao_em) <= agora)
    .sort((a, b) => {
      if (a.proxima_revisao_em === null) return -1;
      if (b.proxima_revisao_em === null) return 1;
      return new Date(a.proxima_revisao_em) - new Date(b.proxima_revisao_em);
    });

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
  const podeReformular = pergunta.madura && pergunta.tipo !== 'flashcard';

  container.innerHTML = `
    ${
      podeReformular
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

  if (pergunta.tipo === 'flashcard') {
    renderFlashcardRevisao(pergunta);
  } else {
    renderPerguntaRevisao(pergunta);
  }

  if (podeReformular) {
    document
      .getElementById('revisao-reformular-btn')
      .addEventListener('click', reformularAtual);
  }
}

// Fluxo Anki: mostra a frente, revela o verso sob demanda e o próprio
// usuário se avalia (Errei/Acertei) — o resultado alimenta o mesmo SM-2.
function renderFlashcardRevisao(card) {
  const container = document.getElementById('revisao-pergunta-container');

  container.innerHTML = `
    <div class="question-card">
      <span class="fc-rotulo">🃏 Flashcard</span>
      <div class="question-title">${esc(card.enunciado)}</div>
      <div class="fc-verso" id="fc-verso-revisao" style="display:none">${esc(card.verso || '')}</div>
      <div class="fc-acoes">
        <button type="button" class="btn btn-primary" id="fc-mostrar-btn">Mostrar resposta</button>
      </div>
      <div class="fc-acoes" id="fc-avaliacao" style="display:none">
        <button type="button" class="btn btn-danger" id="fc-errei-btn">✘ Errei</button>
        <button type="button" class="btn btn-primary" id="fc-acertei-btn">✔ Acertei</button>
      </div>
    </div>
    <button type="button" class="btn btn-primary" id="revisao-proxima-btn" style="display:none">Próxima pergunta</button>
  `;

  document.getElementById('fc-mostrar-btn').addEventListener('click', () => {
    document.getElementById('fc-verso-revisao').style.display = 'block';
    document.getElementById('fc-mostrar-btn').style.display = 'none';
    document.getElementById('fc-avaliacao').style.display = 'flex';
  });

  async function avaliar(correta) {
    document.getElementById('fc-avaliacao').style.display = 'none';
    if (correta) revisaoAcertos += 1;
    else revisaoErros += 1;
    renderResumoRevisao();
    document.getElementById('revisao-proxima-btn').style.display = 'inline-flex';

    const { error } = await sb.rpc('registrar_resposta', {
      p_pergunta_id: card.id,
      p_correta: correta,
    });
    if (error) toast(error.message, 'error');
  }

  document.getElementById('fc-errei-btn').addEventListener('click', () => avaliar(false));
  document.getElementById('fc-acertei-btn').addEventListener('click', () => avaliar(true));

  document.getElementById('revisao-proxima-btn').addEventListener('click', () => {
    revisaoIndice += 1;
    renderRevisaoAtual();
  });
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

    const { error } = await sb.rpc('registrar_resposta', {
      p_pergunta_id: pergunta.id,
      p_correta: correta,
    });
    if (error) toast(error.message, 'error');
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
  const chaveCache = `${pergunta.id}-${new Date().toISOString().slice(0, 10)}`;

  let reformulada = cacheReformulacao[chaveCache];

  if (!reformulada) {
    btn.disabled = true;
    btn.textContent = `Consultando ${modelo}...`;

    const { data, error } = await sb.functions.invoke('reformular', {
      body: {
        modelo,
        pergunta: {
          enunciado: pergunta.enunciado,
          dificuldade: pergunta.dificuldade,
          opcoes: pergunta.opcoes.map((o) => ({ texto: o.texto, correta: o.correta })),
          topico: null,
        },
      },
    });

    btn.disabled = false;
    btn.textContent = 'Reformular com IA';

    if (error) {
      toast(await mensagemErroFuncao(error), 'error');
      return;
    }

    reformulada = data;
    cacheReformulacao[chaveCache] = reformulada;
  }

  renderPerguntaRevisao({
    id: pergunta.id,
    enunciado: reformulada.enunciado,
    opcoes: reformulada.opcoes,
  });
  toast('Pergunta reformulada pela IA.');
}
