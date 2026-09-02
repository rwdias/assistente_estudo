let revisaoFila = [];
let revisaoIndice = 0;
let revisaoAcertos = 0;
let revisaoErros = 0;
let filtroRevisao = 'tudo'; // 'tudo' | 'pergunta' | 'flashcard' | 'foco'
let revisaoReaprendendoIds = new Set();

// ===========================================================================
// Modo FOCO — sessão curta e priorizada.
// Problema que resolve: com centenas de itens vencidos, a fila inteira paralisa
// ("muita coisa para estudar"). O Foco mistura perguntas E flashcards, ordena
// por PRIORIDADE e corta nos N primeiros, dando uma sessão finita e útil.
// ===========================================================================

// Tamanho da sessão focada. Trocar aqui muda quantos itens entram.
const FOCO_LIMITE = 100;

// Tópicos considerados "fracos" nesta matéria (para a explicação e o badge).
// null fora do modo Foco.
let focoTopicosFracos = null;

// Taxa de erro SUAVIZADA (Laplace): (erradas + 1) / (respondidas + 2).
// A suavização é o ponto importante: sem ela, um item/tópico com 1 resposta e
// 1 erro (100%) passaria na frente de um com 50 respostas e 20 erros (40%).
// Pouca evidência é puxada para o meio (0,5) até haver histórico suficiente.
function taxaErroSuavizada(respondidas, erradas) {
  return (erradas + 1) / (respondidas + 2);
}

// Agrega acertos/erros POR TÓPICO na matéria inteira — inclusive itens que não
// estão vencidos hoje. É o sinal central do Foco: "priorize o que eu mais erro".
// Devolve Map<topico, { respondidas, erradas, taxa }>.
function estatisticasPorTopico(perguntas) {
  const stats = new Map();
  for (const p of perguntas) {
    if (p.tipo === 'exercicio' || p.oculta) continue;
    const topico = p.topico || 'Geral';
    const atual = stats.get(topico) || { respondidas: 0, erradas: 0 };
    atual.respondidas += p.vezes_respondida;
    atual.erradas += p.vezes_respondida - p.vezes_acertada;
    stats.set(topico, atual);
  }
  for (const s of stats.values()) s.taxa = taxaErroSuavizada(s.respondidas, s.erradas);
  return stats;
}

// Os tópicos em que mais se erra, com histórico suficiente para o número
// significar algo (>= 3 respostas e ao menos 1 erro). Usado para explicar a
// seleção ao usuário e marcar os itens.
function topicosFracos(stats, quantos = 3) {
  return [...stats.entries()]
    .filter(([, s]) => s.respondidas >= 3 && s.erradas > 0)
    .sort((a, b) => b[1].taxa - a[1].taxa)
    .slice(0, quantos)
    .map(([topico, s]) => ({
      topico,
      // taxa BRUTA para exibir (a suavizada é só para ordenar)
      percentual: Math.round((s.erradas / s.respondidas) * 100),
    }));
}

// Pontuação de prioridade de um item. Pesos, do mais para o menos importante:
//   3× tópico que se erra mais  (o critério pedido)
//   2× erro do próprio item
//   1× há quanto tempo venceu   (satura em 30 dias de atraso)
//   +2 se está "reaprendendo"   (errou nesta sessão → volta logo)
// Item novo cai naturalmente no meio da fila: sem histórico, a suavização dá
// 0,5 nas duas taxas — ele entra, mas atrás do que já se mostrou problemático.
function pontuarPrioridade(p, statsTopico, agora) {
  const DIA = 24 * 60 * 60 * 1000;
  const stTopico = statsTopico.get(p.topico || 'Geral');
  const erroTopico = stTopico ? stTopico.taxa : 0.5;
  const erroItem = taxaErroSuavizada(p.vezes_respondida, p.vezes_respondida - p.vezes_acertada);

  const atraso = p.proxima_revisao_em === null
    ? 0.4 // nunca respondido: nunca "venceu" — entra, mas atrás do que venceu
    : Math.min((agora - new Date(p.proxima_revisao_em)) / DIA / 30, 1);

  return (
    3 * erroTopico +
    2 * erroItem +
    1 * atraso +
    (revisaoReaprendendoIds.has(Number(p.id)) ? 2 : 0)
  );
}

