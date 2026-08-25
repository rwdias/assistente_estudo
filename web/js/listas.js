// Listas de exercícios — a 3ª categoria de estudo (só em matéria matemática).
// Fluxo: colar exercícios → a IA monta (enunciado + resolução + resposta +
// verificação) → o CÓDIGO confere as respostas calculáveis (Calc/Logica via
// conferir.js) no preview → salvar como uma lista de exercícios.
// O "resolver a lista" (percorrer e responder) fica no Aprendizado/próximo passo.

let listaExtracao = []; // exercícios extraídos, aguardando salvar

// Abre o painel: limpa o formulário e carrega as listas existentes da matéria.
async function aoAbrirListas() {
  listaExtracao = [];
  document.getElementById('lista-preview').innerHTML = '';
  const nome = document.getElementById('lista-nome');
  const texto = document.getElementById('lista-texto');
  if (nome) nome.value = '';
  if (texto) texto.value = '';
  await carregarListas();
}

// Lista as listas da matéria atual, com a contagem de exercícios.
async function carregarListas() {
  const alvo = document.getElementById('listas-existentes');
  if (!Estado.materiaId) { alvo.innerHTML = '<p>Crie ou selecione uma matéria primeiro.</p>'; return; }

  const { data, error } = await sb
    .from('listas')
    .select('id, nome, perguntas ( count )')
    .eq('materia_id', Estado.materiaId)
    .order('created_at', { ascending: false });

  if (error) { toast(error.message, 'error'); return; }
  if (!data || data.length === 0) { alvo.innerHTML = '<p>Nenhuma lista ainda.</p>'; return; }

  alvo.innerHTML = data
    .map((l) => `
      <div class="pergunta-card">
        <div class="pergunta-enunciado">${esc(l.nome)}</div>
        <div class="pergunta-meta">
          <span>${l.perguntas?.[0]?.count ?? 0} exercício(s)</span>
        </div>
      </div>`)
    .join('');
}

