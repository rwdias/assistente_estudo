// --- cliente Supabase + estado global ---
const sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

const Estado = {
  materiaId: localStorage.getItem('materiaId') ? Number(localStorage.getItem('materiaId')) : null,
  materias: [],
};

function definirMateriaAtual(id) {
  Estado.materiaId = id;
  if (id) localStorage.setItem('materiaId', id);
  else localStorage.removeItem('materiaId');
}

// --- domínio: SRS (exibição) ---
// Porta de src/srs.py: dificuldade pessoal e maturidade são derivadas do
// histórico salvo em revisoes_perguntas; o SM-2 em si roda no banco
// (função registrar_resposta).
const MATURIDADE_DIAS = 21;
const TAXA_ACERTO_FACIL = 0.75;
const TAXA_ACERTO_MEDIA = 0.4;

function dificuldadePessoal(estatica, vezesRespondida, vezesAcertada, ultimaCorreta) {
  if (!vezesRespondida) return estatica;
  if (ultimaCorreta === false) return 'Difícil';
  const taxa = vezesAcertada / vezesRespondida;
  if (taxa >= TAXA_ACERTO_FACIL) return 'Fácil';
  if (taxa >= TAXA_ACERTO_MEDIA) return 'Média';
  return 'Difícil';
}

// Converte a linha aninhada do PostgREST para o formato que a UI consome.
function normalizarPergunta(linha) {
  const rev = Array.isArray(linha.revisoes_perguntas)
    ? linha.revisoes_perguntas[0]
    : linha.revisoes_perguntas;

  const opcoes = (linha.opcoes || []).slice().sort((a, b) => a.ordem - b.ordem);
  const vezesRespondida = rev?.vezes_respondida ?? 0;
  const vezesAcertada = rev?.vezes_acertada ?? 0;

  return {
    id: linha.id,
    tipo: linha.tipo || 'pergunta',
    topico: linha.subdivisoes?.nome && linha.subdivisoes.nome !== 'Geral'
      ? linha.subdivisoes.nome
      : null,
    enunciado: linha.enunciado,
    verso: linha.verso,
    dificuldade: linha.dificuldade,
    origem: linha.origem,
    opcoes,
    vezes_respondida: vezesRespondida,
    vezes_acertada: vezesAcertada,
    madura: (rev?.intervalo_dias ?? 0) >= MATURIDADE_DIAS,
    dificuldade_pessoal: dificuldadePessoal(
      linha.dificuldade, vezesRespondida, vezesAcertada,
      rev?.ultima_resposta_correta ?? null,
    ),
    proxima_revisao_em: rev?.proxima_revisao_em ?? null,
  };
}

const SELECT_PERGUNTA = `
  id, tipo, enunciado, verso, dificuldade, origem, created_at,
  opcoes ( texto, correta, ordem ),
  revisoes_perguntas ( vezes_respondida, vezes_acertada, ultima_resposta_correta,
                       intervalo_dias, proxima_revisao_em ),
  subdivisoes!inner ( materia_id, nome )
`;

async function listarTopicos(materiaId) {
  const { data, error } = await sb
    .from('subdivisoes')
    .select('id, nome, perguntas ( count )')
    .eq('materia_id', materiaId)
    .order('nome');

  if (error) throw new Error(error.message);
  return data.map((s) => ({
    id: s.id,
    nome: s.nome,
    itens: s.perguntas?.[0]?.count ?? 0,
  }));
}