// Pilha de desfazer da avaliação de flashcards (Acertei/Errei). Cada item
// avaliado empilha um "frame" com o estado anterior (índice, contadores,
// fila e a linha de revisoes_perguntas antes do SM-2 rodar), permitindo
// voltar e reavaliar caso o usuário tenha clicado errado. Ver voltarFlashcard().
let revisaoHistorico = [];

// Atalhos de teclado do fluxo de flashcard no Aprendizado (espelho do Anki):
//   Enter     -> "Mostrar resposta" (se oculta) ou "Bom".
//   1 2 3 4   -> De novo / Difícil / Bom / Fácil (só com a avaliação visível).
//   Backspace -> volta para o item anterior (desfaz a última avaliação).
// Aciona os próprios botões (.click()), então funciona a cada re-render sem
// precisar recriar o listener. Não interfere em perguntas (os botões de
// flashcard não existem) nem quando se digita num campo.
(function atalhosFlashcard() {
  const visivel = (el) => el && el.offsetParent !== null;
  const TECLA_QUALIDADE = { 1: 2, 2: 3, 3: 4, 4: 5 };

  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== 'Enter' && e.key !== 'Backspace' && !TECLA_QUALIDADE[e.key]) return;

    const painel = document.getElementById('panel-revisao');
    if (!painel || !painel.classList.contains('active')) return;

    // Se um botão está focado, o próprio navegador o aciona no Enter — não
    // duplicar. Também não sequestrar teclas enquanto se digita.
    const alvo = e.target;
    if (alvo && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(alvo.tagName)) return;

    const mostrar = document.getElementById('fc-mostrar-btn');
    const avaliacao = document.getElementById('fc-avaliacao');
    const voltar = document.getElementById('fc-voltar-btn');
    const botaoDe = (q) => avaliacao?.querySelector(`[data-qualidade="${q}"]`);

    if (e.key === 'Enter') {
      if (visivel(mostrar)) { e.preventDefault(); mostrar.click(); }
      else if (visivel(avaliacao)) { e.preventDefault(); botaoDe(QUALIDADE.BOM)?.click(); }
    } else if (e.key === 'Backspace') {
      if (visivel(voltar)) { e.preventDefault(); voltar.click(); }
    } else if (visivel(avaliacao)) {
      e.preventDefault();
      botaoDe(TECLA_QUALIDADE[e.key])?.click();
    }
  });
})();

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

