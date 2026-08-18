// --- cliente Supabase + estado global ---
const sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

const Estado = {
  materiaId: localStorage.getItem('materiaId') ? Number(localStorage.getItem('materiaId')) : null,
  materias: [],
};

function definirMateriaAtual(id) {
  Estado.materiaId = id;
  if (id) localStorage.setItem('materiaId', id);
  else localStorage.removeItem('materiaId');
}

// --- domínio: SRS (exibição) ---
// Porta de src/srs.py: dificuldade pessoal e maturidade são derivadas do
// histórico salvo em revisoes_perguntas; o SM-2 em si roda no banco
// (função registrar_resposta).
const MATURIDADE_DIAS = 21;
const TAXA_ACERTO_FACIL = 0.75;
const TAXA_ACERTO_MEDIA = 0.4;
// Acertos consecutivos a partir dos quais a pergunta vira candidata a ganhar
// versões reformuladas: acertou 3 vezes seguidas = o formato já é conhecido.
const ACERTOS_PARA_VARIAR = 3;

function dificuldadePessoal(estatica, vezesRespondida, vezesAcertada, ultimaCorreta) {
  if (!vezesRespondida) return estatica;
  if (ultimaCorreta === false) return 'Difícil';
  const taxa = vezesAcertada / vezesRespondida;
  if (taxa >= TAXA_ACERTO_FACIL) return 'Fácil';
  if (taxa >= TAXA_ACERTO_MEDIA) return 'Média';
  return 'Difícil';
}

// --- embaralhamento das alternativas ---
// A correta ficava numa posição FIXA para sempre em cada pergunta, então
// bastava decorar "é a terceira". O embaralhamento usa semente derivada de
// (id, vezes_respondida): a ordem é estável dentro da mesma tentativa
// (sobrevive a reload e ao "Voltar" do flashcard) e muda a cada resposta.

