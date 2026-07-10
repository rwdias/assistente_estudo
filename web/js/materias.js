async function carregarMaterias() {
  const { data, error } = await sb.rpc('resumo_materias');

  if (error) {
    toast('Erro ao carregar matérias: ' + error.message, 'error');
    Estado.materias = [];
    return;
  }

  Estado.materias = data;

  const select = document.getElementById('sidebar-materia');
  select.innerHTML = Estado.materias
    .map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`)
    .join('');

  if (Estado.materias.length === 0) {
    definirMateriaAtual(null);
    return;
  }

  const existeAtual = Estado.materias.some((m) => m.id === Estado.materiaId);
  if (!existeAtual) definirMateriaAtual(Estado.materias[0].id);

  select.value = String(Estado.materiaId);
}

document.getElementById('sidebar-materia').addEventListener('change', (e) => {
  definirMateriaAtual(Number(e.target.value));
  goPanel(document.querySelector('.sb-item.active')?.dataset.panel || 'dashboard');
});

document.getElementById('nova-materia-btn').addEventListener('click', () => {
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
  await carregarMaterias();
  definirMateriaAtual(materia.id);
  document.getElementById('sidebar-materia').value = String(materia.id);
  toast('Matéria criada.');
  carregarDashboard();
});

async function carregarDashboard() {
  await carregarMaterias();

  const resumo = document.getElementById('dashboard-resumo');
  const container = document.getElementById('dashboard-materias');

  const totalPerguntas = Estado.materias.reduce((s, m) => s + Number(m.total_perguntas), 0);
  const totalDevidas = Estado.materias.reduce((s, m) => s + Number(m.devidas_revisao), 0);

  resumo.innerHTML = `
    <div class="stat-card">
      <div class="stat-valor brand">${Estado.materias.length}</div>
      <div class="stat-rotulo">matéria${Estado.materias.length === 1 ? '' : 's'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor">${totalPerguntas}</div>
      <div class="stat-rotulo">pergunta${totalPerguntas === 1 ? '' : 's'} no total</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor ${totalDevidas > 0 ? 'alerta' : ''}">${totalDevidas}</div>
      <div class="stat-rotulo">para revisar hoje</div>
    </div>
  `;

  if (Estado.materias.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="icone">🐭</div>
        Nenhuma matéria ainda.<br />Crie a primeira pelo botão "+" na barra lateral.
      </div>`;
    return;
  }

  container.innerHTML = Estado.materias
    .map(
      (m) => `
      <div class="card-materia" data-id="${m.id}">
        ${Number(m.devidas_revisao) > 0 ? `<span class="badge badge-amber badge-devidas">${m.devidas_revisao} devida${Number(m.devidas_revisao) === 1 ? '' : 's'}</span>` : ''}
        <div class="nome">${esc(m.nome)}</div>
        <div class="metricas">
          <span><b>${m.total_perguntas}</b> pergunta${Number(m.total_perguntas) === 1 ? '' : 's'}</span>
          <span><b>${m.devidas_revisao}</b> para revisar</span>
        </div>
      </div>`
    )
    .join('');

  container.querySelectorAll('.card-materia').forEach((card) => {
    card.addEventListener('click', () => {
      const id = Number(card.dataset.id);
      definirMateriaAtual(id);
      document.getElementById('sidebar-materia').value = String(id);
      goPanel('perguntas');
    });
  });
}
