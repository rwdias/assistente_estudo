// ===========================================================================
// CRONOGRAMA SEMANAL
//
// O painel existe para resolver UM problema: esquecer uma matéria. Quem estuda
// para concurso costuma ter na agenda um bloco genérico ("estudar para o
// concurso"), escolhe a matéria na hora e acaba escolhendo sempre as mesmas —
// as outras somem do radar e o buraco só aparece perto da prova.
//
// Por isso a tela mostra DUAS coisas, e nessa ordem de importância:
//   1. a grade da semana, com QUAL matéria cai em cada horário;
//   2. "matérias esfriando" — há quantos dias cada uma não é tocada.
// O item 2 é a honestidade da dívida: quando o rodízio não fecha (semana de
// prova, dia perdido), a tela mostra quem ficou para trás em vez de fingir
// que está tudo coberto.
//
// Toda a inteligência (rodízio, cobertura, intenção) vive na RPC
// gerar_plano_semana — ver 0032_cronograma.sql. Aqui é só apresentação.
// ===========================================================================

// A semana em exibição, sempre representada pela SEGUNDA-feira. Guardar a
// segunda (e não "hoje") é o que faz navegar entre semanas ser só somar 7.
let cronogramaSemana = null;
let cronogramaBlocos = [];
let cronogramaPanorama = [];

// Domingo fica fora da grade de propósito: é o dia de folga do usuário, e
// reservá-lo no plano transformaria descanso em dívida.
const CRON_DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// A intenção do bloco vem do estado da matéria (0032): sem itens = precisa
// criar material; com fila vencida = revisar; em dia = exercitar.
const CRON_INTENCAO = {
  ingestao: { rotulo: 'ingestão', classe: 'badge-amber' },
  revisao: { rotulo: 'revisão', classe: 'badge-red' },
  exercicios: { rotulo: 'exercícios', classe: 'badge-green' },
};

const ICONE_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

// --- datas -----------------------------------------------------------------
// Tudo em horário local: o "dia" que importa é o do usuário, não o do servidor.

