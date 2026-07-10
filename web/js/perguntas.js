const MAX_OPCOES = 6;

// --- alternância pergunta/flashcard no cadastro manual ---
document.querySelectorAll('#tipo-toggle-manual button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tipo-toggle-manual button').forEach((b) => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    const flashcard = btn.dataset.tipo === 'flashcard';
    document.getElementById('card-nova-pergunta').style.display = flashcard ? 'none' : 'block';
    document.getElementById('card-novo-flashcard').style.display = flashcard ? 'block' : 'none';
  });
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
      dificuldade: document.getElementById('fc-dificuldade').value,
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
  const dificuldade = document.getElementById('pergunta-dificuldade').value;
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
      dificuldade,
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
          <span class="badge badge-blue">Prova: ${esc(p.dificuldade)}</span>
          <span class="badge badge-amber">Para você: ${esc(p.dificuldade_pessoal)}</span>
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
