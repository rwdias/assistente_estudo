const MAX_OPCOES = 6;

// --- alternância pergunta/flashcard/configurações no cadastro manual ---
function abrirAbaManual(tipo) {
  document.querySelectorAll('#tipo-toggle-manual button').forEach((b) =>
    b.classList.toggle('ativo', b.dataset.tipo === tipo)
  );
  document.getElementById('card-nova-pergunta').style.display = tipo === 'pergunta' ? 'block' : 'none';
  document.getElementById('card-novo-flashcard').style.display = tipo === 'flashcard' ? 'block' : 'none';
  document.getElementById('card-config-materia').style.display = tipo === 'config' ? 'block' : 'none';
  if (tipo === 'config') carregarConfigMateria();
}

document.querySelectorAll('#tipo-toggle-manual button').forEach((btn) => {
  btn.addEventListener('click', () => abrirAbaManual(btn.dataset.tipo));
});

// --- tópicos nos selects dos formulários ---
async function carregarTopicosNosSelects() {
  if (!Estado.materiaId) return;

  let topicos;
  try {
    topicos = await listarTopicos(Estado.materiaId);
  } catch (_) {
    return;
  }

  const opcoes =
    '<option value="">Sem tópico</option>' +
    topicos
      .filter((t) => t.nome !== 'Geral')
      .map((t) => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`)
      .join('');

  document.getElementById('pergunta-topico').innerHTML = opcoes;
  document.getElementById('fc-topico').innerHTML = opcoes;
  document.getElementById('editar-topico').innerHTML = opcoes;
}

async function aoAbrirPerguntas() {
  carregarPerguntas();
  carregarTopicosNosSelects();
}

// --- configurações da matéria ---
async function carregarConfigMateria() {
  if (!Estado.materiaId) return;

  const materia = Estado.materias.find((m) => m.id === Estado.materiaId);
  document.getElementById('config-materia-nome').value = materia?.nome ?? '';

  const lista = document.getElementById('config-topicos-lista');
  let topicos;
  try {
    topicos = (await listarTopicos(Estado.materiaId)).filter((t) => t.nome !== 'Geral');
  } catch (erro) {
    toast(erro.message, 'error');
    return;
  }

  if (topicos.length === 0) {
    lista.innerHTML = '<p class="card-sub">Nenhum tópico ainda — adicione abaixo.</p>';
    return;
  }

  lista.innerHTML = topicos
    .map(
      (t) => `
      <div class="topico-item">
        <span>${esc(t.nome)}</span>
        <span class="card-sub">${t.itens} item${t.itens === 1 ? '' : 's'}</span>
        <button type="button" class="btn btn-danger btn-sm remover-topico-btn"
          data-id="${t.id}" data-itens="${t.itens}" ${t.itens > 0 ? 'disabled title="Só é possível remover tópicos vazios"' : ''}>
          Remover
        </button>
      </div>`
    )
    .join('');

  lista.querySelectorAll('.remover-topico-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { error } = await sb.from('subdivisoes').delete().eq('id', Number(btn.dataset.id));
      if (error) {
        toast(error.message, 'error');
        return;
      }
      toast('Tópico removido.');
      carregarConfigMateria();
      carregarTopicosNosSelects();
    });
  });
}

document.getElementById('config-salvar-nome-btn').addEventListener('click', async () => {
  const nome = document.getElementById('config-materia-nome').value.trim();
  if (!nome || !Estado.materiaId) return;

  const { error } = await sb.from('materias').update({ nome }).eq('id', Estado.materiaId);

  if (error) {
    const msg = error.code === '23505' ? 'Você já tem uma matéria com esse nome.' : error.message;
    toast(msg, 'error');
    return;
  }

  toast('Matéria renomeada.');
  await carregarMaterias();
});

document.getElementById('config-add-topico-btn').addEventListener('click', async () => {
  const nome = document.getElementById('config-novo-topico').value.trim();
  if (!nome || !Estado.materiaId) return;

  if (nome.toLowerCase() === 'geral') {
    toast('"Geral" é o tópico padrão — não precisa criar.', 'error');
    return;
  }

  try {
    await garantirSubdivisao(Estado.materiaId, nome);
    document.getElementById('config-novo-topico').value = '';
    toast('Tópico adicionado.');
    carregarConfigMateria();
    carregarTopicosNosSelects();
  } catch (erro) {
    toast(erro.message, 'error');
  }
});

function renderOpcoesForm() {
  const container = document.getElementById('pergunta-opcoes-container');
  const linhas = container.querySelectorAll('.opcao-row').length;

  const row = document.createElement('div');
  row.className = 'opcao-row';
  row.innerHTML = `
    <label class="opcao-correta-check" title="Marcar como correta">
      <input type="checkbox" class="opcao-correta" ${linhas === 0 ? 'checked' : ''} />
    </label>
    <input type="text" class="opcao-input" placeholder="Alternativa" required />
  `;
  container.appendChild(row);
}

document.getElementById('add-opcao-btn').addEventListener('click', () => {
  const container = document.getElementById('pergunta-opcoes-container');
  if (container.querySelectorAll('.opcao-row').length >= MAX_OPCOES) {
    toast('Máximo de 6 alternativas.', 'error');
    return;
  }
  renderOpcoesForm();
});

function resetarFormPergunta() {
  document.getElementById('form-nova-pergunta').reset();
  const container = document.getElementById('pergunta-opcoes-container');
  container.innerHTML = '';
  renderOpcoesForm();
  renderOpcoesForm();
}

// Insere pergunta OU flashcard + linha de revisão (SM-2). Flashcards não
// têm opções: a frente fica em `enunciado` e a resposta em `verso`.
async function inserirPergunta(materiaId, dados) {
  const subdivisaoId = await garantirSubdivisao(materiaId, dados.topico || 'Geral');

  const { data: pergunta, error: erroPergunta } = await sb
    .from('perguntas')
    .insert({
      subdivisao_id: subdivisaoId,
      tipo: dados.tipo || 'pergunta',
      enunciado: dados.enunciado,
      verso: dados.verso ?? null,
      dificuldade: dados.dificuldade,
      origem: dados.origem,
      // explicação já vinda do texto colado (extração) vira o 1º "saber mais"
      ...(Array.isArray(dados.saber_mais) && dados.saber_mais.length
        ? { saber_mais: dados.saber_mais.slice(0, 3) }
        : {}),
    })
    .select('id')
    .single();

  if (erroPergunta) throw new Error(erroPergunta.message);

  if (dados.opcoes?.length) {
    const { error: erroOpcoes } = await sb.from('opcoes').insert(
      dados.opcoes.map((o, i) => ({
        pergunta_id: pergunta.id,
        texto: o.texto,
        correta: o.correta,
        ordem: i + 1,
      }))
    );
    if (erroOpcoes) throw new Error(erroOpcoes.message);
  }

  const { error: erroRevisao } = await sb
    .from('revisoes_perguntas')
    .insert({ pergunta_id: pergunta.id });
  if (erroRevisao) throw new Error(erroRevisao.message);

  return pergunta.id;
}

document.getElementById('form-novo-flashcard').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const frente = document.getElementById('fc-frente').value.trim();
  const verso = document.getElementById('fc-verso').value.trim();

  if (!frente || !verso) {
    toast('Preencha frente e verso.', 'error');
    return;
  }

  try {
    await inserirPergunta(Estado.materiaId, {
      tipo: 'flashcard',
      enunciado: frente,
      verso,
      topico: document.getElementById('fc-topico').value || null,
      dificuldade: 'Média', // interno — não exposto na UI
      origem: 'manual',
      opcoes: [],
    });
    toast('Flashcard adicionado.');
    document.getElementById('form-novo-flashcard').reset();
    carregarPerguntas();
  } catch (erro) {
    toast(erro.message, 'error');
  }
});

document.getElementById('form-nova-pergunta').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const enunciado = document.getElementById('pergunta-enunciado').value.trim();
  const topico = document.getElementById('pergunta-topico').value || null;
  const opcoes = Array.from(document.querySelectorAll('#pergunta-opcoes-container .opcao-row'))
    .map((row) => ({
      texto: row.querySelector('.opcao-input').value.trim(),
      correta: row.querySelector('.opcao-correta').checked,
    }))
    .filter((o) => o.texto);

  if (opcoes.length < 2) {
    toast('Preencha pelo menos duas alternativas.', 'error');
    return;
  }
  if (!opcoes.some((o) => o.correta)) {
    toast('Marque pelo menos uma alternativa como correta.', 'error');
    return;
  }

  try {
    await inserirPergunta(Estado.materiaId, {
      enunciado,
      topico,
      dificuldade: 'Média', // interno — não exposto na UI
      origem: 'manual',
      opcoes,
    });
    toast('Pergunta adicionada.');
    resetarFormPergunta();
    carregarPerguntas();
  } catch (erro) {
    toast(erro.message, 'error');
  }
});

let perguntaParaRemover = null;

async function carregarPerguntas() {
  const lista = document.getElementById('lista-perguntas');

  if (!Estado.materiaId) {
    lista.innerHTML = '<p>Crie ou selecione uma matéria primeiro.</p>';
    return;
  }

  lista.innerHTML = '<p>Carregando...</p>';

  let perguntas;
  try {
    perguntas = await buscarPerguntasDaMateria(Estado.materiaId);
  } catch (erro) {
    lista.innerHTML = '';
    toast(erro.message, 'error');
    return;
  }

  if (perguntas.length === 0) {
    lista.innerHTML = '<p>Nenhuma pergunta ou flashcard cadastrado ainda.</p>';
    return;
  }

  lista.innerHTML = perguntas
    .map(
      (p) => `
      <div class="pergunta-card" data-id="${p.id}">
        <div style="display:flex; align-items:flex-start; gap:10px">
          <div class="pergunta-enunciado" style="flex:1">${esc(p.enunciado)}</div>
          ${renderMenuItemHTML([
            { acao: 'editar', rotulo: 'Editar', icone: ICONE_EDITAR },
            { acao: 'remover', rotulo: 'Remover', icone: ICONE_LIXEIRA, perigo: true },
          ])}
        </div>
        <div class="pergunta-meta">
          ${p.tipo === 'flashcard'
            ? '<span class="badge badge-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7.5 7V6a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-1"/></svg>flashcard</span>'
            : ''}
          ${p.topico ? `<span class="badge badge-amber">${esc(p.topico)}</span>` : ''}
          <span>${p.vezes_acertada}/${p.vezes_respondida} acertos</span>
          ${p.madura ? '<span class="badge badge-green">dominada</span>' : ''}
        </div>
        ${p.tipo === 'flashcard'
          ? `<div class="verso-lista">${esc(p.verso || '')}</div>`
          : p.opcoes
              .map(
                (o) => `
                <div class="opcao-lista ${o.correta ? 'correta' : ''}">
                  <span class="marcador"></span>
                  <span>${esc(o.texto)}</span>
                </div>`
              )
              .join('')}
      </div>`
    )
    .join('');

  const porId = new Map(perguntas.map((p) => [Number(p.id), p]));
  lista.querySelectorAll('.pergunta-card').forEach((card) => {
    const id = Number(card.dataset.id);
    wireMenuItem(card, (acao) => {
      if (acao === 'remover') {
        perguntaParaRemover = id;
        openModal('modal-delete');
      } else if (acao === 'editar') {
        abrirEdicaoItem(porId.get(id), carregarPerguntas);
      }
    });
  });
}

document.getElementById('modal-delete-confirm').addEventListener('click', async () => {
  if (perguntaParaRemover == null) return;

  const { error } = await sb.from('perguntas').delete().eq('id', perguntaParaRemover);

  if (error) {
    toast(error.message, 'error');
  } else {
    closeModal('modal-delete');
    toast('Pergunta removida.');
    carregarPerguntas();
  }
  perguntaParaRemover = null;
});

// --- edição de pergunta/flashcard ---
// `itemEmEdicao` guarda o item aberto e `aoSalvarEdicao` o que recarregar
// depois (a lista, ou a sessão de estudo — quem abriu decide).
let itemEmEdicao = null;
let aoSalvarEdicao = null;

function addLinhaOpcaoEdicao(texto = '', correta = false) {
  const container = document.getElementById('editar-opcoes-container');
  const row = document.createElement('div');
  row.className = 'opcao-row';
  row.innerHTML = `
    <label class="opcao-correta-check" title="Marcar como correta">
      <input type="checkbox" class="editar-opcao-correta" ${correta ? 'checked' : ''} />
    </label>
    <input type="text" class="editar-opcao-texto" placeholder="Alternativa" />
  `;
  row.querySelector('.editar-opcao-texto').value = texto;
  container.appendChild(row);
}

// `item` é o objeto já normalizado (normalizarPergunta). Atenção: as opções
// vêm EMBARALHADAS da exibição — como a edição regrava todas com ordem nova,
// isso é inofensivo (a ordem do banco não tem significado próprio).
async function abrirEdicaoItem(item, aoSalvar) {
  if (!item) return;
  itemEmEdicao = item;
  aoSalvarEdicao = aoSalvar || null;

  // O select de tópicos só era preenchido ao abrir o painel Perguntas; quem
  // edita direto do estudo precisa dele populado, senão salvaria sem tópico.
  await carregarTopicosNosSelects();

  const ehFlashcard = item.tipo === 'flashcard';
  document.getElementById('editar-titulo').textContent =
    ehFlashcard ? 'Editar flashcard' : 'Editar pergunta';
  document.getElementById('editar-label-enunciado').textContent =
    ehFlashcard ? 'Frente' : 'Enunciado';
  document.getElementById('editar-enunciado').value = item.enunciado || '';
  document.getElementById('editar-verso').value = item.verso || '';
  document.getElementById('editar-bloco-verso').style.display = ehFlashcard ? 'block' : 'none';
  document.getElementById('editar-bloco-opcoes').style.display = ehFlashcard ? 'none' : 'block';

  const container = document.getElementById('editar-opcoes-container');
  container.innerHTML = '';
  if (!ehFlashcard) {
    (item.opcoes || []).forEach((o) => addLinhaOpcaoEdicao(o.texto, o.correta));
    if ((item.opcoes || []).length === 0) {
      addLinhaOpcaoEdicao();
      addLinhaOpcaoEdicao();
    }
  }

  const select = document.getElementById('editar-topico');
  select.value = item.topico || '';

  const temVariantes = (item.variantes || []).length > 0;
  document.getElementById('editar-aviso-variantes').hidden = !temVariantes;

  openModal('modal-editar-item');
}

document.getElementById('editar-add-opcao-btn').addEventListener('click', () => {
  const container = document.getElementById('editar-opcoes-container');
  if (container.querySelectorAll('.opcao-row').length >= MAX_OPCOES) {
    toast('Máximo de 6 alternativas.', 'error');
    return;
  }
  addLinhaOpcaoEdicao();
});

document.getElementById('editar-salvar-btn').addEventListener('click', async () => {
  if (!itemEmEdicao) return;

  const ehFlashcard = itemEmEdicao.tipo === 'flashcard';
  const enunciado = document.getElementById('editar-enunciado').value.trim();
  const verso = document.getElementById('editar-verso').value.trim();

  if (!enunciado) {
    toast(ehFlashcard ? 'A frente não pode ficar vazia.' : 'O enunciado não pode ficar vazio.', 'error');
    return;
  }
  if (ehFlashcard && !verso) {
    toast('O verso não pode ficar vazio.', 'error');
    return;
  }

  let opcoes = [];
  if (!ehFlashcard) {
    opcoes = Array.from(document.querySelectorAll('#editar-opcoes-container .opcao-row'))
      .map((row) => ({
        texto: row.querySelector('.editar-opcao-texto').value.trim(),
        correta: row.querySelector('.editar-opcao-correta').checked,
      }))
      .filter((o) => o.texto);

    if (opcoes.length < 2) {
      toast('A pergunta precisa de pelo menos duas alternativas.', 'error');
      return;
    }
    if (!opcoes.some((o) => o.correta)) {
      toast('Marque pelo menos uma alternativa como correta.', 'error');
      return;
    }
  }

  const btn = document.getElementById('editar-salvar-btn');
  btn.disabled = true;

  let subdivisaoId;
  try {
    subdivisaoId = await garantirSubdivisao(
      Estado.materiaId,
      document.getElementById('editar-topico').value || 'Geral',
    );
  } catch (erro) {
    btn.disabled = false;
    toast(erro.message, 'error');
    return;
  }

  // RPC porque trocar as alternativas é apagar + inserir: precisa ser atômico.
  const { data, error } = await sb.rpc('atualizar_pergunta', {
    p_pergunta_id: itemEmEdicao.id,
    p_enunciado: enunciado,
    p_verso: ehFlashcard ? verso : null,
    p_subdivisao_id: subdivisaoId,
    p_opcoes: opcoes,
  });

  btn.disabled = false;

  if (error) {
    toast(error.message, 'error');
    return;
  }

  closeModal('modal-editar-item');
  const descartadas = data?.variantes_descartadas || 0;
  toast(
    descartadas > 0
      ? `Alterações salvas. ${descartadas} versão(ões) reformulada(s) foram descartadas.`
      : 'Alterações salvas.'
  );

  const recarregar = aoSalvarEdicao;
  itemEmEdicao = null;
  aoSalvarEdicao = null;
  if (recarregar) recarregar();
});

resetarFormPergunta();
