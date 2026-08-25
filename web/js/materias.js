async function carregarMaterias() {
  const { data, error } = await sb.rpc('resumo_materias');

  if (error) {
    toast('Erro ao carregar matérias: ' + error.message, 'error');
    Estado.materias = [];
    return;
  }

  Estado.materias = data;

  if (Estado.materias.length === 0) {
    definirMateriaAtual(null);
  } else if (!Estado.materias.some((m) => m.id === Estado.materiaId)) {
    definirMateriaAtual(Estado.materias[0].id);
  }

  renderMateriaDropdown();
}

let materiaParaRemover = null;

function abrirConfirmacaoRemoverMateria(materiaId) {
  const materia = Estado.materias.find((m) => m.id === materiaId);
  if (!materia) return;

  materiaParaRemover = materia;
  document.getElementById('modal-delete-materia-nome').textContent = materia.nome;
  openModal('modal-delete-materia');
}

// --- dropdown de matérias no header ---

function painelAtivo() {
  return document.querySelector('.sb-item.active')?.dataset.panel || 'revisao';
}

function renderMateriaDropdown() {
  const atual = Estado.materias.find((m) => m.id === Estado.materiaId);
  document.getElementById('materia-atual-nome').textContent = atual ? atual.nome : 'Sem matéria';
  // "Listas de exercícios" só faz sentido em matéria matemática.
  const sbListas = document.getElementById('sb-listas');
  if (sbListas) sbListas.style.display = materiaEhMatematica() ? '' : 'none';

  const lista = document.getElementById('materia-dropdown-lista');

  if (Estado.materias.length === 0) {
    lista.innerHTML = '<div class="materia-vazio">Nenhuma matéria ainda</div>';
    return;
  }

  lista.innerHTML = Estado.materias
    .map((m) => {
      const pendentes = Number(m.a_aprender || 0) + Number(m.a_revisar || 0);
      return `
      <button type="button" class="materia-item ${m.id === Estado.materiaId ? 'ativo' : ''}" data-id="${m.id}">
        <span>${esc(m.nome)}</span>
        ${pendentes > 0 ? `<span class="badge badge-amber">${pendentes}</span>` : ''}
      </button>`;
    })
    .join('');

  lista.querySelectorAll('.materia-item').forEach((item) => {
    item.addEventListener('click', () => {
      definirMateriaAtual(Number(item.dataset.id));
      fecharDropdownMaterias();
      renderMateriaDropdown();
      goPanel(painelAtivo()); // recarrega o painel atual (Aprendizado incluso)
    });
  });
}

function fecharDropdownMaterias() {
  document.getElementById('materia-dropdown-menu').classList.remove('aberto');
}

document.getElementById('materia-dropdown-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('materia-dropdown-menu').classList.toggle('aberto');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.materia-dropdown')) fecharDropdownMaterias();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharDropdownMaterias();
});

document.getElementById('nova-materia-btn').addEventListener('click', () => {
  fecharDropdownMaterias();
  document.getElementById('nova-materia-nome').value = '';
  document.getElementById('nova-materia-tipo').value = 'normal'; // reset
  openModal('modal-nova-materia');
});

document.getElementById('confirmar-nova-materia-btn').addEventListener('click', async () => {
  const nome = document.getElementById('nova-materia-nome').value.trim();
  if (!nome) return;
  // O tipo define o modo de estudo (normal x matemática) e é fixo na criação.
  const tipoSel = document.getElementById('nova-materia-tipo').value;
  const tipo = tipoSel === 'matematica' ? 'matematica' : 'normal';

  const { data: materia, error } = await sb
    .from('materias')
    .insert({ nome, tipo })
    .select('id, nome')
    .single();

  if (error) {
    const msg = error.code === '23505' ? 'Você já tem uma matéria com esse nome.' : error.message;
    toast(msg, 'error');
    return;
  }

  try {
    await garantirSubdivisao(materia.id, 'Geral');
  } catch (erro) {
    toast(erro.message, 'error');
    return;
  }

  closeModal('modal-nova-materia');
  definirMateriaAtual(materia.id);
  await carregarMaterias();
  toast('Matéria criada.');
  goPanel(painelAtivo());
});

