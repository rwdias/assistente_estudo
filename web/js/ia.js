let extracaoPendente = [];
let tipoIa = 'pergunta';

// Porta de validar_pergunta_json: >=2 opções, exatamente 1 correta,
// todos os textos preenchidos.
function perguntaValida(p) {
  if (!p.enunciado?.trim() || !Array.isArray(p.opcoes) || p.opcoes.length < 2) return false;
  if (p.opcoes.filter((o) => o.correta === true).length !== 1) return false;
  return p.opcoes.every((o) => o.texto?.trim());
}

function flashcardValido(f) {
  return Boolean(f.enunciado?.trim() && f.verso?.trim());
}

// --- alternância pergunta/flashcard + contexto por matéria ---

function atualizarModoIa() {
  const flashcard = tipoIa === 'flashcard';
  document.getElementById('ia-contexto-card').style.display = flashcard ? 'block' : 'none';
  document.getElementById('ia-titulo').textContent = flashcard
    ? 'Adicionar flashcards via IA'
    : 'Adicionar perguntas via IA';
  document.getElementById('ia-subtitulo').textContent = flashcard
    ? 'Cole anotações, apostila ou trechos do edital — a IA gera flashcards de recall ativo (o contexto acima orienta o estilo).'
    : 'Cole questões em qualquer formato — a IA extrai enunciado, alternativas e resposta correta.';
  document.getElementById('ia-texto-label').textContent = flashcard
    ? 'Cole o material de estudo'
    : 'Cole o texto com as perguntas';
  extracaoPendente = [];
  document.getElementById('ia-preview').innerHTML = '';
}

document.querySelectorAll('#tipo-toggle-ia button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tipo-toggle-ia button').forEach((b) => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    tipoIa = btn.dataset.tipo;
    atualizarModoIa();
  });
});

// Chamado pelo goPanel ao abrir o painel de IA: carrega o contexto salvo
// da matéria atual.
async function aoAbrirIa() {
  const campo = document.getElementById('ia-contexto');
  campo.value = '';
  document.getElementById('contexto-status').textContent = '';

  if (!Estado.materiaId) return;

  const { data, error } = await sb
    .from('materias')
    .select('contexto_ia')
    .eq('id', Estado.materiaId)
    .single();

  if (!error && data?.contexto_ia) campo.value = data.contexto_ia;
}

document.getElementById('salvar-contexto-btn').addEventListener('click', async () => {
  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const contexto = document.getElementById('ia-contexto').value.trim() || null;

  const { error } = await sb
    .from('materias')
    .update({ contexto_ia: contexto })
    .eq('id', Estado.materiaId);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  document.getElementById('contexto-status').textContent = 'Contexto salvo.';
  toast('Contexto da matéria salvo.');
});

// --- extração ---

document.getElementById('ia-extrair-btn').addEventListener('click', async () => {
  if (!Estado.materiaId) {
    toast('Crie ou selecione uma matéria primeiro.', 'error');
    return;
  }

  const modelo = document.getElementById('ia-modelo').value;
  const texto = document.getElementById('ia-texto').value.trim();
  const materia = Estado.materias.find((m) => m.id === Estado.materiaId);

  if (!texto) {
    toast('Cole algum texto primeiro.', 'error');
    return;
  }

  const btn = document.getElementById('ia-extrair-btn');
  const conteudoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = `Consultando ${modelo}...`;

  const corpo = {
    modelo,
    texto,
    tipo: tipoIa,
    assunto: materia?.nome ?? 'Estudo',
    dificuldade_padrao: 'Média',
  };
  if (tipoIa === 'flashcard') {
    corpo.contexto = document.getElementById('ia-contexto').value.trim();
  }

  const { data, error } = await sb.functions.invoke('extrair', { body: corpo });

  btn.disabled = false;
  btn.innerHTML = conteudoOriginal;

  if (error) {
    toast(await mensagemErroFuncao(error), 'error');
    return;
  }

  if (tipoIa === 'flashcard') {
    extracaoPendente = (data.flashcards ?? []).map((f) => ({
      tipo: 'flashcard',
      enunciado: f.frente,
      verso: f.verso,
      dificuldade: f.dificuldade,
      topico: f.topico,
    }));
  } else {
    extracaoPendente = (data.perguntas ?? []).map((p) => ({ tipo: 'pergunta', ...p }));
  }

  renderIaPreview();
  toast(`${extracaoPendente.length} item(ns) extraído(s).`);
});