// PRNG determinístico (mulberry32): mesma semente, mesma ordem.
function geradorAleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Alternativas que se referem à POSIÇÃO das outras ("todas as anteriores",
// "apenas I e II", "as alternativas A e C") perdem o sentido embaralhadas —
// nesses casos a ordem original da prova é preservada.
const RE_OPCAO_POSICIONAL = new RegExp(
  [
    '\\b(todas|nenhuma|ambas)\\s+(as|das|os|dos)\\s+(alternativas?|op[çc][õo]es|anteriores|afirma[çc][õo]es|assertivas?|senten[çc]as?)',
    '\\banteriores?\\b',
    '\\b(acima|abaixo)\\b',
    '\\balternativas?\\s+[a-e]\\b',
    '\\bapenas\\s+[ivx]+\\b',
    '\\b[ivx]+\\s*(,|\\se\\s)\\s*[ivx]+\\b',
    '\\bn\\.?\\s?d\\.?\\s?a\\b',
  ].join('|'),
  'i',
);

function embaralharOpcoes(opcoes, semente) {
  if (opcoes.length < 2) return opcoes;
  if (opcoes.some((o) => RE_OPCAO_POSICIONAL.test(o.texto || ''))) return opcoes;

  const sortear = geradorAleatorio(semente);
  const lista = opcoes.slice();
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(sortear() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

// Converte a linha aninhada do PostgREST para o formato que a UI consome.
function normalizarPergunta(linha) {
  const rev = Array.isArray(linha.revisoes_perguntas)
    ? linha.revisoes_perguntas[0]
    : linha.revisoes_perguntas;

  const vezesRespondida = rev?.vezes_respondida ?? 0;
  const vezesAcertada = rev?.vezes_acertada ?? 0;
  const opcoes = embaralharOpcoes(
    (linha.opcoes || []).slice().sort((a, b) => a.ordem - b.ordem),
    Number(linha.id) * 97 + vezesRespondida,
  );

  const variantes = (linha.pergunta_variantes || []).filter((v) => !v.descartada);
  const acertosSeguidos = rev?.acertos_seguidos ?? 0;
  const madura = (rev?.intervalo_dias ?? 0) >= MATURIDADE_DIAS;
  const tipo = linha.tipo || 'pergunta';

  return {
    id: linha.id,
    tipo,
    topico: linha.subdivisoes?.nome && linha.subdivisoes.nome !== 'Geral'
      ? linha.subdivisoes.nome
      : null,
    enunciado: linha.enunciado,
    verso: linha.verso,
    imagens: linha.imagens || [],
    imagens_posicao: linha.imagens_posicao || 'depois',
    saber_mais: Array.isArray(linha.saber_mais) ? linha.saber_mais : [],
    dificuldade: linha.dificuldade,
    origem: linha.origem,
    opcoes,
    variantes,
    vezes_respondida: vezesRespondida,
    vezes_acertada: vezesAcertada,
    acertos_seguidos: acertosSeguidos,
    madura,
    // Pronta para ganhar versões: já dominada e ainda sem nenhuma variante.
    // Flashcard fica de fora (o recall ali já é ativo por natureza).
    pode_variar:
      tipo === 'pergunta' &&
      variantes.length === 0 &&
      (acertosSeguidos >= ACERTOS_PARA_VARIAR || madura),
    dificuldade_pessoal: dificuldadePessoal(
      linha.dificuldade, vezesRespondida, vezesAcertada,
      rev?.ultima_resposta_correta ?? null,
    ),
    proxima_revisao_em: rev?.proxima_revisao_em ?? null,
  };
}

// Rotação de apresentações: o original e as variantes ativas se revezam a
// cada resposta — `vezes_respondida % (1 + nº de variantes)`. É determinístico
// de propósito: a mesma tentativa mostra sempre a mesma versão (sobrevive a
// reload e ao "Voltar"), e a revisão seguinte cai na próxima versão. O
// original nunca sai da roleta — em questão de prova a redação da banca é o
// que você vai encontrar no exame.
function aplicarVariante(pergunta) {
  const ativas = pergunta.variantes || [];
  if (ativas.length === 0) return pergunta;

  const indice = pergunta.vezes_respondida % (ativas.length + 1);
  if (indice === 0) return pergunta;

  const variante = ativas[indice - 1];
  return {
    ...pergunta,
    enunciado: variante.enunciado,
    opcoes: embaralharOpcoes(
      variante.opcoes || [],
      Number(variante.id) * 97 + pergunta.vezes_respondida,
    ),
    variante_id: variante.id,
    // guarda a versão original desta rodada: se o usuário descartar a
    // variante, dá para voltar a ela sem remontar a fila (o que faria ele
    // perder o lugar na sessão).
    original: { enunciado: pergunta.enunciado, opcoes: pergunta.opcoes },
  };
}

const SELECT_PERGUNTA = `
  id, tipo, enunciado, verso, dificuldade, origem, imagens, imagens_posicao, saber_mais, created_at,
  opcoes ( texto, correta, ordem ),
  pergunta_variantes ( id, enunciado, opcoes, descartada ),
  revisoes_perguntas ( vezes_respondida, vezes_acertada, ultima_resposta_correta,
                       intervalo_dias, proxima_revisao_em, acertos_seguidos ),
  subdivisoes!inner ( materia_id, nome )
`;

async function listarTopicos(materiaId) {
  const { data, error } = await sb
    .from('subdivisoes')
    .select('id, nome, perguntas ( count )')
    .eq('materia_id', materiaId)
    .order('nome');

  if (error) throw new Error(error.message);
  return data.map((s) => ({
    id: s.id,
    nome: s.nome,
    itens: s.perguntas?.[0]?.count ?? 0,
  }));
}

async function buscarPerguntasDaMateria(materiaId) {
  const { data, error } = await sb
    .from('perguntas')
    .select(SELECT_PERGUNTA)
    .eq('subdivisoes.materia_id', materiaId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data.map(normalizarPergunta);
}

async function garantirSubdivisao(materiaId, nome) {
  const nomeLimpo = (nome || 'Geral').trim() || 'Geral';

  const { data: existente, error: erroBusca } = await sb
    .from('subdivisoes')
    .select('id')
    .eq('materia_id', materiaId)
    .eq('nome', nomeLimpo)
    .maybeSingle();

  if (erroBusca) throw new Error(erroBusca.message);
  if (existente) return existente.id;

  const { data: criada, error: erroInsert } = await sb
    .from('subdivisoes')
    .insert({ materia_id: materiaId, nome: nomeLimpo })
    .select('id')
    .single();

  if (erroInsert) throw new Error(erroInsert.message);
  return criada.id;
}

// Mensagem de erro amigável para invocações de Edge Function.
async function mensagemErroFuncao(error) {
  try {
    const corpo = await error.context.json();
    if (corpo?.erro) return corpo.erro;
  } catch (_) { /* resposta sem JSON */ }
  return 'Falha ao chamar a IA. Tente novamente.';
}

// --- navegação entre panels (SPA sem router) ---
const panelMeta = {
  revisao: { titulo: 'Aprendizado', sub: 'Aprenda o que é novo e revise o que está devido — repetição espaçada' },
  dashboard: { titulo: 'Início', sub: 'Visão geral do seu estudo' },
  simulado: { titulo: 'Simulado', sub: 'Pratique com suas matérias ou monte pelo banco de questões' },
  perguntas: { titulo: 'Perguntas', sub: 'Cadastre e gerencie o banco de questões' },
  ia: { titulo: 'Adicionar via IA', sub: 'Cole questões e deixe a IA estruturar tudo' },
};

function goPanel(id, sbItem) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach((i) => i.classList.remove('active'));

  document.getElementById('panel-' + id)?.classList.add('active');
  // Quando há mais de um item para o mesmo painel (ex.: as duas entradas de
  // IA), destaca o realmente clicado; senão, cai no primeiro do painel.
  (sbItem || document.querySelector(`.sb-item[data-panel="${id}"]`))?.classList.add('active');

  const meta = panelMeta[id] || { titulo: id, sub: '' };
  document.getElementById('topbar-title').textContent = meta.titulo;
  document.getElementById('topbar-sub').textContent = meta.sub;

  if (id === 'dashboard') carregarDashboard();
  if (id === 'perguntas') aoAbrirPerguntas();
  if (id === 'revisao') carregarRevisao();
  if (id === 'ia') aoAbrirIa();

  window.scrollTo(0, 0);
}

document.querySelectorAll('.sb-item').forEach((item) => {
  item.addEventListener('click', () => {
    // Entradas de IA carregam o modo desejado (perguntas x flashcards);
    // fixá-lo antes de abrir evita herdar o modo do último uso.
    if (item.dataset.modoIa) definirModoIa(item.dataset.modoIa);
    goPanel(item.dataset.panel, item);
  });
});

// --- toast ---
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// --- modal ---
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
});
// Botões "Cancelar" dos modais (sem onclick inline, bloqueado pela CSP).
document.querySelectorAll('[data-fechar-modal]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.fecharModal));
});