// Remove um item da sessão em andamento (usado ao ocultar/excluir durante o
// estudo): tira todas as ocorrências dele da posição atual em diante e
// re-renderiza — o próximo item assume o lugar, sem mexer no histórico.
function descartarItemDaSessao(id) {
  const idn = Number(id);
  revisaoReaprendendoIds.delete(idn);
  revisaoFila = revisaoFila.filter((p, i) => i < revisaoIndice || Number(p.id) !== idn);
  salvarSessaoRevisao();
  renderRevisaoAtual();
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
  if (!['tudo', 'pergunta', 'flashcard', 'foco'].includes(salvo)) return;
  filtroRevisao = salvo;
  document.querySelectorAll('#tipo-toggle-revisao button').forEach((b) =>
    b.classList.toggle('ativo', b.dataset.filtro === filtroRevisao)
  );
})();

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
  // Candidatos: itens estudáveis e vencidos. O modo "foco" aceita os dois tipos
  // (pergunta E flashcard) — o corte dele é por prioridade, não por tipo.
  const candidatos = perguntas
    // Exercícios de lista têm SM-2, mas são estudados no modo "resolver a lista"
    // (têm UI própria de resposta+conferência) — não entram na fila comum ainda.
    .filter((p) => p.tipo !== 'exercicio')
    .filter((p) => !p.oculta) // itens ocultos não entram na revisão
    .filter((p) => filtroRevisao === 'tudo' || filtroRevisao === 'foco' || p.tipo === filtroRevisao)
    .filter((p) => p.proxima_revisao_em === null || new Date(p.proxima_revisao_em) <= agora)
    // aplicarVariante escolhe qual versão (original ou reformulada) entra nesta
    // rodada; fica fixada no item da fila, então o "Voltar" restaura a mesma.
    .map((p) => ({ ...aplicarVariante(p), novo: p.vezes_respondida === 0 }));

  if (filtroRevisao === 'foco') {
    // Sessão priorizada e FINITA: ordena por prioridade e corta em FOCO_LIMITE.
    // As estatísticas de tópico usam a matéria inteira (não só os vencidos),
    // senão um tópico problemático some da conta justo quando está em dia.
    const statsTopico = estatisticasPorTopico(perguntas);
    focoTopicosFracos = topicosFracos(statsTopico);
    revisaoFila = candidatos
      .map((p) => ({ ...p, prioridade: pontuarPrioridade(p, statsTopico, agora) }))
      .sort((a, b) => b.prioridade - a.prioridade)
      .slice(0, FOCO_LIMITE);
  } else {
    focoTopicosFracos = null;
    revisaoFila = candidatos.sort((a, b) => {
      if (a.novo !== b.novo) return a.novo ? -1 : 1;
      if (a.proxima_revisao_em === null) return -1;
      if (b.proxima_revisao_em === null) return 1;
      return new Date(a.proxima_revisao_em) - new Date(b.proxima_revisao_em);
    });
  }

  // idsNaFila é preenchido a partir da fila FINAL (no foco, o que sobrou do
  // corte), para o bloco de reaprendendo abaixo não duplicar item já presente.
  revisaoFila.forEach((p) => idsNaFila.add(Number(p.id)));

  revisaoReaprendendoIds.forEach((id) => {
    if (idsNaFila.has(id)) return;
    const pergunta = porId.get(id);
    if (!pergunta || pergunta.oculta) {
      revisaoReaprendendoIds.delete(id);
      return;
    }
    if (filtroRevisao !== 'tudo' && pergunta.tipo !== filtroRevisao) return;
    revisaoFila.push({ ...aplicarVariante(pergunta), novo: false, reaprendendo: true });
  });

  revisaoIndice = 0;
  revisaoHistorico = [];
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

  renderFocoInfo();
}

