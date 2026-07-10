let extracaoPendente = [];

// Porta de validar_pergunta_json: >=2 opções, exatamente 1 correta,
// todos os textos preenchidos.
function perguntaValida(p) {
  if (!p.enunciado?.trim() || !Array.isArray(p.opcoes) || p.opcoes.length < 2) return false;
  if (p.opcoes.filter((o) => o.correta === true).length !== 1) return false;
  return p.opcoes.every((o) => o.texto?.trim());
}

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
  btn.disabled = true;
  btn.textContent = `Consultando ${modelo}...`;

  const { data, error } = await sb.functions.invoke('extrair', {
    body: {
      modelo,
      texto,
      assunto: materia?.nome ?? 'Estudo',
      dificuldade_padrao: 'Média',
    },
  });

  btn.disabled = false;
  btn.textContent = '✨ Extrair perguntas';

  if (error) {
    toast(await mensagemErroFuncao(error), 'error');
    return;
  }

  extracaoPendente = data.perguntas ?? [];
  renderIaPreview();
  toast(`${extracaoPendente.length} pergunta(s) extraída(s).`);
});

function renderIaPreview() {
  const container = document.getElementById('ia-preview');

  if (extracaoPendente.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <h2 class="secao-titulo">Revise antes de salvar</h2>
    ${extracaoPendente.map((p, i) => renderIaItemHTML(p, i)).join('')}
    <button type="button" class="btn btn-primary" id="ia-salvar-btn">Salvar perguntas selecionadas</button>
  `;

  document.getElementById('ia-salvar-btn').addEventListener('click', salvarExtracao);
}

function renderIaItemHTML(pergunta, indice) {
  return `
    <div class="pergunta-card" data-idx="${indice}">
      <label class="checkbox-label">
        <input type="checkbox" class="ia-incluir" checked /> Incluir esta pergunta ao salvar
      </label>

      <label>Enunciado</label>
      <textarea class="ia-enunciado" rows="2">${esc(pergunta.enunciado)}</textarea>

      <label>Dificuldade</label>
      <select class="ia-dificuldade">
        ${['Fácil', 'Média', 'Difícil']
          .map((d) => `<option ${d === pergunta.dificuldade ? 'selected' : ''}>${d}</option>`)
          .join('')}
      </select>

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

    const textos = Array.from(card.querySelectorAll('.ia-opcao-texto')).map((i) => i.value.trim());
    const indiceCorreto = Number(card.querySelector('.ia-correta-radio:checked')?.value ?? 0);

    selecionadas.push({
      enunciado: card.querySelector('.ia-enunciado').value.trim(),
      dificuldade: card.querySelector('.ia-dificuldade').value,
      topico: card.querySelector('.ia-topico').value.trim() || null,
      opcoes: textos.map((texto, j) => ({ texto, correta: j === indiceCorreto })),
    });
  });

  if (selecionadas.length === 0) {
    toast('Nenhuma pergunta selecionada.', 'error');
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

  for (const pergunta of selecionadas) {
    if (!perguntaValida(pergunta)) {
      invalidas += 1;
      continue;
    }

    const normalizado = pergunta.enunciado.trim().toLowerCase();
    if (existentes.has(normalizado)) {
      duplicadas += 1;
      continue;
    }

    try {
      await inserirPergunta(Estado.materiaId, {
        enunciado: pergunta.enunciado,
        dificuldade: pergunta.dificuldade,
        origem: 'llm',
        topico: pergunta.topico,
        opcoes: pergunta.opcoes,
      });
      salvas += 1;
      existentes.add(normalizado);
    } catch (erro) {
      toast(erro.message, 'error');
      break;
    }
  }

  toast(`Salvas: ${salvas} · Duplicadas: ${duplicadas} · Inválidas: ${invalidas}`);
  extracaoPendente = [];
  document.getElementById('ia-preview').innerHTML = '';
  document.getElementById('ia-texto').value = '';
}
