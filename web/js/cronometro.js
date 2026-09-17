let tempoUsuario = null;
let tempoMateria = null;
let tempoEstado = null;
let tempoSincronizando = false;
let tempoUltimaSync = 0;
let tempoErro = '';
let tempoIntervalo = null;
const TEMPO_PRESETS = { livre: [0, 0], '30': [30, 5], '60': [60, 10], '90': [90, 15], '120': [120, 20] };
const TEMPO_LIMITE_LIVRE = 3 * 60 * 60_000;
let tempoAudio = null;

async function ativarSomTempo() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    tempoAudio ||= new Audio();
    if (tempoAudio.state === 'suspended') await tempoAudio.resume();
    return tempoAudio.state === 'running';
  } catch (_) { return false; }
}

function tocarSomTempo() {
  if (tempoAudio?.state !== 'running') return false;
  try {
    [660, 880, 1100].forEach((frequencia, i) => {
      const inicio = tempoAudio.currentTime + i * 0.3;
      const oscilador = tempoAudio.createOscillator();
      const volume = tempoAudio.createGain();
      oscilador.frequency.value = frequencia;
      volume.gain.setValueAtTime(0, inicio);
      volume.gain.linearRampToValueAtTime(0.18, inicio + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.001, inicio + 0.45);
      oscilador.connect(volume);
      volume.connect(tempoAudio.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + 0.5);
      oscilador.onended = () => { oscilador.disconnect(); volume.disconnect(); };
    });
    return true;
  } catch (_) { return false; }
}

function atualizarPresetTempo(s) {
  const novo = { '25': '30', '50': '60' }[s.preset];
  if (!novo) return;
  s.preset = novo;
  // Mantém o tempo restante de um ciclo já iniciado; os próximos usam o novo preset.
  if (!s.rodando && !s.decorrido && s.fase === 'estudo') s.restante = TEMPO_PRESETS[novo][0] * 60_000;
}

function novoEstadoTempo() {
  return { preset: 'livre', fase: 'estudo', rodando: false, restante: 0, decorrido: 0, marco: 0, segmento: null, pendentes: {} };
}
function segundosTexto(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
}
function grupoTempo(materia) {
  const trilha = materia?.trilha_nome || 'Sem grupo';
  return trilha.startsWith('BACEN — Analista TI — ') ? 'BACEN — Analista TI' : trilha;
}

// Função determinística: usa relógio real, não conta ticks (abas em segundo
// plano têm timers reduzidos pelo navegador). Um Pomodoro nunca ultrapassa
// o foco programado, mesmo depois de fechar/reabrir a página.
function avancarTempo(s, agora) {
  atualizarPresetTempo(s);
  if (!s.rodando) return;
  const delta = Math.max(0, agora - s.marco);
  const limitado = s.preset !== 'livre' || s.fase === 'pausa';
  const gasto = Math.min(delta, limitado ? s.restante : Math.max(0, TEMPO_LIMITE_LIVRE - s.decorrido));
  if (s.fase === 'estudo') {
    s.decorrido += gasto;
    if (s.segmento && gasto > 0) {
      const fim = s.marco + gasto;
      s.pendentes[s.segmento.id] = { ...s.segmento, fim };
    }
  }
  if (limitado) s.restante = Math.max(0, s.restante - gasto);
  s.marco = agora;
  if ((!limitado && s.decorrido >= TEMPO_LIMITE_LIVRE) || (limitado && s.restante === 0)) {
    s.rodando = false;
    s.segmento = null;
    s.conclusao = crypto.randomUUID();
    if (!limitado) {
      s.aviso = 'Limite de 3 horas atingido. Tempo salvo. Finalize para iniciar outra sessão.';
      return;
    }
    s.fase = s.fase === 'estudo' ? 'pausa' : 'estudo';
    s.restante = TEMPO_PRESETS[s.preset][s.fase === 'pausa' ? 1 : 0] * 60_000;
    s.aviso = s.fase === 'pausa' ? 'Pomodoro concluído. Inicie sua pausa.' : 'Pausa concluída. Pronto para estudar.';
  }
}

function iniciarSegmentoTempo(s, agora, materiaId) {
  s.marco = agora;
  s.segmento = s.fase === 'estudo'
    ? { id: crypto.randomUUID(), materia_id: materiaId, modo: s.preset === 'livre' ? 'livre' : 'pomodoro', inicio: agora }
    : null;
}