function cronIsoData(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// getDay() devolve 0 para domingo; a grade é isodow (segunda primeiro), então
// o deslocamento (+6)%7 põe segunda em 0 e domingo em 6.
function cronSegundaDa(data) {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function cronSomarDias(data, dias) {
  const d = new Date(data);
  d.setDate(d.getDate() + dias);
  return d;
}

function cronRotuloSemana(segunda) {
  const sabado = cronSomarDias(segunda, 5);
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(segunda)} a ${fmt(sabado)}`;
}

// --- carga -----------------------------------------------------------------

function aoAbrirCronograma() {
  if (!cronogramaSemana) cronogramaSemana = cronSegundaDa(new Date());
  carregarCronograma();
}

async function carregarCronograma() {
  const grade = document.getElementById('cron-grade');
  grade.innerHTML = '<div class="card" style="padding:18px">Carregando cronograma…</div>';

  const inicio = cronIsoData(cronogramaSemana);
  const fim = cronIsoData(cronSomarDias(cronogramaSemana, 5));

  // As duas cargas são independentes — em paralelo para não somar latências.
  const [resPanorama, resBlocos] = await Promise.all([
    sb.rpc('panorama_materias_cronograma'),
    sb
      .from('blocos_plano')
      .select('id, data, hora_inicio, duracao_minutos, materia_id, intencao, concluido_em')
      .gte('data', inicio)
      .lte('data', fim)
      .order('data')
      .order('hora_inicio'),
  ]);

  if (resPanorama.error) return toast(resPanorama.error.message, 'error');
  if (resBlocos.error) return toast(resBlocos.error.message, 'error');

  cronogramaPanorama = resPanorama.data || [];
  cronogramaBlocos = resBlocos.data || [];

  document.getElementById('cron-semana-rotulo').textContent = cronRotuloSemana(cronogramaSemana);
  renderCronogramaGrade();
  renderMateriasEsfriando();
}

function cronMateria(id) {
  return cronogramaPanorama.find((m) => m.id === id);
}

// Só entram no rodízio matérias que pertencem a alguma trilha ativa — trilha
// arquivada (curso concluído) não pode roubar bloco de quem ainda importa.
function cronMateriasAtivas() {
  return cronogramaPanorama.filter((m) => m.trilha_id && !m.trilha_arquivada);
}

// --- grade da semana -------------------------------------------------------

function renderCronogramaGrade() {
  const grade = document.getElementById('cron-grade');

  if (!cronogramaBlocos.length) {
    grade.innerHTML = `
      <div class="empty-state">
        <p>Nenhum plano para esta semana ainda.</p>
        <p class="secao-sub">Gere o plano e o rodízio distribui suas matérias pelos horários da sua rotina.</p>
      </div>`;
    document.getElementById('cron-explicacao').textContent = '';
    return;
  }

  // Linhas = horários distintos; colunas = segunda a sábado. Montar a matriz a
  // partir dos blocos (e não da grade) mantém a tela coerente com o que foi
  // realmente planejado, inclusive em semanas antigas cuja grade já mudou.
  const horarios = [...new Set(cronogramaBlocos.map((b) => b.hora_inicio))].sort();
  const datas = CRON_DIAS.map((_, i) => cronIsoData(cronSomarDias(cronogramaSemana, i)));
  const hoje = cronIsoData(new Date());

  const cabecalho = CRON_DIAS.map((dia, i) => {
    const d = cronSomarDias(cronogramaSemana, i);
    const marca = datas[i] === hoje ? ' cron-hoje' : '';
    return `<div class="cron-col-cabecalho${marca}">
              <span class="cron-dia">${dia}</span>
              <span class="cron-data">${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}</span>
            </div>`;
  }).join('');

  const linhas = horarios
    .map((hora) => {
      const celulas = datas
        .map((data) => {
          const bloco = cronogramaBlocos.find((b) => b.data === data && b.hora_inicio === hora);
          return `<div class="cron-celula">${bloco ? blocoHTML(bloco) : ''}</div>`;
        })
        .join('');
      return `<div class="cron-hora">${String(hora).slice(0, 5)}</div>${celulas}`;
    })
    .join('');

  grade.innerHTML = `<div class="cron-grade"><div class="cron-hora"></div>${cabecalho}${linhas}</div>`;
  wireBlocos(grade);
  renderCronogramaExplicacao();
}

function blocoHTML(b) {
  const materia = cronMateria(b.materia_id);
  const intencao = CRON_INTENCAO[b.intencao] || CRON_INTENCAO.revisao;
  const feito = !!b.concluido_em;
  return `
    <div class="cron-bloco${feito ? ' cron-feito' : ''}" data-bloco="${b.id}" data-materia="${b.materia_id}" data-intencao="${b.intencao}">
      <button type="button" class="cron-check" data-acao="concluir" title="${feito ? 'Desmarcar' : 'Marcar como estudado'}">${ICONE_CHECK}</button>
      <button type="button" class="cron-nome" data-acao="estudar" title="Abrir esta matéria">${esc(materia?.nome || 'Matéria removida')}</button>
      <span class="badge ${intencao.classe}">${intencao.rotulo}</span>
    </div>`;
}

function wireBlocos(raiz) {
  raiz.querySelectorAll('.cron-bloco').forEach((el) => {
    const id = Number(el.dataset.bloco);
    el.querySelector('[data-acao="concluir"]').addEventListener('click', () => alternarConclusaoBloco(id));
    el.querySelector('[data-acao="estudar"]').addEventListener('click', () =>
      estudarBloco(Number(el.dataset.materia), el.dataset.intencao));
  });
}

// A faixa explicativa é o compromisso honesto da feature: se alguma matéria
// da rotação não coube na semana, ela é NOMEADA aqui. Um cronograma que só
// mostra o que foi planejado esconde exatamente o risco que ele deveria cobrir.
function renderCronogramaExplicacao() {
  const escaladas = new Set(cronogramaBlocos.map((b) => b.materia_id));
  const foraDaSemana = cronMateriasAtivas().filter((m) => !escaladas.has(m.id));
  const alvo = document.getElementById('cron-explicacao');

  if (!foraDaSemana.length) {
    alvo.textContent = `Todas as ${escaladas.size} matérias da sua rotação entram nesta semana — o ciclo fecha em 7 dias.`;
    return;
  }
  const nomes = foraDaSemana.map((m) => m.nome).join(', ');
  alvo.textContent =
    `${foraDaSemana.length} matéria(s) não couberam nesta semana e voltam no próximo ciclo: ${nomes}. ` +
    `Repor no sábado é o que evita que virem buraco.`;
}

// --- ações -----------------------------------------------------------------

async function gerarPlanoSemana() {
  const btn = document.getElementById('cron-gerar');
  btn.disabled = true;
  // Regerar é idempotente e nunca mexe em bloco já concluído (ver o
  // `where concluido_em is null` do upsert em 0032) — por isso o botão pode
  // ser apertado à vontade, que é o hábito que a feature quer criar.
  const { data, error } = await sb.rpc('gerar_plano_semana', { p_inicio: cronIsoData(cronogramaSemana) });
  btn.disabled = false;
  if (error) return toast(error.message, 'error');
  toast(data ? `Plano gerado: ${data} bloco(s).` : 'Nenhum slot na grade para esta semana.');
  carregarCronograma();
}

async function alternarConclusaoBloco(id) {
  const { error } = await sb.rpc('alternar_conclusao_bloco', { p_id: id, p_origem: 'manual' });
  if (error) return toast(error.message, 'error');
  carregarCronograma();
}

// Matéria vazia não tem fila para estudar — mandar o usuário ao Aprendizado
// seria entregar uma tela vazia. O bloco de ingestão abre Materiais, que é de
// onde sai o conteúdo (PDF + geração por IA).
function estudarBloco(materiaId, intencao) {
  definirMateriaAtual(materiaId);
  renderMateriaDropdown();
  goPanel(intencao === 'ingestao' ? 'materiais' : 'revisao');
}

// --- matérias esfriando ----------------------------------------------------

function renderMateriasEsfriando() {
  const alvo = document.getElementById('cron-esfriando');
  const ativas = cronMateriasAtivas().sort((a, b) => b.dias_sem_toque - a.dias_sem_toque);

  if (!ativas.length) {
    alvo.innerHTML = '<div class="empty-state"><p>Nenhuma matéria em trilha ativa.</p></div>';
    return;
  }
  alvo.innerHTML = ativas.map(materiaEsfriandoHTML).join('');
  alvo.querySelectorAll('.card-materia').forEach((card) => {
    card.addEventListener('click', () => {
      const m = cronMateria(Number(card.dataset.id));
      estudarBloco(m.id, m.total_itens === 0 ? 'ingestao' : 'revisao');
    });
  });
}

function materiaEsfriandoHTML(m) {
  // 9999 é o sentinela de "nunca tocada" que vem do panorama (0032). Mostrar
  // o número cru assustaria sem informar; o rótulo diz o que ele significa.
  const nunca = m.dias_sem_toque >= 9999;
  const dias = m.dias_sem_toque;
  let classe = 'badge-green';
  if (nunca || dias >= 14) classe = 'badge-red';
  else if (dias >= 7) classe = 'badge-amber';

  const rotulo = nunca ? 'nunca estudada' : dias === 0 ? 'estudada hoje' : `${dias} dia(s) sem estudo`;
  const conteudo = m.total_itens === 0
    ? 'sem material ainda'
    : `${m.total_itens} item(ns) · ${m.vencidos} vencido(s)`;

  return `
    <div class="card card-materia" data-id="${m.id}">
      <div class="nome">${esc(m.nome)}</div>
      <div class="metricas">${esc(m.trilha_nome || 'Sem trilha')}</div>
      <div class="metricas">${conteudo}</div>
      <span class="badge ${classe}" style="margin-top:8px">${rotulo}</span>
    </div>`;
}

// --- navegação entre semanas ----------------------------------------------
// A semana é a unidade de replanejamento do usuário ("na outra semana posso
// repensar se algo deu errado"), então andar para trás/frente é primário.

document.getElementById('cron-anterior').addEventListener('click', () => {
  cronogramaSemana = cronSomarDias(cronogramaSemana, -7);
  carregarCronograma();
});
document.getElementById('cron-proxima').addEventListener('click', () => {
  cronogramaSemana = cronSomarDias(cronogramaSemana, 7);
  carregarCronograma();
});
document.getElementById('cron-gerar').addEventListener('click', gerarPlanoSemana);