// Gera a lista por IA a partir do texto colado.
document.getElementById('lista-gerar-btn')?.addEventListener('click', async () => {
  if (!Estado.materiaId) { toast('Crie ou selecione uma matéria primeiro.', 'error'); return; }
  const texto = document.getElementById('lista-texto').value.trim();
  if (!texto) { toast('Cole os exercícios primeiro.', 'error'); return; }

  const modelo = document.getElementById('lista-modelo').value;
  const materia = Estado.materias.find((m) => m.id === Estado.materiaId);
  const btn = document.getElementById('lista-gerar-btn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = `Consultando ${modelo}...`;

  const { data, error } = await sb.functions.invoke('extrair', {
    body: {
      modelo, texto, tipo: 'exercicio', matematica: true,
      assunto: materia?.nome ?? 'Matemática', dificuldade_padrao: 'Média',
    },
  });

  btn.disabled = false;
  btn.innerHTML = original;
  if (error) { toast(await mensagemErroFuncao(error), 'error'); return; }

  listaExtracao = (data.exercicios ?? []).map((e) => ({
    frente: e.frente, verso: e.verso, resposta: e.resposta,
    dificuldade: e.dificuldade || 'Média', topico: e.topico || null,
    verificacao: e.verificacao || null,
  }));
  renderListaPreview();
  toast(`${listaExtracao.length} exercício(s) gerado(s).`);
});

// Preview antes de salvar: renderiza a fórmula E mostra a conferência do código
// (✓ conferido / ⚠ corrigido) por exercício. O texto fica editável.
function renderListaPreview() {
  const container = document.getElementById('lista-preview');
  if (listaExtracao.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <h2 class="secao-titulo">Revise antes de salvar</h2>
    ${listaExtracao.map((e, i) => renderExercicioPreview(e, i)).join('')}
    <button type="button" class="btn btn-primary" id="lista-salvar-btn">Salvar lista</button>
  `;
  document.getElementById('lista-salvar-btn').addEventListener('click', salvarLista);
  wireMathPreviews(); // reaproveita o preview ao vivo do LaTeX (ia.js)
}

// Badge da conferência determinística de um exercício.
function badgeConferencia(exercicio) {
  const c = conferirVerificacao(exercicio.verificacao);
  if (!c.ok) return { html: '', respostaCodigo: null };
  const norm = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/[.$]/g, '');
  const bate = norm(c.resposta) === norm(exercicio.resposta);
  if (bate) {
    return {
      html: `<span class="conf-badge conf-ok">✓ conferido pelo código: ${esc(c.resposta)}</span>`,
      respostaCodigo: c.resposta,
    };
  }
  // divergência → o código é a fonte da verdade (híbrido); avisa a correção.
  return {
    html: `<span class="conf-badge conf-corr">⚠ a IA respondeu “${esc(exercicio.resposta ?? '—')}”, mas o código calculou <b>${esc(c.resposta)}</b> — usando o do código</span>`,
    respostaCodigo: c.resposta,
  };
}

function renderExercicioPreview(e, indice) {
  const conf = badgeConferencia(e);
  return `
    <div class="pergunta-card" data-idx="${indice}" data-tipo="exercicio">
      <label class="checkbox-label">
        <input type="checkbox" class="lista-incluir" checked /> Incluir este exercício
      </label>

      <label>Enunciado</label>
      <textarea class="lista-frente" data-campo="frente" rows="2">${esc(e.frente)}</textarea>
      <div class="ia-math-preview" data-preview="frente">${formatarTexto(e.frente || '', { math: true, compacto: true })}</div>

      <label>Resolução</label>
      <textarea class="lista-verso" data-campo="verso" rows="4">${esc(e.verso)}</textarea>
      <div class="ia-math-preview" data-preview="verso">${formatarTexto(e.verso || '', { math: true, compacto: true })}</div>

      <label>Resposta</label>
      <input type="text" class="lista-resposta" value="${esc(e.resposta || '')}" />
      ${conf.html ? `<div class="conf-linha">${conf.html}</div>` : ''}
    </div>
  `;
}

// Salva a lista: cria a `lista`, depois os exercícios (pergunta tipo 'exercicio'
// + revisão SM-2 + linha em `exercicios`). Onde o código conferiu, a
// resposta_esperada é a do CÓDIGO (fonte da verdade); senão, a da IA.
async function salvarLista() {
  const nome = document.getElementById('lista-nome').value.trim();
  if (!nome) { toast('Dê um nome à lista.', 'error'); return; }

  const cards = [...document.querySelectorAll('#lista-preview .pergunta-card')]
    .filter((c) => c.querySelector('.lista-incluir').checked)
    .map((c, ordem) => {
      const idx = Number(c.dataset.idx);
      const base = listaExtracao[idx];
      const frente = c.querySelector('.lista-frente').value.trim();
      const verso = c.querySelector('.lista-verso').value.trim();
      const respostaIA = c.querySelector('.lista-resposta').value.trim();
      // conferência: usa a resposta do código quando ele consegue calcular.
      const cconf = conferirVerificacao(base.verificacao);
      const resposta = cconf.ok ? cconf.resposta : respostaIA;
      return {
        frente, verso, resposta,
        dificuldade: base.dificuldade, verificacao: base.verificacao, ordem,
      };
    })
    .filter((e) => e.frente);

  if (cards.length === 0) { toast('Nenhum exercício selecionado.', 'error'); return; }

  const btn = document.getElementById('lista-salvar-btn');
  btn.disabled = true;

  try {
    // 1) a lista
    const { data: lista, error: e1 } = await sb
      .from('listas')
      .insert({ materia_id: Estado.materiaId, nome })
      .select('id')
      .single();
    if (e1) throw new Error(e1.message);

    const subdivisaoId = await garantirSubdivisao(Estado.materiaId, 'Geral');

    // 2) as perguntas (tipo exercicio), em lote — a ordem volta preservada.
    const { data: perguntas, error: e2 } = await sb
      .from('perguntas')
      .insert(cards.map((e) => ({
        subdivisao_id: subdivisaoId, tipo: 'exercicio', lista_id: lista.id,
        enunciado: e.frente, verso: e.verso, dificuldade: e.dificuldade, origem: 'llm',
      })))
      .select('id');
    if (e2) throw new Error(e2.message);

    // 3) revisão (SM-2) e dados de exercício, em lote
    const revs = perguntas.map((p) => ({ pergunta_id: p.id }));
    const { error: e3 } = await sb.from('revisoes_perguntas').insert(revs);
    if (e3) throw new Error(e3.message);

    const exs = perguntas.map((p, i) => ({
      pergunta_id: p.id,
      resposta_esperada: cards[i].resposta || null,
      verificacao: cards[i].verificacao,
      ordem: cards[i].ordem,
    }));
    const { error: e4 } = await sb.from('exercicios').insert(exs);
    if (e4) throw new Error(e4.message);

    toast(`Lista "${nome}" salva com ${cards.length} exercício(s).`);
    listaExtracao = [];
    document.getElementById('lista-preview').innerHTML = '';
    document.getElementById('lista-nome').value = '';
    document.getElementById('lista-texto').value = '';
    await carregarListas();
  } catch (erro) {
    toast(erro.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