async function alterarTempo(acao) {
  if (!tempoUsuario) return;
  // Todas as abas compartilham o mesmo cronômetro e serializam as alterações.
  if (!navigator.locks) {
    tempoErro = 'Este navegador não oferece suporte ao cronômetro. Use uma versão atualizada.';
    renderTempo();
    return;
  }
  const uid = tempoUsuario;
  await navigator.locks.request(`tempo-estudo:${uid}`, () => {
    if (tempoUsuario !== uid) return;
    try {
      const chave = `tempo-estudo:${uid}`;
      const salvo = localStorage.getItem(chave);
      const s = salvo ? JSON.parse(salvo) : novoEstadoTempo();
      const agora = Date.now();
      avancarTempo(s, agora);
      if (acao) acao(s, agora);
      localStorage.setItem(chave, JSON.stringify(s));
      tempoEstado = s;
      // Só a primeira aba com áudio habilitado toca cada conclusão.
      if (s.conclusao && s.somTocado !== s.conclusao && tocarSomTempo()) {
        s.somTocado = s.conclusao;
        localStorage.setItem(chave, JSON.stringify(s));
      }
    } catch (_) {
      tempoErro = 'Não foi possível salvar o cronômetro neste navegador.';
    }
    renderTempo();
  });
}

async function iniciarCronometro(uid) {
  tempoUsuario = uid;
  tempoMateria = Estado.materiaId;
  tempoErro = '';
  await alterarTempo();
  clearInterval(tempoIntervalo);
  tempoIntervalo = setInterval(async () => {
    await alterarTempo();
    if (Date.now() - tempoUltimaSync > 15_000) sincronizarTempo();
  }, 1000);
  await sincronizarTempo();
}

async function sincronizarTempo() {
  if (!tempoUsuario || tempoSincronizando) return;
  tempoSincronizando = true;
  tempoUltimaSync = Date.now();
  const uid = tempoUsuario;
  try {
    const pendentes = Object.values(tempoEstado?.pendentes || {});
    for (const p of pendentes) {
      if (tempoUsuario !== uid) return;
      const { error } = await sb.rpc('salvar_tempo_estudo', {
        p_id: p.id, p_materia_id: p.materia_id, p_modo: p.modo,
        p_inicio: new Date(p.inicio).toISOString(), p_fim: new Date(p.fim).toISOString(),
      });
      if (error) throw error;
      await alterarTempo(s => {
        // Um tick pode ter ampliado o intervalo durante o envio; não o apaga.
        if (s.pendentes[p.id]?.fim <= p.fim) delete s.pendentes[p.id];
      });
    }
    tempoErro = '';
    if (pendentes.length && document.getElementById('panel-dashboard').classList.contains('active')) carregarMetricasTempo();
  } catch (_) {
    tempoErro = 'Tempo salvo neste navegador. Aguardando sincronização.';
  } finally {
    tempoSincronizando = false;
    renderTempo();
  }
}

async function mudarMateriaTempo(id) {
  tempoMateria = id;
  await alterarTempo((s, agora) => {
    if (s.rodando && s.fase === 'estudo' && s.segmento?.materia_id !== id) {
      if (id) iniciarSegmentoTempo(s, agora, id);
      else { s.rodando = false; s.segmento = null; }
    }
  });
  sincronizarTempo();
}

async function encerrarCronometroConta() {
  await alterarTempo(s => { s.rodando = false; s.segmento = null; });
  await sincronizarTempo();
  clearInterval(tempoIntervalo);
  tempoUsuario = null;
  tempoEstado = null;
}

function renderTempo() {
  const s = tempoEstado || novoEstadoTempo();
  const materiaId = s.segmento?.materia_id ?? tempoMateria;
  const materia = Estado.materias.find(m => m.id === materiaId);
  const header = document.querySelector('.tempo-header');
  header.classList.toggle('tempo-aviso', Boolean(tempoErro || s.aviso));
  header.title = tempoErro || s.aviso || materia?.nome || 'Cronômetro de estudo';
  document.getElementById('tempo-relogio').textContent = segundosTexto(s.preset === 'livre' ? s.decorrido : s.restante);
  document.getElementById('tempo-materia').textContent = materia?.nome || 'Selecione uma matéria';
  document.getElementById('tempo-preset').value = s.preset;
  document.getElementById('tempo-preset').disabled = s.rodando || s.decorrido > 0;
  const botao = document.getElementById('tempo-iniciar');
  botao.textContent = s.rodando ? 'Pausar' : s.fase === 'pausa' ? 'Iniciar pausa' : 'Iniciar';
  botao.disabled = !tempoUsuario || !materia || (s.preset === 'livre' && s.decorrido >= TEMPO_LIMITE_LIVRE);
  document.getElementById('tempo-status').textContent = tempoErro || s.aviso ||
    (s.fase === 'pausa' ? 'Pausa · não conta como estudo' : s.rodando ? 'Estudando' : 'Pronto para estudar');
}