// --- renderização compartilhada de uma pergunta em modo quiz ---
const LETRAS = 'ABCDEFGH';

// Imagens fazem parte da pergunta (provas do catálogo). Só renderiza URLs
// do Storage do projeto — qualquer outra origem é descartada (e a CSP
// bloquearia de toda forma).
function renderImagensPergunta(pergunta) {
  const seguras = (pergunta.imagens || []).filter((u) =>
    typeof u === 'string' && u.startsWith(`${SUPABASE_CONFIG.url}/storage/v1/object/public/`)
  );
  if (seguras.length === 0) return '';
  return `<div class="pergunta-imagens">${seguras
    .map((u) => `<img src="${esc(u)}" alt="Figura da questão" loading="lazy" />`)
    .join('')}</div>`;
}

// Formatação SEGURA de enunciados/versos (Markdown restrito, válido para
// qualquer fonte de prova): tabelas (linhas "| a | b |"), citações (linhas
// iniciadas por "> "), ênfase inline (*...* / **...**) e referências.
// O texto é SEMPRE escapado antes — nenhuma tag vinda do dado sobrevive.
function formatarTexto(texto, opcoes = {}) {
  const compacto = Boolean(opcoes.compacto);
  const linhas = esc(texto ?? '').split('\n');
  const html = [];
  let tabela = [];
  let citacao = [];
  let paragrafo = [];

  const fecharTabela = () => {
    if (tabela.length === 0) return;
    const celulas = tabela.map((l) =>
      l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
    const corpo = celulas.filter((cels) => !cels.every((c) => /^:?-{2,}:?$/.test(c)));
    if (corpo.length > 0) {
      const [cab, ...resto] = corpo;
      html.push(
        '<div class="tabela-scroll"><table class="tabela-enunciado"><thead><tr>' +
        cab.map((c) => `<th>${c}</th>`).join('') +
        '</tr></thead><tbody>' +
        resto.map((cels) => '<tr>' + cels.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      );
    }
    tabela = [];
  };
  const fecharCitacao = () => {
    if (citacao.length === 0) return;
    html.push(`<blockquote class="citacao-enunciado">${citacao.join('<br>')}</blockquote>`);
    citacao = [];
  };
  const fecharParagrafo = () => {
    if (paragrafo.length === 0) return;
    html.push(`${compacto ? paragrafo.join(' ') : paragrafo.join('<br>')}<br>`);
    paragrafo = [];
  };
  const fonteMarcada = (t) =>
    /^\*[^*]{6,240}?(?:\b\d{4}\b|Disponível em|Adaptado de|Fonte:)[^*]*\*$/.test(t);
  const fonteEntreParenteses = (t) =>
    /^\([^()<]{6,240}?(?:\b\d{4}\b|Disponível em)[^()<]*?\)$/.test(t);

  for (const linha of linhas) {
    const t = linha.trim();
    if (/^\|.*\|$/.test(t)) { fecharParagrafo(); fecharCitacao(); tabela.push(t); continue; }
    fecharTabela();
    if (t.startsWith('&gt;')) { fecharParagrafo(); citacao.push(t.replace(/^&gt;\s?/, '')); continue; }
    fecharCitacao();
    if (fonteMarcada(t)) {
      fecharParagrafo();
      html.push(`<em class="fonte-enunciado">${t.slice(1, -1)}</em>`);
      continue;
    }
    if (fonteEntreParenteses(t)) {
      fecharParagrafo();
      html.push(`<em class="fonte-enunciado">${t}</em>`);
      continue;
    }
    if (t === '') {
      fecharParagrafo();
      html.push('<span class="quebra"></span>');
    } else if (compacto) {
      paragrafo.push(t);
    } else {
      html.push(`${t}<br>`);
    }
  }
  fecharParagrafo();
  fecharTabela();
  fecharCitacao();

  const saida = html.join('');
  if (compacto) {
    return saida
      // negrito inline marcado com **...**
      .replace(/\*\*([^*]{2,240}?)\*\*/g, '<strong>$1</strong>')
      // fonte explícita marcada com *...* em linha própria
      .replace(/(?:^|<br>)\*([^*]{6,240}?(?:\b\d{4}\b|Disponível em|Adaptado de|Fonte:)[^*]*?)\*(?=<br>|$)/g,
        '<em class="fonte-enunciado">$1</em>')
      // ênfase inline comum
      .replace(/(^|[^*])\*([^*]{1,240}?)\*(?!\*)/g, '$1<em class="enfase-enunciado">$2</em>')
      // fonte entre parênteses que a IA não marcou (linha bibliográfica:
      // ano de 4 dígitos ou "Disponível em") — vira itálico discreto
      .replace(/(?:^|<br>)(\([^()<]{6,240}?(?:\b\d{4}\b|Disponível em)[^()<]*?\))(?=<br>|$)/g,
        '<em class="fonte-enunciado">$1</em>');
  }

  return saida
    // comportamento histórico de questões/simulados: *...* vira referência em bloco
    .replace(/\*([^*]{2,240}?)\*/g, '<em class="fonte-enunciado">$1</em>')
    .replace(/(?:^|<br>)(\([^()<]{6,240}?(?:\b\d{4}\b|Disponível em)[^()<]*?\))(?=<br>|$)/g,
      '<em class="fonte-enunciado">$1</em>');
}

// Chip com a origem da questão: nome da prova (banco de questões) ou da
// matéria atual — ex.: "ENEM 2023 — Ciências Humanas".
function renderOrigemQuiz(pergunta) {
  if (pergunta?.origem_nome) {
    return `<div class="question-origem">${esc(pergunta.origem_nome)}</div>`;
  }
  const materia = Estado.materias.find((m) => m.id === Estado.materiaId);
  return materia ? `<div class="question-origem">${esc(materia.nome)}</div>` : '';
}

// Questão de múltipla resposta: mais de uma alternativa correta (a IA de
// extração já marca todas as corretas quando o enunciado pede — ver
// promptExtracao). Nesse caso o clique só marca/desmarca; a resposta é
// avaliada de uma vez, ao confirmar.
function perguntaMultipla(pergunta) {
  return pergunta.opcoes.filter((o) => o.correta).length > 1;
}

function renderPerguntaQuizHTML(pergunta, chave) {
  const imagens = renderImagensPergunta(pergunta);
  const antes = pergunta.imagens_posicao === 'antes';
  const multipla = perguntaMultipla(pergunta);
  return `
    <div class="question-card" data-chave="${chave}" ${multipla ? 'data-multipla="1"' : ''}>
      ${renderOrigemQuiz(pergunta)}
      ${antes ? imagens : ''}
      <div class="question-title">${formatarTexto(pergunta.enunciado)}</div>
      ${antes ? '' : imagens}
      ${multipla ? '<p class="opcoes-multipla-aviso">Esta questão tem mais de uma alternativa correta — marque todas e confirme.</p>' : ''}
      <div class="opcoes-quiz">
        ${pergunta.opcoes
          .map(
            (o, idx) => `
            <div class="opcao-quiz" data-idx="${idx}">
              <span class="opcao-letra">${LETRAS[idx] || '?'}</span>
              <span>${esc(o.texto)}</span>
            </div>`
          )
          .join('')}
      </div>
      ${multipla ? '<button type="button" class="btn btn-primary btn-sm opcoes-confirmar-btn" disabled>Confirmar resposta</button>' : ''}
      <div class="saber-mais" data-saber-mais hidden></div>
    </div>
  `;
}

function wirePerguntaQuiz(pergunta, chave, aoResponder) {
  const card = document.querySelector(`.question-card[data-chave="${chave}"]`);
  if (!card) return;

  const opcoesEls = card.querySelectorAll('.opcao-quiz');
  const multipla = card.dataset.multipla === '1';

  async function finalizar(indicesEscolhidos) {
    card.dataset.respondida = '1';

    const escolhidos = new Set(indicesEscolhidos);
    const corretos = new Set(
      pergunta.opcoes.map((o, i) => (o.correta ? i : -1)).filter((i) => i !== -1)
    );
    const correta =
      escolhidos.size === corretos.size && [...corretos].every((i) => escolhidos.has(i));

    opcoesEls.forEach((el, idx) => {
      el.classList.add('desabilitada');
      const ehCorreta = pergunta.opcoes[idx].correta;
      if (ehCorreta) el.classList.add('correta');
      if (escolhidos.has(idx)) {
        el.classList.add('selecionada');
        if (!ehCorreta) el.classList.add('incorreta');
      }
    });

    montarSaberMais(card, pergunta);
    await aoResponder(correta);
  }

  if (multipla) {
    const btnConfirmar = card.querySelector('.opcoes-confirmar-btn');
    const escolhidos = new Set();

    opcoesEls.forEach((el, idx) => {
      el.addEventListener('click', () => {
        if (card.dataset.respondida) return;
        el.classList.toggle('selecionada');
        if (escolhidos.has(idx)) escolhidos.delete(idx);
        else escolhidos.add(idx);
        btnConfirmar.disabled = escolhidos.size === 0;
      });
    });

    btnConfirmar.addEventListener('click', () => {
      if (card.dataset.respondida) return;
      finalizar(escolhidos);
    });
    return;
  }

  opcoesEls.forEach((el, idx) => {
    el.addEventListener('click', () => {
      if (card.dataset.respondida) return;
      finalizar([idx]);
    });
  });
}

// --- "Saber mais": aprofundamento por IA com cache de até 3 complementos ---
// Modelo padrão das consultas de aprofundamento (não há seletor na tela de
// estudo). O texto é cacheado na própria pergunta (perguntas.saber_mais).
const SABER_MAIS_MAX = 3;
const SABER_MAIS_MODELO = 'ChatGPT';

// Questão do banco público (doBanco) não pertence à conta: não há onde
// cachear, então o recurso fica restrito aos itens do próprio usuário
// (perguntas E flashcards).
function podeSaberMais(pergunta) {
  return !pergunta.doBanco && pergunta.id != null;
}

// Preenche/atualiza o bloco de "Saber mais" do card já respondido: exibe os
// complementos cacheados como um texto contínuo (sem numeração) e, se houver
// menos de 3, o botão "Ainda não entendi" para pedir uma nova explicação que
// continua de onde a anterior parou.
function montarSaberMais(card, pergunta) {
  const bloco = card.querySelector('[data-saber-mais]');
  if (!bloco || !podeSaberMais(pergunta)) return;

  const complementos = pergunta.saber_mais || [];
  const restantes = SABER_MAIS_MAX - complementos.length;

  bloco.hidden = false;
  bloco.innerHTML = `
    ${complementos.length
      ? `<div class="saber-mais-item">
           ${complementos
             .map((t) => `<div class="saber-mais-texto">${formatarTexto(t, { compacto: true })}</div>`)
             .join('')}
         </div>`
      : ''}
    ${
      restantes > 0
        ? `<button type="button" class="btn btn-secondary btn-sm saber-mais-btn">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
             ${complementos.length === 0 ? 'Saber mais' : 'Ainda não entendi'}
           </button>`
        : ''
    }
  `;

  const btn = bloco.querySelector('.saber-mais-btn');
  if (btn) btn.addEventListener('click', () => pedirSaberMais(card, pergunta, btn));
}

async function pedirSaberMais(card, pergunta, btn) {
  const conteudoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Consultando IA...';

  try {
    // Flashcard manda frente/verso; pergunta manda enunciado/opções.
    const corpoPergunta = pergunta.tipo === 'flashcard'
      ? { enunciado: pergunta.enunciado, verso: pergunta.verso || '' }
      : {
          enunciado: pergunta.enunciado,
          opcoes: (pergunta.opcoes || []).map((o) => ({ texto: o.texto, correta: o.correta })),
        };

    const { data, error } = await sb.functions.invoke('saber_mais', {
      body: {
        modelo: SABER_MAIS_MODELO,
        pergunta: corpoPergunta,
        anteriores: pergunta.saber_mais || [],
      },
    });

    if (error) {
      toast(await mensagemErroFuncao(error), 'error');
      btn.disabled = false;
      btn.innerHTML = conteudoOriginal;
      return;
    }

    // Persiste na pergunta (RLS do dono + teto de 3 na função SQL) e recebe o
    // array atualizado, fonte de verdade do cache.
    const { data: novo, error: erroPersist } = await sb.rpc('adicionar_saber_mais', {
      p_pergunta_id: pergunta.id,
      p_texto: data.saber_mais,
    });

    if (erroPersist) {
      toast(erroPersist.message, 'error');
      btn.disabled = false;
      btn.innerHTML = conteudoOriginal;
      return;
    }

    pergunta.saber_mais = Array.isArray(novo) ? novo : [...(pergunta.saber_mais || []), data.saber_mais];
    montarSaberMais(card, pergunta);
  } catch (erro) {
    toast(erro.message || 'Falha ao consultar a IA.', 'error');
    btn.disabled = false;
    btn.innerHTML = conteudoOriginal;
  }
}

// --- tema claro/escuro ---
function temaEfetivo() {
  const manual = document.documentElement.dataset.theme;
  if (manual) return manual;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function atualizarIconesTema() {
  const escuro = temaEfetivo() === 'dark';
  document.querySelectorAll('.tema-toggle').forEach((btn) => {
    btn.querySelector('.icone-lua').style.display = escuro ? 'none' : 'block';
    btn.querySelector('.icone-sol').style.display = escuro ? 'block' : 'none';
  });
}

function alternarTema() {
  const novo = temaEfetivo() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = novo;
  localStorage.setItem('tema', novo);
  atualizarIconesTema();
}

function aplicarTemaSalvo() {
  const salvo = localStorage.getItem('tema');
  if (salvo === 'light' || salvo === 'dark') {
    document.documentElement.dataset.theme = salvo;
  }
  atualizarIconesTema();
}

document.querySelectorAll('.tema-toggle').forEach((btn) => {
  btn.addEventListener('click', alternarTema);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', atualizarIconesTema);
aplicarTemaSalvo();

// --- sidebar: fixar/recolher (rail expande no hover) ---
(function initSidebarPin() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-pin-btn');
  if (!sidebar || !btn) return;

  if (localStorage.getItem('sidebarFixa') === '1') sidebar.classList.add('pinned');

  btn.addEventListener('click', () => {
    const fixa = sidebar.classList.toggle('pinned');
    localStorage.setItem('sidebarFixa', fixa ? '1' : '0');
  });
})();

// --- escape para innerHTML (obrigatório em todo dado dinâmico) ---
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

// Visitante sem sessão cai na landing; login/cadastro ficam em
// mostrarAuth(painel), acionado pelos CTAs da landing.
function mostrarTelaAuth() {
  document.getElementById('landing').style.display = 'block';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'none';
}

function mostrarAuth(painel) {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  const cadastro = painel === 'cadastro';
  document.getElementById('auth-panel-login').style.display = cadastro ? 'none' : 'block';
  document.getElementById('auth-panel-cadastro').style.display = cadastro ? 'block' : 'none';
}

function mostrarApp() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}
