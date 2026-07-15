let revisaoFila = [];
let revisaoIndice = 0;
let revisaoAcertos = 0;
let revisaoErros = 0;
let filtroRevisao = 'tudo'; // 'tudo' | 'pergunta' | 'flashcard'
let revisaoReaprendendoIds = new Set();

function chaveSessaoRevisao() {
  const hoje = new Date().toISOString().slice(0, 10);
  return `revisaoSessao:${Estado.materiaId || 'sem-materia'}:${hoje}`;
}

function carregarSessaoRevisao() {
  revisaoAcertos = 0;
  revisaoErros = 0;
  revisaoReaprendendoIds = new Set();

  if (!Estado.materiaId) return;

  try {
    const salvo = JSON.parse(localStorage.getItem(chaveSessaoRevisao()) || '{}');
    revisaoAcertos = Number(salvo.acertos || 0);
    revisaoErros = Number(salvo.erros || 0);
    revisaoReaprendendoIds = new Set((salvo.reaprendendoIds || []).map(Number).filter(Boolean));
  } catch (_) {
    localStorage.removeItem(chaveSessaoRevisao());
  }
}

function salvarSessaoRevisao() {
  if (!Estado.materiaId) return;
  localStorage.setItem(chaveSessaoRevisao(), JSON.stringify({
    acertos: revisaoAcertos,
    erros: revisaoErros,
    reaprendendoIds: [...revisaoReaprendendoIds],
  }));
}

function limparSessaoRevisaoSeConcluida() {
  if (revisaoFila.length > 0 && revisaoIndice < revisaoFila.length) return;
  revisaoReaprendendoIds.clear();
  salvarSessaoRevisao();
}

// Reaprendizagem estilo Anki: um item respondido errado volta para o fim
// da fila da MESMA sessão (como o passo de 10min do Anki, com "learn
// ahead" quando a fila é curta) e se repete até ser acertado. No banco o
// SM-2 já reagendou para +10min a cada erro; o acerto seguinte gradua o
// item para 1 dia.
function reenfileirarErrado(pergunta) {
  revisaoReaprendendoIds.add(Number(pergunta.id));
  revisaoFila.push({ ...pergunta, novo: false, reaprendendo: true });
}

document.querySelectorAll('#tipo-toggle-revisao button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tipo-toggle-revisao button').forEach((b) => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    filtroRevisao = btn.dataset.filtro;
    localStorage.setItem('filtroRevisao', filtroRevisao);
    carregarRevisao();
  });
});

(function restaurarFiltroRevisao() {
  const salvo = localStorage.getItem('filtroRevisao');
  if (!['tudo', 'pergunta', 'flashcard'].includes(salvo)) return;
  filtroRevisao = salvo;
  document.querySelectorAll('#tipo-toggle-revisao button').forEach((b) =>
    b.classList.toggle('ativo', b.dataset.filtro === filtroRevisao)
  );
})();

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

  // Estilo Anki: itens nunca respondidos são "a aprender" (novos) e vêm
  // primeiro; os já respondidos e vencidos são "a revisar". Ambos passam
  // pelo mesmo SM-2 ao serem respondidos.
  carregarSessaoRevisao();
  const agora = new Date();
  const porId = new Map(perguntas.map((p) => [Number(p.id), p]));
  const idsNaFila = new Set();
  revisaoFila = perguntas
    .filter((p) => filtroRevisao === 'tudo' || p.tipo === filtroRevisao)
    .filter((p) => p.proxima_revisao_em === null || new Date(p.proxima_revisao_em) <= agora)
    .map((p) => {
      idsNaFila.add(Number(p.id));
      return { ...p, novo: p.vezes_respondida === 0 };
    })
    .sort((a, b) => {
      if (a.novo !== b.novo) return a.novo ? -1 : 1;
      if (a.proxima_revisao_em === null) return -1;
      if (b.proxima_revisao_em === null) return 1;
      return new Date(a.proxima_revisao_em) - new Date(b.proxima_revisao_em);
    });

  revisaoReaprendendoIds.forEach((id) => {
    if (idsNaFila.has(id)) return;
    const pergunta = porId.get(id);
    if (!pergunta) {
      revisaoReaprendendoIds.delete(id);
      return;
    }
    if (filtroRevisao !== 'tudo' && pergunta.tipo !== filtroRevisao) return;
    revisaoFila.push({ ...pergunta, novo: false, reaprendendo: true });
  });

  revisaoIndice = 0;
  salvarSessaoRevisao();
  renderRevisaoAtual();
}

function renderResumoRevisao() {
  const restantes = revisaoFila.slice(revisaoIndice);
  const aAprender = restantes.filter((p) => p.novo).length;
  const aRevisar = restantes.length - aAprender;

  document.getElementById('revisao-resumo').innerHTML = `
    <div class="stat-card">
      <div class="stat-valor brand">${aAprender}</div>
      <div class="stat-rotulo">a aprender</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor ${aRevisar > 0 ? 'alerta' : ''}">${aRevisar}</div>
      <div class="stat-rotulo">a revisar</div>
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

  const ICONE_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.1V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

  if (revisaoIndice >= revisaoFila.length) {
    limparSessaoRevisaoSeConcluida();
    container.innerHTML =
      revisaoFila.length === 0
        ? `<p class="fim-sessao">${ICONE_OK} Nada para aprender ou revisar agora.</p>`
        : `<p class="fim-sessao">${ICONE_OK} Sessão de aprendizado concluída.</p>`;
    return;
  }

  const pergunta = revisaoFila[revisaoIndice];
  const podeReformular = pergunta.madura && pergunta.tipo !== 'flashcard';

  const ICONE_REVISAO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  const ICONE_REAPRENDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>';
  const ICONE_NOVO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';

  let badgeEstado = `<span class="badge badge-amber">${ICONE_REVISAO} revisão</span>`;
  if (pergunta.reaprendendo) badgeEstado = `<span class="badge badge-red">${ICONE_REAPRENDER} reaprendendo</span>`;
  else if (pergunta.novo) badgeEstado = `<span class="badge badge-blue">${ICONE_NOVO} a aprender</span>`;

  container.innerHTML = `
    <div style="margin-bottom:10px">${badgeEstado}</div>
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
      <span class="fc-rotulo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7.5 7V6a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-1"/></svg>
        Flashcard
      </span>
      <div class="question-title">${formatarTexto(card.enunciado, { compacto: true })}</div>
      <div class="fc-verso" id="fc-verso-revisao" style="display:none">${formatarTexto(card.verso || '', { compacto: true })}</div>
      <div class="fc-acoes">
        <button type="button" class="btn btn-primary" id="fc-mostrar-btn">Mostrar resposta</button>
      </div>
      <div class="fc-acoes" id="fc-avaliacao" style="display:none">
        <button type="button" class="btn btn-danger" id="fc-errei-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
          Errei
        </button>
        <button type="button" class="btn btn-primary" id="fc-acertei-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"/></svg>
          Acertei
        </button>
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
    if (correta) {
      revisaoAcertos += 1;
      revisaoReaprendendoIds.delete(Number(card.id));
    } else {
      revisaoErros += 1;
      reenfileirarErrado(card);
    }
    salvarSessaoRevisao();
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
    if (correta) {
      revisaoAcertos += 1;
      revisaoReaprendendoIds.delete(Number(pergunta.id));
    } else {
      revisaoErros += 1;
      reenfileirarErrado(pergunta);
    }
    salvarSessaoRevisao();
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
