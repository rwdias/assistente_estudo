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

// --- dropdown de matérias no header ---

function painelAtivo() {
  return document.querySelector('.sb-item.active')?.dataset.panel || 'revisao';
}

function renderMateriaDropdown() {
  const atual = Estado.materias.find((m) => m.id === Estado.materiaId);
  document.getElementById('materia-atual-nome').textContent = atual ? atual.nome : 'Sem matéria';

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
  openModal('modal-nova-materia');
});

document.getElementById('confirmar-nova-materia-btn').addEventListener('click', async () => {
  const nome = document.getElementById('nova-materia-nome').value.trim();
  if (!nome) return;

  const { data: materia, error } = await sb
    .from('materias')
    .insert({ nome })
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
}