document.getElementById('tempo-iniciar').addEventListener('click', async () => {
  if (!tempoMateria) return;
  // O navegador exige um gesto do usuário para habilitar o aviso sonoro.
  ativarSomTempo();
  await alterarTempo((s, agora) => {
    if (s.preset === 'livre' && s.decorrido >= TEMPO_LIMITE_LIVRE) return;
    s.aviso = '';
    s.conclusao = null;
    s.rodando = !s.rodando;
    if (s.rodando) iniciarSegmentoTempo(s, agora, tempoMateria);
    else s.segmento = null;
  });
  sincronizarTempo();
});
document.getElementById('tempo-finalizar').addEventListener('click', async () => {
  const audioPronto = ativarSomTempo();
  const tinhaTempo = tempoEstado?.rodando || tempoEstado?.decorrido > 0;
  await alterarTempo(s => {
    const { pendentes, preset } = s;
    Object.assign(s, novoEstadoTempo(), { pendentes, preset, restante: TEMPO_PRESETS[preset][0] * 60_000 });
  });
  if (tinhaTempo) { await audioPronto; tocarSomTempo(); }
  await sincronizarTempo();
  carregarMetricasTempo();
});
document.getElementById('tempo-testar-som').addEventListener('click', async () => {
  if (await ativarSomTempo()) tocarSomTempo();
  else toast('Não foi possível ativar o som. Verifique as permissões de áudio do navegador.', 'error');
});
document.getElementById('tempo-preset').addEventListener('change', async e => {
  const preset = e.target.value;
  if (!TEMPO_PRESETS[preset]) return;
  await alterarTempo(s => {
    if (s.rodando || s.decorrido > 0) return;
    s.preset = preset;
    s.fase = 'estudo';
    s.restante = TEMPO_PRESETS[preset][0] * 60_000;
    s.aviso = '';
  });
});
window.addEventListener('online', () => sincronizarTempo());
document.addEventListener('visibilitychange', () => { alterarTempo(); });

async function carregarMetricasTempo() {
  const alvo = document.getElementById('tempo-metricas');
  if (!tempoUsuario) return;
  const uid = tempoUsuario;
  const { data, error } = await sb.rpc('resumo_tempo_estudo', { p_fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' });
  if (tempoUsuario !== uid) return;
  if (error) { alvo.textContent = 'Não foi possível carregar o tempo de estudo. Tente atualizar a página.'; return; }
  const linhas = data || [];
  const total = campo => linhas.reduce((s, r) => s + Number(r[campo]), 0);
  const duracao = segundos => segundosTexto(segundos * 1000);
  const grupos = new Map();
  const materias = Estado.materias.map(m => {
    const r = linhas.find(r => r.materia_id === m.id);
    const segundos = Number(r?.total_segundos || 0);
    const grupo = grupoTempo(m);
    grupos.set(grupo, (grupos.get(grupo) || 0) + segundos);
    return { nome: m.nome, grupo, segundos };
  }).sort((a, b) => b.segundos - a.segundos);
  const tabela = (cab, itens) => `<div class="tabela-scroll"><table class="tabela-enunciado"><thead><tr><th>${cab}</th><th>Tempo acumulado</th></tr></thead><tbody>${itens.map(([nome, s]) => `<tr><td>${esc(nome)}</td><td>${duracao(s)}</td></tr>`).join('')}</tbody></table></div>`;
  alvo.innerHTML = `<div class="stat-grid">${[['Hoje', 'hoje_segundos'], ['Esta semana', 'semana_segundos'], ['Este mês', 'mes_segundos'], ['Total', 'total_segundos']].map(([nome, campo]) => `<div class="stat-card"><div class="stat-valor brand">${duracao(total(campo))}</div><div class="stat-rotulo">${nome}</div></div>`).join('')}</div>
    <p class="card-sub">Tempo de estudo sincronizado, sem pausas. Atualização a cada 15 segundos enquanto o cronômetro está ligado.</p>
    <details open><summary>Por concurso, faculdade ou grupo</summary>${tabela('Grupo', [...grupos].sort((a,b) => b[1]-a[1]))}</details>
    <details><summary>Por matéria</summary>${tabela('Matéria', materias.map(m => [m.nome, m.segundos]))}</details>`;
}
