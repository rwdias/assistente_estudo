let simuladoQuestions = [];
let simuladoAcertos = 0;
let fonteSimulado = 'materia'; // 'materia' | 'banco'
let provasBanco = null; // cache do catálogo p/ filtros

document.getElementById('iniciar-simulado-btn').addEventListener('click', iniciarSimulado);

// --- alternância minhas matérias / banco de questões ---
document.querySelectorAll('#toggle-fonte-simulado button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('#toggle-fonte-simulado button').forEach((b) => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    fonteSimulado = btn.dataset.fonte;
    document.getElementById('simulado-filtros-banco').style.display =
      fonteSimulado === 'banco' ? 'block' : 'none';
    if (fonteSimulado === 'banco') await carregarFiltrosBanco();
  });
});

// --- filtros do banco: tipo de prova, ano, área, prova e tópico ---
// (os selects se refinam em cascata; "estado"/banca entram automaticamente
// quando fontes de concursos trouxerem esse metadado)
async function carregarFiltrosBanco() {
  if (!provasBanco) {
    const { data, error } = await sb
      .from('catalogo_provas')
      .select('id, fonte, nome, ano, area, categoria, nivel, orgao, cargo')
      .order('ano', { ascending: false });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    provasBanco = data || [];
  }
  atualizarFiltrosBanco();
}

function opcoesSelect(select, valores, rotuloTodos) {
  const atual = select.value;
  select.innerHTML = `<option value="">${rotuloTodos}</option>` +
    valores.map((v) => `<option value="${esc(String(v.valor))}">${esc(String(v.rotulo))}</option>`).join('');
  if ([...select.options].some((o) => o.value === atual)) select.value = atual;
}

const ROTULO_NIVEL = { medio: 'Ensino médio', superior: 'Ensino superior', fundamental: 'Ensino fundamental' };

const CAMPOS_FILTRO = {
  categoria: (p) => p.categoria,
  nivel: (p) => p.nivel,
  fonte: (p) => p.fonte,
  orgao: (p) => p.orgao,
  cargo: (p) => p.cargo,
  ano: (p) => (p.ano == null ? '' : String(p.ano)),
  area: (p) => p.area,
  prova: (p) => String(p.id),
};

function valorFiltro(campo) {
  return document.getElementById('sf-' + campo).value;
}

// provas que casam com todos os filtros, opcionalmente ignorando um campo
// (para computar as opções daquele campo — busca facetada de verdade)
function provasFiltradas(ignorar = null) {
  return provasBanco.filter((p) =>
    Object.entries(CAMPOS_FILTRO).every(([campo, ler]) => {
      if (campo === ignorar) return true;
      const v = valorFiltro(campo);
      return !v || ler(p) === v;
    }));
}