// No modo Foco, explica ao usuário POR QUE estes itens foram escolhidos — sem
// isso a seleção parece arbitrária. Fora do Foco, a faixa some.
function renderFocoInfo() {
  const alvo = document.getElementById('revisao-foco-info');
  if (!alvo) return;

  if (filtroRevisao !== 'foco') {
    alvo.style.display = 'none';
    alvo.innerHTML = '';
    return;
  }

  const fracos = focoTopicosFracos || [];
  const detalhe = fracos.length
    ? `Priorizando o que você mais erra: ${fracos
        .map((f) => `<b>${esc(f.topico)}</b> (${f.percentual}% de erro)`)
        .join(' · ')}.`
    : 'Ainda sem histórico suficiente de erros — priorizando o que está vencido há mais tempo.';

  alvo.style.display = 'flex';
  alvo.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>
    <span>Sessão focada: até ${FOCO_LIMITE} itens (perguntas e flashcards). ${detalhe}</span>
  `;
}

function renderRevisaoAtual() {
  renderResumoRevisao();
  const container = document.getElementById('revisao-atual');

  const ICONE_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.1V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  const ICONE_VOLTAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5v0A5.5 5.5 0 0 1 14.5 20H11"/></svg>';
  const podeVoltar = revisaoHistorico.length > 0;
  const botaoVoltarHTML = podeVoltar
    ? `<button type="button" class="btn btn-secondary btn-sm" id="fc-voltar-btn">${ICONE_VOLTAR} Voltar</button>`
    : '';

  if (revisaoIndice >= revisaoFila.length) {
    limparSessaoRevisaoSeConcluida();
    container.innerHTML =
      (revisaoFila.length === 0
        ? `<p class="fim-sessao">${ICONE_OK} Nada para aprender ou revisar agora.</p>`
        : `<p class="fim-sessao">${ICONE_OK} Sessão de aprendizado concluída.</p>`) +
      (podeVoltar ? `<div style="margin-top:10px">${botaoVoltarHTML}</div>` : '');
    if (podeVoltar) document.getElementById('fc-voltar-btn').addEventListener('click', voltarFlashcard);
    return;
  }

  const pergunta = revisaoFila[revisaoIndice];
  // Dominada e ainda sem versões alternativas: oferece gerar (badge + botão).
  const podeVariar = pergunta.pode_variar;
  // Já está sendo exibida uma versão reformulada nesta rodada.
  const ehVariante = Boolean(pergunta.variante_id);

  const ICONE_REVISAO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  const ICONE_REAPRENDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>';
  const ICONE_NOVO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  const ICONE_VARIANTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M20 9a8 8 0 0 0-14-3L4 8"/><path d="M4 15a8 8 0 0 0 14 3l2-2"/></svg>';

  let badgeEstado = `<span class="badge badge-amber">${ICONE_REVISAO} revisão</span>`;
  if (pergunta.reaprendendo) badgeEstado = `<span class="badge badge-red">${ICONE_REAPRENDER} reaprendendo</span>`;
  else if (pergunta.novo) badgeEstado = `<span class="badge badge-blue">${ICONE_NOVO} a aprender</span>`;

  if (ehVariante) {
    badgeEstado += `<span class="badge badge-green">${ICONE_VARIANTE} versão reformulada</span>`;
  }

  // No modo Foco, marca o item cujo tópico está entre os que o usuário mais
  // erra — é justamente a razão de ele ter subido na fila.
  const ICONE_ALVO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>';
  if (
    filtroRevisao === 'foco' &&
    (focoTopicosFracos || []).some((f) => f.topico === (pergunta.topico || 'Geral'))
  ) {
    badgeEstado += `<span class="badge badge-neutro">${ICONE_ALVO} tópico difícil</span>`;
  }

  container.innerHTML = `
    <div style="margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; gap:8px">
      <span style="display:flex; gap:6px; flex-wrap:wrap">${badgeEstado}</span>
      <span style="display:flex; align-items:center; gap:8px">
        ${botaoVoltarHTML}
        ${renderMenuItemHTML([
          { acao: 'editar', rotulo: 'Editar', icone: ICONE_EDITAR },
          { acao: 'ocultar', rotulo: 'Ocultar da revisão', icone: ICONE_OCULTAR },
          { acao: 'excluir', rotulo: 'Excluir', icone: ICONE_LIXEIRA, perigo: true },
        ])}
      </span>
    </div>
    ${
      podeVariar
        ? `<div class="card" style="padding:14px 18px">
             <span class="reformulado-aviso">Você já domina esta pergunta — gerar versões diferentes evita decorar o formato.</span>
             <div style="display:flex; gap:8px; align-items:center; margin-top:8px">
               <select id="revisao-variar-modelo">
                 <option>ChatGPT</option><option>Claude</option><option>Grok</option>
               </select>
               <button type="button" class="btn btn-secondary btn-sm" id="revisao-variar-btn">Gerar versões</button>
             </div>
           </div>`
        : ''
    }
    <div id="revisao-pergunta-container"></div>
    ${
      ehVariante
        ? `<button type="button" class="btn btn-secondary btn-sm" id="revisao-descartar-variante-btn"
                   style="margin-top:10px">Descartar esta versão</button>`
        : ''
    }
  `;

  if (pergunta.tipo === 'flashcard') {
    renderFlashcardRevisao(pergunta);
  } else {
    renderPerguntaRevisao(pergunta);
  }

  if (podeVariar) {
    document.getElementById('revisao-variar-btn').addEventListener('click', gerarVariantesAtual);
  }

  if (ehVariante) {
    document
      .getElementById('revisao-descartar-variante-btn')
      .addEventListener('click', () => descartarVariante(pergunta));
  }

  if (podeVoltar) {
    document.getElementById('fc-voltar-btn').addEventListener('click', voltarFlashcard);
  }

  wireMenuItem(container, async (acao) => {
    if (acao === 'editar') {
      // Se está exibindo uma variante, o que se edita é a pergunta ORIGINAL —
      // a variante é conteúdo derivado (e será descartada se o texto mudar).
      const base = pergunta.original
        ? { ...pergunta, enunciado: pergunta.original.enunciado, opcoes: pergunta.original.opcoes }
        : pergunta;
      abrirEdicaoItem(base, recarregarItemAtual);
    } else if (acao === 'ocultar') {
      // Oculta e tira o item da sessão atual (segue para o próximo).
      if (await ocultarPergunta(pergunta.id, true)) {
        toast('Ocultada da revisão.');
        descartarItemDaSessao(pergunta.id);
      }
    } else if (acao === 'excluir') {
      pedirExclusaoPergunta(pergunta.id, () => descartarItemDaSessao(pergunta.id));
    }
  });
}

// Recarrega só o item atual depois de editar, preservando o lugar na sessão.
async function recarregarItemAtual() {
  const atual = revisaoFila[revisaoIndice];
  if (!atual) return;

  try {
    const nova = await buscarPerguntaPorId(atual.id);
    if (nova) {
      revisaoFila[revisaoIndice] = {
        ...aplicarVariante(nova),
        novo: atual.novo,
        reaprendendo: atual.reaprendendo,
      };
    }
  } catch (erro) {
    toast(erro.message, 'error');
  }

  renderRevisaoAtual();
}

// Campos da linha de revisoes_perguntas que o SM-2 (registrar_resposta)
// altera a cada resposta — usados para tirar um "antes" e permitir desfazer.
const CAMPOS_REVISAO_SM2 =
  'vezes_respondida, vezes_acertada, vezes_errada, ultima_resposta_correta, ' +
  'ultima_respondida_em, fator_facilidade, intervalo_dias, proxima_revisao_em, ' +
  'acertos_seguidos, updated_at';

// Desfaz a última avaliação de flashcard (Acertei/Errei): volta o estado
// local (índice, contadores, fila, "reaprendendo") para antes da avaliação
// e restaura a linha do SM-2 no banco para o snapshot tirado antes de
// `registrar_resposta` rodar. Espera essa chamada original terminar antes de
// restaurar, para não haver corrida entre as duas escritas.
async function voltarFlashcard() {
  const frame = revisaoHistorico.pop();
  if (!frame) return;

  revisaoIndice = frame.indiceAnterior;
  revisaoAcertos = frame.acertosAntes;
  revisaoErros = frame.errosAntes;
  revisaoReaprendendoIds = frame.reaprendendoIdsAntes;
  revisaoFila = frame.filaAntes;
  salvarSessaoRevisao();
  renderRevisaoAtual();

  await frame.concluido;
  if (!frame.snapshotRevisao) return;

  const { error } = await sb
    .from('revisoes_perguntas')
    .update(frame.snapshotRevisao)
    .eq('pergunta_id', frame.perguntaId);
  if (error) toast(error.message, 'error');
}

// Fluxo Anki: mostra a frente, revela o verso sob demanda e o próprio usuário
// se avalia em 4 níveis. O tempo em cima de cada botão é a previsão de quando
// o cartão volta (preverIntervalos espelha a SM-2 do banco).
function renderFlashcardRevisao(card) {
  const container = document.getElementById('revisao-pergunta-container');
  const previsao = preverIntervalos(card.intervalo_dias, card.fator_facilidade);
  // Em matéria matemática, frente/verso renderizam LaTeX; em normal, mat=false
  // deixa o comportamento idêntico ao de sempre.
  const mat = materiaEhMatematica();

  const botao = (qualidade, rotulo, classe, atalho) => `
    <div class="fc-opcao">
      <span class="fc-prazo">${esc(formatarIntervalo(previsao[qualidade]))}</span>
      <button type="button" class="btn ${classe}" data-qualidade="${qualidade}">
        ${esc(rotulo)}<span class="fc-atalho">${atalho}</span>
      </button>
    </div>
  `;

  container.innerHTML = `
    <div class="question-card">
      <span class="fc-rotulo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7.5 7V6a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-1"/></svg>
        Flashcard
      </span>
      <div class="question-title">${formatarTexto(card.enunciado, { compacto: true, math: mat })}</div>
      <div class="fc-verso" id="fc-verso-revisao" style="display:none">${formatarTexto(card.verso || '', { compacto: true, math: mat })}</div>
      <div class="fc-acoes">
        <button type="button" class="btn btn-primary" id="fc-mostrar-btn">Mostrar resposta</button>
      </div>
      <div class="fc-avaliacao" id="fc-avaliacao" style="display:none">
        ${botao(QUALIDADE.DE_NOVO, 'De novo', 'btn-danger', '1')}
        ${botao(QUALIDADE.DIFICIL, 'Difícil', 'btn-secondary', '2')}
        ${botao(QUALIDADE.BOM, 'Bom', 'btn-primary', '3')}
        ${botao(QUALIDADE.FACIL, 'Fácil', 'btn-secondary', '4')}
      </div>
      <div class="saber-mais" data-saber-mais hidden></div>
    </div>
  `;

  const cardEl = container.querySelector('.question-card');

  document.getElementById('fc-mostrar-btn').addEventListener('click', () => {
    document.getElementById('fc-verso-revisao').style.display = 'block';
    document.getElementById('fc-mostrar-btn').style.display = 'none';
    document.getElementById('fc-avaliacao').style.display = 'flex';
    // "Saber mais" aparece junto com o verso (cache + botão de aprofundar)
    montarSaberMais(cardEl, card);
  });

  // "De novo" (2) conta como erro e devolve o cartão à fila da sessão;
  // Difícil/Bom/Fácil (3/4/5) contam como acerto. Mesma regra do banco.
  function avaliar(qualidade) {
    const correta = qualidade >= QUALIDADE.DIFICIL;
    document.getElementById('fc-avaliacao').style.display = 'none';

    const frame = {
      perguntaId: Number(card.id),
      indiceAnterior: revisaoIndice,
      acertosAntes: revisaoAcertos,
      errosAntes: revisaoErros,
      reaprendendoIdsAntes: new Set(revisaoReaprendendoIds),
      filaAntes: revisaoFila.slice(),
      snapshotRevisao: null,
    };
    revisaoHistorico.push(frame);

    if (correta) {
      revisaoAcertos += 1;
      revisaoReaprendendoIds.delete(Number(card.id));
    } else {
      revisaoErros += 1;
      reenfileirarErrado(card);
    }
    salvarSessaoRevisao();

    // Tira um "antes" da linha do SM-2 (p/ permitir desfazer com o botão
    // Voltar/Backspace) e só então registra a resposta — tudo em segundo
    // plano, não bloqueia o avanço. voltarFlashcard() espera essa promessa
    // terminar antes de restaurar, evitando corrida entre as duas escritas.
    frame.concluido = sb
      .from('revisoes_perguntas')
      .select(CAMPOS_REVISAO_SM2)
      .eq('pergunta_id', card.id)
      .maybeSingle()
      .then(({ data }) => {
        frame.snapshotRevisao = data || null;
        return sb.rpc('registrar_resposta', {
          p_pergunta_id: card.id,
          p_correta: correta,
          p_qualidade: qualidade,
        });
      })
      .then(({ error }) => { if (error) toast(error.message, 'error'); });

    // Avaliar já avança direto para o próximo item.
    revisaoIndice += 1;
    renderRevisaoAtual();
  }

  container.querySelectorAll('#fc-avaliacao [data-qualidade]').forEach((btn) => {
    btn.addEventListener('click', () => avaliar(Number(btn.dataset.qualidade)));
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

// Uma única chamada de IA devolve várias versões, que ficam GRAVADAS em
// pergunta_variantes e passam a se revezar com o original sem custo nenhum.
// (O fluxo antigo reformulava 1 vez, só na memória, e sumia no reload.)
const VARIANTES_POR_CHAMADA = 3;

async function gerarVariantesAtual() {
  const pergunta = revisaoFila[revisaoIndice];
  const modelo = document.getElementById('revisao-variar-modelo').value;
  const btn = document.getElementById('revisao-variar-btn');

  btn.disabled = true;
  btn.textContent = `Consultando ${modelo}...`;

  const { data, error } = await sb.functions.invoke('reformular', {
    body: {
      modelo,
      quantidade: VARIANTES_POR_CHAMADA,
      pergunta: {
        enunciado: pergunta.enunciado,
        dificuldade: pergunta.dificuldade,
        opcoes: pergunta.opcoes.map((o) => ({ texto: o.texto, correta: o.correta })),
        topico: pergunta.topico ?? null,
      },
    },
  });

  btn.disabled = false;
  btn.textContent = 'Gerar versões';

  if (error) {
    toast(await mensagemErroFuncao(error), 'error');
    return;
  }

  const variantes = (data?.variantes || []).map((v) => ({
    pergunta_id: pergunta.id,
    enunciado: v.enunciado,
    opcoes: v.opcoes.map((o) => ({ texto: o.texto, correta: Boolean(o.correta) })),
  }));

  if (variantes.length === 0) {
    toast('A IA não devolveu versões válidas.', 'error');
    return;
  }

  const { data: inseridas, error: erroInsert } = await sb
    .from('pergunta_variantes')
    .insert(variantes)
    .select('id, enunciado, opcoes, descartada');
  if (erroInsert) {
    toast(erroInsert.message, 'error');
    return;
  }

  // Atualiza só o item atual: remontar a fila jogaria o usuário de volta ao
  // início da sessão. A rotação só muda na PRÓXIMA revisão (depende de
  // vezes_respondida), então a tela continua mostrando esta mesma versão.
  const gravadas = inseridas || [];
  const item = revisaoFila[revisaoIndice];
  item.variantes = gravadas;
  item.pode_variar = false;

  toast(`${gravadas.length} versão(ões) gravada(s) — vão se revezar com o original.`);
  renderRevisaoAtual();
}

// A IA pode gerar variante sutilmente errada. Descartar é soft-delete: a
// linha fica no banco (para auditoria) mas sai da rotação.
async function descartarVariante(pergunta) {
  const varianteId = pergunta.variante_id;

  const { error } = await sb
    .from('pergunta_variantes')
    .update({ descartada: true })
    .eq('id', varianteId);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  // Volta o item para o enunciado original sem remontar a fila (preserva o
  // lugar na sessão). A versão descartada sai da rotação daqui em diante.
  const item = revisaoFila[revisaoIndice];
  item.variantes = (item.variantes || []).filter((v) => v.id !== varianteId);
  if (item.original) {
    item.enunciado = item.original.enunciado;
    item.opcoes = item.original.opcoes;
  }
  delete item.variante_id;
  delete item.original;

  toast('Versão descartada — não aparecerá mais.');
  renderRevisaoAtual();
}
