// --- cliente Supabase + estado global ---
const sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

const Estado = {
  materiaId: localStorage.getItem('materiaId') ? Number(localStorage.getItem('materiaId')) : null,
  materias: [],
  trilhas: [], // agrupam matérias do mesmo contexto (curso/certificação/concurso)
};

function definirMateriaAtual(id) {
  Estado.materiaId = id;
  if (id) localStorage.setItem('materiaId', id);
  else localStorage.removeItem('materiaId');
}

// A matéria (atual, por padrão) é do tipo matemática? É o que liga o modo math
// — renderizar fórmula em LaTeX, formulários específicos etc. Matéria normal
// (ou tipo ainda não carregado) devolve false, então nada muda no fluxo normal.
// `tipo` vem de resumo_materias (0021).
function materiaEhMatematica(id = Estado.materiaId) {
  return Estado.materias.find((m) => m.id === id)?.tipo === 'matematica';
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
    // "Ocultar da revisão": item existe mas some da fila de estudo/simulado
    // (fica na lista de Perguntas, com badge, e pode ser reexibido).
    oculta: linha.oculta ?? false,
    // saber_mais NÃO vem no carregamento: quem decide cache-ou-IA é a Edge
    // Function, sob demanda (o conteúdo salvo não fica exposto na página).
    dificuldade: linha.dificuldade,
    origem: linha.origem,
    opcoes,
    variantes,
    intervalo_dias: rev?.intervalo_dias ?? 0,
    fator_facilidade: rev?.fator_facilidade ?? 250,
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
  id, tipo, enunciado, verso, dificuldade, origem, imagens, imagens_posicao, oculta, created_at,
  opcoes ( texto, correta, ordem ),
  pergunta_variantes ( id, enunciado, opcoes, descartada ),
  revisoes_perguntas ( vezes_respondida, vezes_acertada, ultima_resposta_correta,
                       intervalo_dias, fator_facilidade, proxima_revisao_em,
                       acertos_seguidos ),
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

// Recarrega UMA pergunta (usado após editar durante o estudo, para atualizar
// o item sem remontar a fila e perder o lugar na sessão).
async function buscarPerguntaPorId(id) {
  const { data, error } = await sb
    .from('perguntas')
    .select(SELECT_PERGUNTA)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? normalizarPergunta(data) : null;
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

// Chave de COMPARAÇÃO de tópico (não de exibição): ignora caixa, acentos e
// espaços repetidos. Assim "S3", "s3" e " S3 " são o MESMO tópico e não viram
// subdivisões duplicadas — o antigo match exato (.eq nome) deixava duplicar.
// A grafia guardada/exibida continua sendo a da primeira vez que apareceu.
function chaveTopico(nome) {
  return (nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .trim().replace(/\s+/g, ' ').toLowerCase();
}

// Lista os tópicos (subdivisões) já existentes numa matéria, sem o "Geral"
// implícito. Enviado à IA na ingestão para ela REUTILIZAR rótulos em vez de
// inventar sinônimos (contém a fragmentação da taxonomia).
async function topicosDaMateria(materiaId) {
  const { data, error } = await sb
    .from('subdivisoes')
    .select('nome')
    .eq('materia_id', materiaId);
  if (error) return [];
  return (data || [])
    .map((s) => s.nome)
    .filter((n) => n && n.trim() && n.trim().toLowerCase() !== 'geral');
}

async function garantirSubdivisao(materiaId, nome) {
  const nomeLimpo = (nome || 'Geral').trim().replace(/\s+/g, ' ') || 'Geral';
  const chave = chaveTopico(nomeLimpo);

  // Busca por comparação NORMALIZADA (o Postgres só casava string idêntica).
  // O conjunto de subdivisões por matéria é pequeno, então trazer todas e
  // comparar no cliente é barato e evita escapar curingas de ILIKE.
  const { data: existentes, error: erroBusca } = await sb
    .from('subdivisoes')
    .select('id, nome')
    .eq('materia_id', materiaId);

  if (erroBusca) throw new Error(erroBusca.message);

  const achado = (existentes || []).find((s) => chaveTopico(s.nome) === chave);
  if (achado) return achado.id;

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
  listas: { titulo: 'Listas de exercícios', sub: 'Monte listas de um livro; resolva e o código confere as respostas' },
  materiais: { titulo: 'Materiais', sub: 'Livros, PDFs e slides desta matéria — privados, só você acessa' },
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
  if (id === 'listas') aoAbrirListas();
  if (id === 'materiais') aoAbrirMateriais();

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

// --- previsão dos intervalos dos 4 botões do flashcard ---
// ESPELHO da função SQL `registrar_resposta` (migração 0017). Serve só para
// MOSTRAR o tempo em cima de cada botão — quem decide de verdade é o banco.
// Qualquer mudança na SM-2 de lá precisa ser refletida aqui; há teste
// comparando as duas contra uma matriz de estados.
const QUALIDADE = { DE_NOVO: 2, DIFICIL: 3, BOM: 4, FACIL: 5 };

function preverIntervalos(intervaloDias, fatorFacilidade) {
  const i = Math.max(0, Number(intervaloDias) || 0);
  const efBase = (Number(fatorFacilidade) || 250) / 100;
  const efDe = (q) => Math.max(efBase + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 1.3);

  const intervaloBom = (ef) => (i <= 0 ? 1 : i === 1 ? 6 : Math.round(i * ef));

  return {
    [QUALIDADE.DE_NOVO]: 0,
    [QUALIDADE.DIFICIL]: i <= 0 ? 1 : Math.max(i + 1, Math.round(i * 1.2)),
    [QUALIDADE.BOM]: intervaloBom(efDe(QUALIDADE.BOM)),
    [QUALIDADE.FACIL]: i <= 0 ? 4 : Math.round(intervaloBom(efDe(QUALIDADE.FACIL)) * 1.3),
  };
}

// Rótulo curto no estilo do Anki: <10min, 3 dias, 2,4 meses, 1,7 anos.
function formatarIntervalo(dias) {
  if (dias <= 0) return '<10 min';
  if (dias === 1) return '1 dia';
  if (dias < 30) return `${dias} dias`;
  if (dias < 365) return `${(dias / 30).toFixed(1).replace('.', ',')} meses`;
  const anos = (dias / 365).toFixed(1).replace('.', ',');
  return `${anos} ano${anos === '1,0' ? '' : 's'}`;
}

// --- menu de opções de um item (engrenagem) ---
// Usado tanto na lista de perguntas quanto na tela de estudo. Cada entrada do
// menu vira um botão com `data-acao`; quem monta decide o que fazer em
// `aoEscolher(acao)`. Sem handler inline (a CSP proíbe).
const ICONE_ENGRENAGEM =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const ICONE_EDITAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
  '<path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
const ICONE_LIXEIRA =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<polyline points="3 6 5 6 21 6"/>' +
  '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
// olho cortado (ocultar) e olho (reexibir)
const ICONE_OCULTAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
  '<path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
const ICONE_OLHO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z"/><circle cx="12" cy="12" r="3"/></svg>';
// setas em ciclo: "gerar versões" / "tem N versões"
const ICONE_VARIANTE_MENU =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M4 4v6h6"/><path d="M20 20v-6h-6"/>' +
  '<path d="M20 9a8 8 0 0 0-14-3L4 8"/><path d="M4 15a8 8 0 0 0 14 3l2-2"/></svg>';

// Uma única chamada de IA devolve várias versões, que ficam GRAVADAS em
// pergunta_variantes e passam a se revezar com o original sem custo nenhum.
const VARIANTES_POR_CHAMADA = 3;

// Gera e GRAVA versões reformuladas de uma pergunta. Vive aqui (e não na tela de
// estudo) porque a ação é usada em dois lugares: na lista de Perguntas — onde o
// item está sempre visível — e durante o estudo. Esse era o problema original: a
// ação só existia na fila de revisão, e a pergunta qualificava justamente quando
// o SM-2 a mandava para semanas no futuro, então o botão quase nunca aparecia.
// Devolve as variantes gravadas; lança Error com mensagem amigável se falhar.
async function gerarVariantesPara(pergunta, modelo) {
  const { data, error } = await sb.functions.invoke('reformular', {
    body: {
      modelo,
      quantidade: VARIANTES_POR_CHAMADA,
      pergunta: {
        enunciado: pergunta.enunciado,
        dificuldade: pergunta.dificuldade,
        opcoes: (pergunta.opcoes || []).map((o) => ({ texto: o.texto, correta: o.correta })),
        topico: pergunta.topico ?? null,
      },
    },
  });

  if (error) throw new Error(await mensagemErroFuncao(error));

  const variantes = (data?.variantes || []).map((v) => ({
    pergunta_id: pergunta.id,
    enunciado: v.enunciado,
    opcoes: v.opcoes.map((o) => ({ texto: o.texto, correta: Boolean(o.correta) })),
  }));
  if (variantes.length === 0) throw new Error('A IA não devolveu versões válidas.');

  const { data: inseridas, error: erroInsert } = await sb
    .from('pergunta_variantes')
    .insert(variantes)
    .select('id, enunciado, opcoes, descartada');
  if (erroInsert) throw new Error(erroInsert.message);

  return inseridas || [];
}

// Marca/desmarca um item como oculto da revisão (update direto — RLS cobre;
// não é atômico-crítico como trocar alternativas, então dispensa RPC).
async function ocultarPergunta(id, oculta) {
  const { error } = await sb.from('perguntas').update({ oculta }).eq('id', id);
  if (error) { toast(error.message, 'error'); return false; }
  return true;
}

// Exclusão de pergunta com confirmação, COMPARTILHADA entre a lista de
// Perguntas e a tela de estudo. Guarda o id + um callback "depois de excluir"
// (cada tela reage do seu jeito) e reaproveita o modal-delete. O handler do
// botão de confirmar é ligado UMA vez aqui.
let _exclusaoId = null;
let _exclusaoApos = null;
function pedirExclusaoPergunta(id, aposExcluir) {
  _exclusaoId = id;
  _exclusaoApos = aposExcluir || null;
  openModal('modal-delete');
}
document.getElementById('modal-delete-confirm')?.addEventListener('click', async () => {
  if (_exclusaoId == null) return;
  const { error } = await sb.from('perguntas').delete().eq('id', _exclusaoId);
  if (error) { toast(error.message, 'error'); return; }
  closeModal('modal-delete');
  toast('Item removido.');
  const apos = _exclusaoApos;
  _exclusaoId = null;
  _exclusaoApos = null;
  if (apos) await apos();
});

function renderMenuItemHTML(entradas) {
  return `
    <span class="item-menu">
      <button type="button" class="item-menu-btn" data-menu-abrir title="Opções" aria-label="Opções">
        ${ICONE_ENGRENAGEM}
      </button>
      <span class="item-menu-lista">
        ${entradas
          .map(
            (e) => `<button type="button" data-acao="${e.acao}" class="${e.perigo ? 'perigo' : ''}">
                      ${e.icone || ''}${esc(e.rotulo)}
                    </button>`
          )
          .join('')}
      </span>
    </span>
  `;
}

function fecharMenusItem() {
  document.querySelectorAll('.item-menu-lista.aberto').forEach((m) => m.classList.remove('aberto'));
}

// Liga um menu já renderizado. `raiz` é o elemento que contém o .item-menu.
function wireMenuItem(raiz, aoEscolher) {
  const menu = raiz.querySelector('.item-menu');
  if (!menu) return;
  const lista = menu.querySelector('.item-menu-lista');

  menu.querySelector('[data-menu-abrir]').addEventListener('click', (e) => {
    e.stopPropagation();
    const jaAberto = lista.classList.contains('aberto');
    fecharMenusItem();
    if (!jaAberto) lista.classList.add('aberto');
  });

  lista.querySelectorAll('[data-acao]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      fecharMenusItem();
      aoEscolher(btn.dataset.acao);
    });
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.item-menu')) fecharMenusItem();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharMenusItem();
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
// --- fórmulas LaTeX → MathML (só em matéria matemática, via { math: true }) ---
// Estratégia "protege e restaura": o math é extraído ANTES do escape/Markdown
// (senão `esc()` estragaria o `<`/`&` do LaTeX e as regex de Markdown comeriam
// `\frac`, `*` etc.), renderizado pelo Temml (que produz MathML seguro, com
// `trust=false` — bloqueia `\href` e afins → sem XSS), e reinserido DEPOIS de
// todo o pipeline. O placeholder usa caracteres de uso privado (/)
// que sobrevivem ao escape e não casam com nenhuma regex de Markdown.
function extrairMath(texto, saida) {
  // sem Temml carregado (ou fora do modo math) o chamador nem chega aqui.
  const guarda = (latex, bloco) => {
    let mathml;
    try {
      mathml = temml.renderToString(latex, { displayMode: bloco, throwOnError: false });
    } catch (_) {
      // fórmula impossível de converter: mostra o LaTeX cru, escapado (inerte).
      mathml = esc((bloco ? '$$' : '$') + latex + (bloco ? '$$' : '$'));
    }
    const token = '\uE000' + saida.length + '\uE001';
    saida.push(bloco ? `<span class="math-bloco">${mathml}</span>` : mathml);
    return token;
  };
  return texto
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => guarda(m.trim(), true))   // bloco $$...$$
    .replace(/\$([^$\n]+?)\$/g, (_, m) => guarda(m.trim(), false));     // inline $...$
}

function restaurarMath(html, saida) {
  return html.replace(/\uE000(\d+)\uE001/g, (_, i) => saida[Number(i)] ?? '');
}

function formatarTexto(texto, opcoes = {}) {
  const compacto = Boolean(opcoes.compacto);
  // Renderiza fórmula só quando pedido (matéria matemática) E o Temml carregou.
  const comMath = Boolean(opcoes.math) && typeof temml !== 'undefined' && temml;
  const mathRenderizado = [];
  const fonte = comMath ? extrairMath(String(texto ?? ''), mathRenderizado) : (texto ?? '');
  const linhas = esc(fonte).split('\n');
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
  // restaura as fórmulas (placeholders → MathML) SEMPRE por último, depois de
  // todo o Markdown, para nenhuma regex tocar no MathML já pronto.
  const finalizar = (s) => (comMath ? restaurarMath(s, mathRenderizado) : s);

  if (compacto) {
    return finalizar(saida
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
        '<em class="fonte-enunciado">$1</em>'));
  }

  return finalizar(saida
    // comportamento histórico de questões/simulados: *...* vira referência em bloco
    .replace(/\*([^*]{2,240}?)\*/g, '<em class="fonte-enunciado">$1</em>')
    .replace(/(?:^|<br>)(\([^()<]{6,240}?(?:\b\d{4}\b|Disponível em)[^()<]*?\))(?=<br>|$)/g,
      '<em class="fonte-enunciado">$1</em>'));
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

// Etiqueta de resultado ao pé de cada alternativa (após responder).
const ICONE_TAG = {
  acertou: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  errou: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  faltou: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};
function tagOpcao(tipo, texto) {
  return `<span class="opcao-tag opcao-tag-${tipo}">${ICONE_TAG[tipo] || ''}${esc(texto)}</span>`;
}

function renderPerguntaQuizHTML(pergunta, chave) {
  const imagens = renderImagensPergunta(pergunta);
  const antes = pergunta.imagens_posicao === 'antes';
  const multipla = perguntaMultipla(pergunta);
  // Em matéria matemática, enunciado e alternativas renderizam LaTeX. Em
  // matéria normal, mat=false → comportamento byte-a-byte idêntico ao de sempre
  // (enunciado via formatarTexto sem math; alternativas via esc puro).
  const mat = materiaEhMatematica();
  return `
    <div class="question-card" data-chave="${chave}" ${multipla ? 'data-multipla="1"' : ''}>
      ${renderOrigemQuiz(pergunta)}
      ${antes ? imagens : ''}
      <div class="question-title">${formatarTexto(pergunta.enunciado, { math: mat })}</div>
      ${antes ? '' : imagens}
      ${multipla ? '<p class="opcoes-multipla-aviso">Esta questão tem mais de uma alternativa correta — marque todas e confirme.</p>' : ''}
      <div class="opcoes-quiz">
        ${pergunta.opcoes
          .map(
            (o, idx) => `
            <div class="opcao-quiz" data-idx="${idx}">
              <span class="opcao-letra">${LETRAS[idx] || '?'}</span>
              <span>${mat ? formatarTexto(o.texto, { math: true, compacto: true }) : esc(o.texto)}</span>
            </div>`
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-primary btn-sm opcoes-confirmar-btn" disabled>Confirmar resposta</button>
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
    // já respondeu: o botão "Confirmar resposta" (só existe na múltipla) sai.
    card.querySelector('.opcoes-confirmar-btn')?.remove();

    const escolhidos = new Set(indicesEscolhidos);
    const corretos = new Set(
      pergunta.opcoes.map((o, i) => (o.correta ? i : -1)).filter((i) => i !== -1)
    );
    const correta =
      escolhidos.size === corretos.size && [...corretos].every((i) => escolhidos.has(i));

    // Quatro estados distintos, cada um com etiqueta, para não confundir o que
    // se acertou com o que faltou marcar:
    //   acertou = marcou e é correta (verde sólido)
    //   errou   = marcou e é errada  (vermelho)
    //   faltou  = correta que NÃO foi marcada (verde tracejado)
    //   (não marcada e errada = apagada)
    opcoesEls.forEach((el, idx) => {
      el.classList.add('desabilitada');
      const ehCorreta = pergunta.opcoes[idx].correta;
      const marcada = escolhidos.has(idx);

      if (ehCorreta && marcada) {
        el.classList.add('correta', 'selecionada');
        el.insertAdjacentHTML('beforeend', tagOpcao('acertou', 'você acertou'));
      } else if (ehCorreta && !marcada) {
        el.classList.add('correta', 'faltou');
        el.insertAdjacentHTML('beforeend', tagOpcao('faltou', 'faltou marcar'));
      } else if (!ehCorreta && marcada) {
        el.classList.add('incorreta', 'selecionada');
        el.insertAdjacentHTML('beforeend', tagOpcao('errou', 'você errou'));
      }
    });

    montarSaberMais(card, pergunta);
    await aoResponder(correta);
  }

  // Fluxo único: marca (múltipla = checkbox, várias; única = rádio, uma por
  // vez) e só registra ao "Confirmar resposta" — dá para trocar antes.
  const btnConfirmar = card.querySelector('.opcoes-confirmar-btn');
  const escolhidos = new Set();

  opcoesEls.forEach((el, idx) => {
    el.addEventListener('click', () => {
      if (card.dataset.respondida) return;
      if (multipla) {
        el.classList.toggle('selecionada');
        if (escolhidos.has(idx)) escolhidos.delete(idx);
        else escolhidos.add(idx);
      } else {
        opcoesEls.forEach((o) => o.classList.remove('selecionada'));
        el.classList.add('selecionada');
        escolhidos.clear();
        escolhidos.add(idx);
      }
      btnConfirmar.disabled = escolhidos.size === 0;
    });
  });

  btnConfirmar.addEventListener('click', () => {
    if (card.dataset.respondida) return;
    finalizar(escolhidos);
  });
}

// --- "Saber mais": aprofundamento sob demanda (até 3 complementos) ---
// A decisão cache-ou-IA é do SERVIDOR (Edge Function `saber_mais`): o cliente
// nunca recebe o conteúdo salvo no carregamento e sempre faz a mesma chamada
// (pergunta_id + quantos já viu). Assim, nem pelo código nem pelo devtools dá
// para saber se a resposta veio do cache ou foi gerada agora — a forma é
// idêntica. O bloco começa SEMPRE recolhido; clicar dispara a consulta.
const SABER_MAIS_MAX = 3;
const SABER_MAIS_MODELO = 'ChatGPT';

// Questão do banco público (doBanco) não pertence à conta: não há onde
// cachear, então o recurso fica restrito aos itens do próprio usuário
// (perguntas E flashcards).
function podeSaberMais(pergunta) {
  return !pergunta.doBanco && pergunta.id != null;
}

// `estado` acumula o que já foi revelado NESTA exibição do card. Sem estado =
// recolhido (nada revelado), que é como todo card começa.
function montarSaberMais(card, pergunta, estado) {
  const bloco = card.querySelector('[data-saber-mais]');
  if (!bloco || !podeSaberMais(pergunta)) return;

  estado = estado || { revelados: [], total: null, esgotado: false };
  const nRev = estado.revelados.length;

  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

  // Botão: nada revelado → "Saber mais"; já revelou e ainda cabe → "Ainda não
  // entendi"; esgotado (servidor não trouxe mais, ou chegou ao teto) → sem botão.
  let rotulo = null;
  if (!estado.esgotado && nRev < SABER_MAIS_MAX) {
    rotulo = nRev === 0 ? 'Saber mais' : 'Ainda não entendi';
  }

  bloco.hidden = false;
  bloco.innerHTML = `
    ${nRev
      ? `<div class="saber-mais-item">
           ${estado.revelados
             .map((t) => `<div class="saber-mais-texto">${formatarTexto(t, { compacto: true })}</div>`)
             .join('')}
         </div>`
      : ''}
    ${rotulo
      ? `<button type="button" class="btn btn-secondary btn-sm saber-mais-btn">${ICONE}${rotulo}</button>`
      : ''}
  `;

  const btn = bloco.querySelector('.saber-mais-btn');
  if (btn) btn.addEventListener('click', () => consultarSaberMais(card, pergunta, estado, btn));
}

// Única ação do cliente: pedir "o próximo" complemento. O servidor devolve do
// cache (sem gastar IA) ou gera — indistinguível daqui.
async function consultarSaberMais(card, pergunta, estado, btn) {
  // Troca o botão pelo indicador de "IA pensando" (mantém o que já foi
  // revelado acima). O mesmo indicador vale para cache e IA — daqui não há
  // como distinguir, e o piso de latência garante que ele apareça.
  const ICONE_SPARKLE = '<svg class="ia-sparkle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z"/></svg>';
  btn.outerHTML = `
    <div class="saber-mais-pensando" role="status" aria-live="polite">
      ${ICONE_SPARKLE}
      <span>IA pensando</span>
      <span class="ia-dots"><i></i><i></i><i></i></span>
    </div>`;

  try {
    const { data, error } = await sb.functions.invoke('saber_mais', {
      body: {
        modelo: SABER_MAIS_MODELO,
        pergunta_id: pergunta.id,
        vistos: estado.revelados.length,
      },
    });

    if (error) {
      toast(await mensagemErroFuncao(error), 'error');
      montarSaberMais(card, pergunta, estado); // restaura o botão
      return;
    }

    const novos = Array.isArray(data?.complementos) ? data.complementos : [];
    estado.revelados = [...estado.revelados, ...novos];
    if (typeof data?.total === 'number') estado.total = data.total;
    // esgota quando o servidor não trouxe nada novo ou já atingiu o teto.
    estado.esgotado = novos.length === 0 || estado.revelados.length >= SABER_MAIS_MAX;

    montarSaberMais(card, pergunta, estado);
  } catch (erro) {
    toast(erro.message || 'Falha ao consultar.', 'error');
    montarSaberMais(card, pergunta, estado); // restaura o botão
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