async function atualizarFiltrosBanco() {
  const unicos = (lista) => [...new Set(lista.filter((x) => x !== null && x !== undefined && x !== ''))];
  const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // cada facet lista só valores presentes nas provas compatíveis com as
  // OUTRAS seleções (ignorando a própria) -> vestibular não mostra cesgranrio
  const disp = (campo) => unicos(provasFiltradas(campo).map(CAMPOS_FILTRO[campo]));

  opcoesSelect(document.getElementById('sf-categoria'),
    disp('categoria').sort().map((c) => ({ valor: c, rotulo: capitalizar(c) })), 'Todas');
  opcoesSelect(document.getElementById('sf-nivel'),
    disp('nivel').sort().map((n) => ({ valor: n, rotulo: ROTULO_NIVEL[n] || capitalizar(n) })), 'Todos');
  opcoesSelect(document.getElementById('sf-fonte'),
    disp('fonte').sort().map((f) => ({ valor: f, rotulo: f.toUpperCase() })), 'Todas');

  const orgaos = disp('orgao');
  const cargos = disp('cargo');
  document.getElementById('sf-orgao').closest('div').style.display = orgaos.length ? '' : 'none';
  document.getElementById('sf-cargo').closest('div').style.display = cargos.length ? '' : 'none';
  opcoesSelect(document.getElementById('sf-orgao'), orgaos.sort().map((o) => ({ valor: o, rotulo: o })), 'Todos');
  opcoesSelect(document.getElementById('sf-cargo'), cargos.sort().map((c) => ({ valor: c, rotulo: c })), 'Todos');

  opcoesSelect(document.getElementById('sf-ano'),
    disp('ano').sort((a, b) => b - a).map((a) => ({ valor: a, rotulo: a })), 'Todos');
  opcoesSelect(document.getElementById('sf-area'),
    disp('area').sort().map((a) => ({ valor: a, rotulo: a })), 'Todas');
  opcoesSelect(document.getElementById('sf-prova'),
    provasFiltradas('prova').map((p) => ({ valor: p.id, rotulo: p.nome })), 'Todas');

  // tópicos existentes dentro das provas compatíveis com os outros filtros
  const ids = provasFiltradas('topico').map((p) => p.id);
  let topicos = [];
  if (ids.length > 0) {
    const { data } = await sb.from('catalogo_questoes').select('topico').in('prova_id', ids);
    topicos = unicos((data || []).map((q) => q.topico)).sort();
  }
  opcoesSelect(document.getElementById('sf-topico'),
    topicos.map((t) => ({ valor: t, rotulo: t })), 'Todos');
}

['sf-categoria', 'sf-nivel', 'sf-fonte', 'sf-orgao', 'sf-cargo', 'sf-ano', 'sf-area', 'sf-prova'].forEach((id) =>
  document.getElementById(id).addEventListener('change', atualizarFiltrosBanco));

function embaralharLista(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
}

async function iniciarSimulado() {
  const quantidade = Number(document.getElementById('simulado-quantidade').value) || 5;
  const embaralhar = document.getElementById('simulado-embaralhar').checked;

  let perguntas;
  if (fonteSimulado === 'banco') {
    perguntas = await buscarQuestoesDoBanco();
    if (perguntas === null) return;
  } else {
    if (!Estado.materiaId) {
      toast('Crie ou selecione uma matéria primeiro.', 'error');
      return;
    }
    try {
      perguntas = await buscarPerguntasDaMateria(Estado.materiaId);
    } catch (erro) {
      toast(erro.message, 'error');
      return;
    }
    // simulado é só múltipla escolha — flashcards vivem na Revisão
    perguntas = perguntas.filter((p) => p.tipo !== 'flashcard');
  }

  if (embaralhar) embaralharLista(perguntas);
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

// Busca questões direto do catálogo público (treino livre: não grava SM-2).
async function buscarQuestoesDoBanco() {
  const provas = provasFiltradas();
  if (provas.length === 0) {
    toast('Nenhuma prova no banco com esses filtros.', 'error');
    return null;
  }
  const nomes = Object.fromEntries(provas.map((p) => [p.id, p.nome]));
  const topico = document.getElementById('sf-topico').value;

  let consulta = sb
    .from('catalogo_questoes')
    .select('id, numero, enunciado, topico, imagens, imagens_posicao, prova_id, catalogo_alternativas ( texto, correta, ordem )')
    .in('prova_id', provas.map((p) => p.id));
  if (topico) consulta = consulta.eq('topico', topico);

  const { data, error } = await consulta;
  if (error) {
    toast(error.message, 'error');
    return null;
  }

  return (data || []).map((q) => ({
    id: q.id,
    doBanco: true,
    enunciado: q.enunciado,
    topico: q.topico,
    imagens: q.imagens || [],
    imagens_posicao: q.imagens_posicao || 'depois',
    origem_nome: nomes[q.prova_id] || 'Banco de questões',
    opcoes: (q.catalogo_alternativas || []).slice().sort((a, b) => a.ordem - b.ordem),
  }));
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

      // questão do banco público não pertence à conta: treino livre,
      // sem tocar no SM-2 do usuário
      if (pergunta.doBanco) return;

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
