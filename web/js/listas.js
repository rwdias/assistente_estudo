// Listas de exercícios — a 3ª categoria de estudo (só em matéria matemática).
// Fluxo: colar exercícios → a IA monta (enunciado + resolução + resposta +
// verificação) → o CÓDIGO confere as respostas calculáveis (Calc/Logica via
// conferir.js) no preview → salvar como uma lista de exercícios.
// O "resolver a lista" (percorrer e responder) fica no Aprendizado/próximo passo.

let listaExtracao = []; // exercícios extraídos, aguardando salvar

// Abre o painel: volta para a home (criar + minhas listas), limpa o formulário
// e recarrega as listas existentes da matéria.
async function aoAbrirListas() {
  listaExtracao = [];
  mostrarListasHome();
  document.getElementById('lista-preview').innerHTML = '';
  const nome = document.getElementById('lista-nome');
  const texto = document.getElementById('lista-texto');
  if (nome) nome.value = '';
  if (texto) texto.value = '';
  await carregarListas();
}

// Alterna entre a home (criar/minhas listas) e a sub-view de estudo.
function mostrarListasHome() {
  document.getElementById('listas-home').style.display = '';
  document.getElementById('lista-estudo').style.display = 'none';
}
function mostrarListaEstudo() {
  document.getElementById('listas-home').style.display = 'none';
  document.getElementById('lista-estudo').style.display = '';
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

  const ICONE_ESTUDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polyline points="9 18 15 12 9 6"/></svg>';
  alvo.innerHTML = data
    .map((l) => `
      <button type="button" class="pergunta-card lista-card" data-lista-id="${l.id}" data-lista-nome="${esc(l.nome)}"
              style="display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; text-align:left; cursor:pointer">
        <span>
          <span class="pergunta-enunciado">${esc(l.nome)}</span>
          <span class="pergunta-meta"><span>${l.perguntas?.[0]?.count ?? 0} exercício(s)</span></span>
        </span>
        <span class="lista-card-estudar">Estudar ${ICONE_ESTUDAR}</span>
      </button>`)
    .join('');

  // Cada lista abre o modo de estudo (resolver no papel → revelar → auto-avaliar).
  alvo.querySelectorAll('.lista-card').forEach((el) => {
    el.addEventListener('click', () =>
      abrirEstudoLista(Number(el.dataset.listaId), el.dataset.listaNome));
  });
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
    frente: e.frente, verso: e.verso,
    dificuldade: e.dificuldade || 'Média', topico: e.topico || null,
    verificacoes: Array.isArray(e.verificacoes) ? e.verificacoes : [],
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

// Conferência por SUBITEM da questão (a, b, c…): mostra ✓ conferido / ⚠ corrigido
// / — sem check. Devolve o HTML das linhas.
function htmlConferencia(exercicio) {
  const linhas = conferirLista(exercicio.verificacoes).map((r) => {
    if (!r.ok) return ''; // subitem não calculável: sem badge (evita alarme falso)
    if (r.bate) {
      return `<div class="conf-linha"><span class="conf-badge conf-ok">${esc(r.rotulo)}) ✓ conferido: ${esc(r.respostaCodigo)}</span></div>`;
    }
    return `<div class="conf-linha"><span class="conf-badge conf-corr">${esc(r.rotulo)}) ⚠ IA disse “${esc(r.respostaIA ?? '—')}”, código calcula <b>${esc(r.respostaCodigo)}</b></span></div>`;
  });
  return linhas.join('');
}

function renderExercicioPreview(e, indice) {
  return `
    <div class="pergunta-card" data-idx="${indice}" data-tipo="exercicio">
      <label class="checkbox-label">
        <input type="checkbox" class="lista-incluir" checked /> Incluir esta questão
      </label>

      <label>Enunciado (questão inteira)</label>
      <textarea class="lista-frente" data-campo="frente" rows="3">${esc(e.frente)}</textarea>
      <div class="ia-math-preview" data-preview="frente">${formatarTexto(e.frente || '', { math: true, compacto: true })}</div>

      <label>Resolução</label>
      <textarea class="lista-verso" data-campo="verso" rows="5">${esc(e.verso)}</textarea>
      <div class="ia-math-preview" data-preview="verso">${formatarTexto(e.verso || '', { math: true, compacto: true })}</div>

      ${htmlConferencia(e)}
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
      // Gabarito compilado por subitem: usa a resposta do CÓDIGO onde ele
      // consegue calcular (fonte da verdade), senão a da IA. Ex.: "a) F; b) V".
      const conf = conferirLista(base.verificacoes);
      const resposta = conf
        .map((r) => `${r.rotulo}) ${r.ok ? r.respostaCodigo : (r.respostaIA ?? '—')}`)
        .join('; ');
      return {
        frente, verso, resposta,
        dificuldade: base.dificuldade, verificacoes: base.verificacoes, ordem,
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
      // guarda a lista de verificações por subitem (jsonb), p/ reconferir e
      // mostrar no estudo. A coluna aceita objeto → embrulha num { itens }.
      verificacao: { itens: cards[i].verificacoes },
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

// ===========================================================================
// Modo de estudo "resolver a lista": ver o enunciado inteiro, resolver no
// papel, revelar a resolução + a CONFERÊNCIA do código por subitem e se
// auto-avaliar em 4 níveis (mesmo SM-2 do flashcard, via registrar_resposta).
// Errar ("De novo") devolve o exercício ao fim da fila da sessão, como no Anki.
// ===========================================================================
let estudoFila = [];
let estudoIndice = 0;
let estudoAcertos = 0;
let estudoErros = 0;
let estudoListaNome = '';
let estudoReaprendendoIds = new Set();

// Abre uma lista para estudo: busca os exercícios (enunciado + resolução +
// verificação + estado SM-2) e monta a fila na ordem da lista.
async function abrirEstudoLista(listaId, nome) {
  estudoListaNome = nome || 'Lista';
  estudoIndice = 0;
  estudoAcertos = 0;
  estudoErros = 0;
  estudoReaprendendoIds = new Set();

  mostrarListaEstudo();
  document.getElementById('lista-estudo-titulo').textContent = estudoListaNome;
  document.getElementById('lista-estudo-resumo').innerHTML = '';
  document.getElementById('lista-estudo-atual').innerHTML = '<p>Carregando...</p>';

  // Traz pergunta (enunciado/verso) + dados do exercício (gabarito/verificação)
  // + estado SM-2 (para prever os prazos dos botões). Ordena pela ordem da lista.
  const { data, error } = await sb
    .from('perguntas')
    .select('id, enunciado, verso, exercicios ( resposta_esperada, verificacao, ordem ), revisoes_perguntas ( intervalo_dias, fator_facilidade )')
    .eq('lista_id', listaId)
    .eq('tipo', 'exercicio');

  if (error) { toast(error.message, 'error'); return; }

  estudoFila = (data || [])
    .map((p) => {
      // exercicios/revisoes_perguntas são 1:1 com a pergunta → o PostgREST
      // devolve OBJETO (não array). Normaliza para os dois formatos por segurança.
      const ex = (Array.isArray(p.exercicios) ? p.exercicios[0] : p.exercicios) || {};
      const rev = (Array.isArray(p.revisoes_perguntas) ? p.revisoes_perguntas[0] : p.revisoes_perguntas) || {};
      return {
        id: p.id,
        enunciado: p.enunciado,
        verso: p.verso || '',
        resposta_esperada: ex.resposta_esperada || '',
        itens: Array.isArray(ex.verificacao?.itens) ? ex.verificacao.itens : [],
        ordem: ex.ordem ?? 0,
        intervalo_dias: rev.intervalo_dias ?? 0,
        fator_facilidade: rev.fator_facilidade ?? 250,
      };
    })
    .sort((a, b) => a.ordem - b.ordem);

  renderEstudoAtual();
}

function renderEstudoResumo() {
  const restantes = estudoFila.length - estudoIndice;
  document.getElementById('lista-estudo-resumo').innerHTML = `
    <div class="stat-card">
      <div class="stat-valor brand">${restantes < 0 ? 0 : restantes}</div>
      <div class="stat-rotulo">restantes</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor">${estudoAcertos}</div>
      <div class="stat-rotulo">acertos</div>
    </div>
    <div class="stat-card">
      <div class="stat-valor ${estudoErros > 0 ? 'alerta' : ''}">${estudoErros}</div>
      <div class="stat-rotulo">erros</div>
    </div>
  `;
}

// Conferência do código por subitem na tela de estudo (mesma leitura do preview):
// ✓ conferido (bate) / ⚠ corrigido (IA errou, código calcula) / — sem check.
function htmlConferenciaEstudo(itens) {
  const linhas = conferirLista(itens).map((r) => {
    if (!r.ok) return '';
    if (r.bate) {
      return `<div class="conf-linha"><span class="conf-badge conf-ok">${esc(r.rotulo)}) ✓ conferido: ${esc(r.respostaCodigo)}</span></div>`;
    }
    return `<div class="conf-linha"><span class="conf-badge conf-corr">${esc(r.rotulo)}) ⚠ código calcula <b>${esc(r.respostaCodigo)}</b></span></div>`;
  });
  return linhas.join('');
}

function renderEstudoAtual() {
  renderEstudoResumo();
  const container = document.getElementById('lista-estudo-atual');

  const ICONE_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.1V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

  if (estudoIndice >= estudoFila.length) {
    container.innerHTML = estudoFila.length === 0
      ? '<p class="fim-sessao">Esta lista ainda não tem exercícios.</p>'
      : `<p class="fim-sessao">${ICONE_OK} Lista concluída — ${estudoAcertos} acerto(s), ${estudoErros} erro(s).</p>`;
    return;
  }

  const ex = estudoFila[estudoIndice];
  const mat = materiaEhMatematica();
  const previsao = preverIntervalos(ex.intervalo_dias, ex.fator_facilidade);

  const botao = (qualidade, rotulo, classe, atalho) => `
    <div class="fc-opcao">
      <span class="fc-prazo">${esc(formatarIntervalo(previsao[qualidade]))}</span>
      <button type="button" class="btn ${classe}" data-qualidade="${qualidade}">
        ${esc(rotulo)}<span class="fc-atalho">${atalho}</span>
      </button>
    </div>
  `;

  // Gabarito curto (compilado no salvar): mostrado junto da resolução ao revelar.
  const gabaritoHTML = ex.resposta_esperada
    ? `<div class="lista-gabarito"><b>Gabarito:</b> ${formatarTexto(ex.resposta_esperada, { compacto: true, math: mat })}</div>`
    : '';
  const confHTML = htmlConferenciaEstudo(ex.itens);

  container.innerHTML = `
    <div class="question-card">
      <span class="fc-rotulo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11H3v10h6M9 11V3h6v18M9 11h6m6 0h-6v10h6V11Z"/></svg>
        Exercício ${estudoIndice + 1} de ${estudoFila.length}
      </span>
      <div class="question-title">${formatarTexto(ex.enunciado, { compacto: true, math: mat })}</div>
      <div class="fc-verso" id="lista-verso-estudo" style="display:none">
        ${formatarTexto(ex.verso, { compacto: true, math: mat })}
        ${gabaritoHTML}
        ${confHTML}
      </div>
      <div class="fc-acoes">
        <button type="button" class="btn btn-primary" id="lista-mostrar-btn">Mostrar resolução</button>
      </div>
      <div class="fc-avaliacao" id="lista-avaliacao" style="display:none">
        ${botao(QUALIDADE.DE_NOVO, 'De novo', 'btn-danger', '1')}
        ${botao(QUALIDADE.DIFICIL, 'Difícil', 'btn-secondary', '2')}
        ${botao(QUALIDADE.BOM, 'Bom', 'btn-primary', '3')}
        ${botao(QUALIDADE.FACIL, 'Fácil', 'btn-secondary', '4')}
      </div>
    </div>
  `;

  document.getElementById('lista-mostrar-btn').addEventListener('click', () => {
    document.getElementById('lista-verso-estudo').style.display = 'block';
    document.getElementById('lista-mostrar-btn').style.display = 'none';
    document.getElementById('lista-avaliacao').style.display = 'flex';
  });

  container.querySelectorAll('#lista-avaliacao [data-qualidade]').forEach((btn) => {
    btn.addEventListener('click', () => avaliarExercicio(ex, Number(btn.dataset.qualidade)));
  });
}

// Auto-avaliação de um exercício: 3/4/5 = acerto, 2 (De novo) = erro (reenfileira
// na sessão). Grava no mesmo SM-2 das perguntas/flashcards (registrar_resposta).
function avaliarExercicio(ex, qualidade) {
  const correta = qualidade >= QUALIDADE.DIFICIL;
  document.getElementById('lista-avaliacao').style.display = 'none';

  if (correta) {
    estudoAcertos += 1;
    estudoReaprendendoIds.delete(Number(ex.id));
  } else {
    estudoErros += 1;
    estudoReaprendendoIds.add(Number(ex.id));
    estudoFila.push({ ...ex }); // volta ao fim da fila até ser acertado
  }

  sb.rpc('registrar_resposta', {
    p_pergunta_id: ex.id,
    p_correta: correta,
    p_qualidade: qualidade,
  }).then(({ error }) => { if (error) toast(error.message, 'error'); });

  estudoIndice += 1;
  renderEstudoAtual();
}

// "Voltar às listas" fecha o estudo e recarrega a home.
document.getElementById('lista-estudo-voltar')?.addEventListener('click', async () => {
  mostrarListasHome();
  await carregarListas();
});