async function buscarPerguntasDaMateria(materiaId) {
  const { data, error } = await sb
    .from('perguntas')
    .select(SELECT_PERGUNTA)
    .eq('subdivisoes.materia_id', materiaId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data.map(normalizarPergunta);
}

async function garantirSubdivisao(materiaId, nome) {
  const nomeLimpo = (nome || 'Geral').trim() || 'Geral';

  const { data: existente, error: erroBusca } = await sb
    .from('subdivisoes')
    .select('id')
    .eq('materia_id', materiaId)
    .eq('nome', nomeLimpo)
    .maybeSingle();

  if (erroBusca) throw new Error(erroBusca.message);
  if (existente) return existente.id;

  const { data: criada, error: erroInsert } = await sb
    .from('subdivisoes')
    .insert({ materia_id: materiaId, nome: nomeLimpo })
    .select('id')
    .single();

  if (erroInsert) throw new Error(erroInsert.message);
  return criada.id;
}

// Mensagem de erro amigável para invocações de Edge Function.
async function mensagemErroFuncao(error) {
  try {
    const corpo = await error.context.json();
    if (corpo?.erro) return corpo.erro;
  } catch (_) { /* resposta sem JSON */ }
  return 'Falha ao chamar a IA. Tente novamente.';
}

// --- navegação entre panels (SPA sem router) ---
const panelMeta = {
  revisao: { titulo: 'Aprendizado', sub: 'Aprenda o que é novo e revise o que está devido — repetição espaçada' },
  dashboard: { titulo: 'Início', sub: 'Visão geral do seu estudo' },
  simulado: { titulo: 'Simulado', sub: 'Pratique com as perguntas da matéria atual' },
  perguntas: { titulo: 'Perguntas', sub: 'Cadastre e gerencie o banco de questões' },
  ia: { titulo: 'Adicionar via IA', sub: 'Cole questões e deixe a IA estruturar tudo' },
};

function goPanel(id) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach((i) => i.classList.remove('active'));

  document.getElementById('panel-' + id)?.classList.add('active');
  document.querySelector(`.sb-item[data-panel="${id}"]`)?.classList.add('active');

  const meta = panelMeta[id] || { titulo: id, sub: '' };
  document.getElementById('topbar-title').textContent = meta.titulo;
  document.getElementById('topbar-sub').textContent = meta.sub;

  if (id === 'dashboard') carregarDashboard();
  if (id === 'perguntas') aoAbrirPerguntas();
  if (id === 'revisao') carregarRevisao();
  if (id === 'ia') aoAbrirIa();

  window.scrollTo(0, 0);
}

document.querySelectorAll('.sb-item').forEach((item) => {
  item.addEventListener('click', () => goPanel(item.dataset.panel));
});

// --- toast ---
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// --- modal ---
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
});

// --- renderização compartilhada de uma pergunta em modo quiz ---
const LETRAS = 'ABCDEFGH';

function renderPerguntaQuizHTML(pergunta, chave) {
  return `
    <div class="question-card" data-chave="${chave}">
      <div class="question-title">${esc(pergunta.enunciado)}</div>
      <div class="opcoes-quiz">
        ${pergunta.opcoes
          .map(
            (o, idx) => `
            <div class="opcao-quiz" data-idx="${idx}">
              <span class="opcao-letra">${LETRAS[idx] || '?'}</span>
              <span>${esc(o.texto)}</span>
            </div>`
          )
          .join('')}
      </div>
    </div>
  `;
}

function wirePerguntaQuiz(pergunta, chave, aoResponder) {
  const card = document.querySelector(`.question-card[data-chave="${chave}"]`);
  if (!card) return;

  card.querySelectorAll('.opcao-quiz').forEach((el, idx) => {
    el.addEventListener('click', async () => {
      if (card.dataset.respondida) return;
      card.dataset.respondida = '1';

      const opcaoEscolhida = pergunta.opcoes[idx];

      card.querySelectorAll('.opcao-quiz').forEach((el2, idx2) => {
        el2.classList.add('desabilitada');
        if (pergunta.opcoes[idx2].correta) el2.classList.add('correta');
      });
      el.classList.add(opcaoEscolhida.correta ? 'correta' : 'incorreta', 'selecionada');

      await aoResponder(opcaoEscolhida.correta);
    });
  });
}

// --- tema claro/escuro ---
function temaEfetivo() {
  const manual = document.documentElement.dataset.theme;
  if (manual) return manual;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function atualizarIconesTema() {
  const escuro = temaEfetivo() === 'dark';
  document.querySelectorAll('.tema-toggle').forEach((btn) => {
    btn.querySelector('.icone-lua').style.display = escuro ? 'none' : 'block';
    btn.querySelector('.icone-sol').style.display = escuro ? 'block' : 'none';
  });
}

function alternarTema() {
  const novo = temaEfetivo() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = novo;
  localStorage.setItem('tema', novo);
  atualizarIconesTema();
}

function aplicarTemaSalvo() {
  const salvo = localStorage.getItem('tema');
  if (salvo === 'light' || salvo === 'dark') {
    document.documentElement.dataset.theme = salvo;
  }
  atualizarIconesTema();
}

document.querySelectorAll('.tema-toggle').forEach((btn) => {
  btn.addEventListener('click', alternarTema);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', atualizarIconesTema);
aplicarTemaSalvo();

// --- sidebar: fixar/recolher (rail expande no hover) ---
(function initSidebarPin() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-pin-btn');
  if (!sidebar || !btn) return;

  if (localStorage.getItem('sidebarFixa') === '1') sidebar.classList.add('pinned');

  btn.addEventListener('click', () => {
    const fixa = sidebar.classList.toggle('pinned');
    localStorage.setItem('sidebarFixa', fixa ? '1' : '0');
  });
})();

// --- escape para innerHTML (obrigatório em todo dado dinâmico) ---
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

function mostrarTelaAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function mostrarApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}
