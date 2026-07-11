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
      .select('id, fonte, nome, ano, area')
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

function provasFiltradas() {
  const fonte = document.getElementById('sf-fonte').value;
  const ano = document.getElementById('sf-ano').value;
  const area = document.getElementById('sf-area').value;
  const prova = document.getElementById('sf-prova').value;
  return provasBanco.filter((p) =>
    (!fonte || p.fonte === fonte) &&
    (!ano || String(p.ano) === ano) &&
    (!area || p.area === area) &&
    (!prova || String(p.id) === prova));
}

async function atualizarFiltrosBanco() {
  const unicos = (lista) => [...new Set(lista.filter(Boolean))];
  const semProva = provasFiltradas();

  opcoesSelect(document.getElementById('sf-fonte'),
    unicos(provasBanco.map((p) => p.fonte)).sort().map((f) => ({ valor: f, rotulo: f.toUpperCase() })), 'Todos');
  opcoesSelect(document.getElementById('sf-ano'),
    unicos(provasBanco.map((p) => p.ano)).sort((a, b) => b - a).map((a) => ({ valor: a, rotulo: a })), 'Todos');
  opcoesSelect(document.getElementById('sf-area'),
    unicos(provasBanco.map((p) => p.area)).sort().map((a) => ({ valor: a, rotulo: a })), 'Todas');
  opcoesSelect(document.getElementById('sf-prova'),
    semProva.map((p) => ({ valor: p.id, rotulo: p.nome })), 'Todas');

  // tópicos existentes dentro das provas filtradas
  const ids = semProva.map((p) => p.id);
  let topicos = [];
  if (ids.length > 0) {
    const { data } = await sb.from('catalogo_questoes').select('topico').in('prova_id', ids);
    topicos = unicos((data || []).map((q) => q.topico)).sort();
  }
  opcoesSelect(document.getElementById('sf-topico'),
    topicos.map((t) => ({ valor: t, rotulo: t })), 'Todos');
}

['sf-fonte', 'sf-ano', 'sf-area', 'sf-prova'].forEach((id) =>
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
