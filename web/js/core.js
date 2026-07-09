// --- estado global simples (sem framework) ---
const Estado = {
  token: localStorage.getItem('token') || null,
  materiaId: localStorage.getItem('materiaId') ? Number(localStorage.getItem('materiaId')) : null,
  materias: [],
};

function definirToken(token) {
  Estado.token = token;
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

function definirMateriaAtual(id) {
  Estado.materiaId = id;
  if (id) localStorage.setItem('materiaId', id);
  else localStorage.removeItem('materiaId');
}

// --- helper de API ---
async function api(method, path, body) {
  const opts = { method, headers: {} };

  if (Estado.token) opts.headers['Authorization'] = `Bearer ${Estado.token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const resposta = await fetch(path, opts);

  if (resposta.status === 401) {
    definirToken(null);
    mostrarTelaAuth();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  if (!resposta.ok) {
    let mensagem = `Erro ${resposta.status}`;
    try {
      const corpo = await resposta.json();
      mensagem = corpo.detail || mensagem;
    } catch (_) { /* corpo não era JSON */ }
    throw new Error(mensagem);
  }

  if (resposta.status === 204) return null;
  return resposta.json();
}

// --- navegação entre panels (SPA sem router) ---
const panelMeta = {
  dashboard: { titulo: 'Início', sub: 'Visão geral do seu estudo' },
  simulado: { titulo: 'Simulado', sub: 'Pratique com as perguntas da matéria atual' },
  perguntas: { titulo: 'Perguntas', sub: 'Cadastre e gerencie o banco de questões' },
  revisao: { titulo: 'Revisão', sub: 'Repetição espaçada — responda o que está devido hoje' },
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
  if (id === 'perguntas') carregarPerguntas();
  if (id === 'revisao') carregarRevisao();

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
// `pergunta.opcoes` já vem com `correta` (mesma decisão de paridade com o
// app antigo: quem responde vê o feedback certo/errado imediatamente).
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

// --- escape para innerHTML ---
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

// --- tema claro/escuro ---
// Sem escolha salva, o app segue o sistema; a partir do primeiro clique no
// botão sol/lua a escolha fica em localStorage e passa a valer sempre.
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

function mostrarTelaAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function mostrarApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}