async function carregarDashboard() {
  await carregarMaterias();
  carregarCatalogo();

  const resumo = document.getElementById('dashboard-resumo');
  const container = document.getElementById('dashboard-materias');

  const totalPerguntas = Estado.materias.reduce((s, m) => s + Number(m.total_perguntas), 0);
  const totalFlashcards = Estado.materias.reduce((s, m) => s + Number(m.total_flashcards || 0), 0);
  const totalAprender = Estado.materias.reduce((s, m) => s + Number(m.a_aprender || 0), 0);
  const totalRevisar = Estado.materias.reduce((s, m) => s + Number(m.a_revisar || 0), 0);

  resumo.innerHTML = `
    <div class="stat-card">
      <div class="stat-valor brand">${Estado.materias.length}</div>
      <div class="stat-rotulo">matéria${Estado.materias.length === 1 ? '' : 's'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor">${totalPerguntas}</div>
      <div class="stat-rotulo">pergunta${totalPerguntas === 1 ? '' : 's'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor">${totalFlashcards}</div>
      <div class="stat-rotulo">flashcard${totalFlashcards === 1 ? '' : 's'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor brand">${totalAprender}</div>
      <div class="stat-rotulo">a aprender</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor ${totalRevisar > 0 ? 'alerta' : ''}">${totalRevisar}</div>
      <div class="stat-rotulo">a revisar</div>
    </div>
  `;

  if (Estado.materias.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="icone">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:42px;height:42px"><circle cx="7" cy="6.5" r="2.6"/><circle cx="17" cy="6.5" r="2.6"/><circle cx="12" cy="13.5" r="7"/><circle cx="9.5" cy="12.5" r=".6" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12.5" r=".6" fill="currentColor" stroke="none"/><path d="M10.7 16h2.6"/></svg>
        </div>
        Nenhuma matéria ainda.<br />Crie a primeira pelo seletor de matéria no topo.
      </div>`;
    return;
  }

  container.innerHTML = Estado.materias
    .map((m) => {
      const pendentes = Number(m.a_aprender || 0) + Number(m.a_revisar || 0);
      return `
      <div class="card-materia" data-id="${m.id}" title="Abrir aprendizado de ${esc(m.nome)}">
        <div class="card-materia-acoes">
          <button type="button" class="card-acao-btn acao-adicionar" data-id="${m.id}" title="Adicionar perguntas/flashcards">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button type="button" class="card-acao-btn acao-config" data-id="${m.id}" title="Configurações da matéria">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
          </button>
          <button type="button" class="card-acao-btn acao-remover" data-id="${m.id}" title="Remover matéria da minha conta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
        <div class="nome">${esc(m.nome)}</div>
        <div class="metricas">
          <span><b>${m.total_perguntas}</b> pergunta${Number(m.total_perguntas) === 1 ? '' : 's'}</span>
          <span><b>${m.total_flashcards || 0}</b> flashcard${Number(m.total_flashcards) === 1 ? '' : 's'}</span>
          ${pendentes > 0 ? `<span class="badge badge-amber">${pendentes} pendente${pendentes === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.card-materia').forEach((card) => {
    card.addEventListener('click', () => {
      definirMateriaAtual(Number(card.dataset.id));
      renderMateriaDropdown();
      goPanel('revisao');
    });
  });

  container.querySelectorAll('.acao-adicionar').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      definirMateriaAtual(Number(btn.dataset.id));
      renderMateriaDropdown();
      goPanel('perguntas');
      abrirAbaManual('pergunta');
    });
  });

  container.querySelectorAll('.acao-config').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      definirMateriaAtual(Number(btn.dataset.id));
      renderMateriaDropdown();
      goPanel('perguntas');
      abrirAbaManual('config');
    });
  });

  container.querySelectorAll('.acao-remover').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirConfirmacaoRemoverMateria(Number(btn.dataset.id));
    });
  });
}

document.getElementById('modal-delete-materia-confirm').addEventListener('click', async () => {
  if (!materiaParaRemover) return;

  const btn = document.getElementById('modal-delete-materia-confirm');
  const materiaId = materiaParaRemover.id;
  const nome = materiaParaRemover.nome;

  btn.disabled = true;
  btn.textContent = 'Removendo...';

  const { error } = await sb.from('materias').delete().eq('id', materiaId);

  btn.disabled = false;
  btn.textContent = 'Remover da minha conta';

  if (error) {
    toast(error.message, 'error');
    return;
  }

  closeModal('modal-delete-materia');
  materiaParaRemover = null;
  if (Estado.materiaId === materiaId) definirMateriaAtual(null);
  await carregarDashboard();
  toast(`"${nome}" removida da sua conta.`);
});

// --- Banco de provas (catálogo público, curado fora do app) ---

async function carregarCatalogo() {
  const secao = document.getElementById('dashboard-catalogo-secao');
  const container = document.getElementById('dashboard-catalogo');

  const { data: provas, error } = await sb
    .from('catalogo_provas')
    .select('id, fonte, nome, ano, area, total_questoes')
    .order('ano', { ascending: false })
    .order('nome');

  if (error || !provas || provas.length === 0) {
    secao.style.display = 'none';
    return;
  }

  const minhas = new Set(Estado.materias.map((m) => m.nome));
  const ICONE_PROVA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>';

  secao.style.display = 'block';
  container.innerHTML = provas
    .map((p) => {
      const jaTem = minhas.has(p.nome);
      return `
      <div class="card-prova">
        <div class="card-prova-icone">${ICONE_PROVA}</div>
        <div class="nome">${esc(p.nome)}</div>
        <div class="metricas">
          <span class="badge badge-blue">${esc(p.fonte)}</span>
          <span><b>${p.total_questoes}</b> questões</span>
        </div>
        <button type="button" class="btn ${jaTem ? 'btn-secondary' : 'btn-primary'} btn-sm importar-prova-btn"
                data-id="${p.id}" ${jaTem ? 'disabled' : ''}>
          ${jaTem
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg> Adicionada'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Adicionar à minha conta'}
        </button>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.importar-prova-btn:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Adicionando...';

      const { data, error: erro } = await sb.rpc('importar_prova_catalogo', {
        p_prova_id: Number(btn.dataset.id),
      });

      if (erro) {
        toast(erro.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Adicionar à minha conta';
        return;
      }

      toast(`${data.importadas} questões adicionadas em "${data.materia_nome}".`);
      await carregarDashboard();
    });
  });
}