function renderIaPreview() {
  const container = document.getElementById('ia-preview');

  if (extracaoPendente.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <h2 class="secao-titulo">Revise antes de salvar</h2>
    ${extracaoPendente.map((p, i) =>
      p.tipo === 'flashcard' ? renderIaFlashcardHTML(p, i) : renderIaItemHTML(p, i)
    ).join('')}
    <button type="button" class="btn btn-primary" id="ia-salvar-btn">Salvar selecionados</button>
  `;

  document.getElementById('ia-salvar-btn').addEventListener('click', salvarExtracao);
}

function renderIaFlashcardHTML(card, indice) {
  return `
    <div class="pergunta-card" data-idx="${indice}" data-tipo="flashcard">
      <label class="checkbox-label">
        <input type="checkbox" class="ia-incluir" checked /> Incluir este flashcard ao salvar
      </label>

      <label>Frente</label>
      <textarea class="ia-enunciado" rows="2">${esc(card.enunciado)}</textarea>

      <label>Verso</label>
      <textarea class="ia-verso" rows="3">${esc(card.verso)}</textarea>
      <input type="hidden" class="ia-dificuldade" value="${esc(card.dificuldade || 'Média')}" />

      <label>Tópico (opcional)</label>
      <input type="text" class="ia-topico" value="${esc(card.topico || '')}" />
    </div>
  `;
}

function renderIaItemHTML(pergunta, indice) {
  return `
    <div class="pergunta-card" data-idx="${indice}" data-tipo="pergunta">
      <label class="checkbox-label">
        <input type="checkbox" class="ia-incluir" checked /> Incluir esta pergunta ao salvar
      </label>

      <label>Enunciado</label>
      <textarea class="ia-enunciado" rows="2">${esc(pergunta.enunciado)}</textarea>
      <input type="hidden" class="ia-dificuldade" value="${esc(pergunta.dificuldade || 'Média')}" />

      <label>Alternativas (marque a correta)</label>
      ${pergunta.opcoes
        .map(
          (o, j) => `
        <div class="opcao-row">
          <input type="radio" name="ia-correta-${indice}" class="ia-correta-radio" value="${j}" ${o.correta ? 'checked' : ''} />
          <input type="text" class="ia-opcao-texto" value="${esc(o.texto)}" />
        </div>`
        )
        .join('')}

      <label>Tópico (opcional)</label>
      <input type="text" class="ia-topico" value="${esc(pergunta.topico || '')}" />
    </div>
  `;
}

async function salvarExtracao() {
  const cards = document.querySelectorAll('#ia-preview .pergunta-card');
  const selecionadas = [];

  cards.forEach((card) => {
    if (!card.querySelector('.ia-incluir').checked) return;

    const base = {
      tipo: card.dataset.tipo,
      enunciado: card.querySelector('.ia-enunciado').value.trim(),
      dificuldade: card.querySelector('.ia-dificuldade').value,
      topico: card.querySelector('.ia-topico').value.trim() || null,
    };

    if (card.dataset.tipo === 'flashcard') {
      selecionadas.push({
        ...base,
        verso: card.querySelector('.ia-verso').value.trim(),
        opcoes: [],
      });
    } else {
      const textos = Array.from(card.querySelectorAll('.ia-opcao-texto')).map((i) => i.value.trim());
      const indiceCorreto = Number(card.querySelector('.ia-correta-radio:checked')?.value ?? 0);
      selecionadas.push({
        ...base,
        opcoes: textos.map((texto, j) => ({ texto, correta: j === indiceCorreto })),
      });
    }
  });

  if (selecionadas.length === 0) {
    toast('Nenhum item selecionado.', 'error');
    return;
  }

  let existentes;
  try {
    existentes = new Set(
      (await buscarPerguntasDaMateria(Estado.materiaId)).map((p) =>
        p.enunciado.trim().toLowerCase()
      )
    );
  } catch (erro) {
    toast(erro.message, 'error');
    return;
  }

  let salvas = 0;
  let duplicadas = 0;
  let invalidas = 0;

  for (const item of selecionadas) {
    const valido = item.tipo === 'flashcard' ? flashcardValido(item) : perguntaValida(item);
    if (!valido) {
      invalidas += 1;
      continue;
    }

    const normalizado = item.enunciado.trim().toLowerCase();
    if (existentes.has(normalizado)) {
      duplicadas += 1;
      continue;
    }

    try {
      await inserirPergunta(Estado.materiaId, { ...item, origem: 'llm' });
      salvas += 1;
      existentes.add(normalizado);
    } catch (erro) {
      toast(erro.message, 'error');
      break;
    }
  }

  toast(`Salvos: ${salvas} · Duplicados: ${duplicadas} · Inválidos: ${invalidas}`);
  extracaoPendente = [];
  document.getElementById('ia-preview').innerHTML = '';
  document.getElementById('ia-texto').value = '';
}
