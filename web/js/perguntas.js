const MAX_OPCOES = 6;

// --- alternância pergunta/flashcard/configurações no cadastro manual ---
document.querySelectorAll('#tipo-toggle-manual button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tipo-toggle-manual button').forEach((b) => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    const tipo = btn.dataset.tipo;
    document.getElementById('card-nova-pergunta').style.display = tipo === 'pergunta' ? 'block' : 'none';
    document.getElementById('card-novo-flashcard').style.display = tipo === 'flashcard' ? 'block' : 'none';
    document.getElementById('card-config-materia').style.display = tipo === 'config' ? 'block' : 'none';
    if (tipo === 'config') carregarConfigMateria();
  });
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
    <input type="text" class="opcao-input" placeholder="${linhas === 0 ? 'Resposta correta' : 'Resposta errada'}" required />
    ${linhas === 0 ? '<span class="opcao-correta-badge">correta</span>' : ''}
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
  const textos = Array.from(document.querySelectorAll('#pergunta-opcoes-container .opcao-input'))
    .map((i) => i.value.trim())
    .filter(Boolean);

  if (textos.length < 2) {
    toast('Preencha pelo menos duas alternativas.', 'error');
    return;
  }

  try {
    await inserirPergunta(Estado.materiaId, {
      enunciado,
      topico,
      dificuldade: 'Média', // interno — não exposto na UI
      origem: 'manual',
      opcoes: textos.map((texto, i) => ({ texto, correta: i === 0 })),
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
      <div class="pergunta-card">
        <div class="pergunta-enunciado">${esc(p.enunciado)}</div>
        <div class="pergunta-meta">
          ${p.tipo === 'flashcard' ? '<span class="badge badge-blue">🃏 flashcard</span>' : ''}
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
        <button type="button" class="btn btn-danger btn-sm remover-pergunta-btn" data-id="${p.id}" style="margin-top:10px">Remover</button>
      </div>`
    )
    .join('');

  lista.querySelectorAll('.remover-pergunta-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      perguntaParaRemover = Number(btn.dataset.id);
      openModal('modal-delete');
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

resetarFormPergunta();
