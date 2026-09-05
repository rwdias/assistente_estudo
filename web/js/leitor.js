// Leitor de PDF embutido: abre o material DENTRO da plataforma, com o texto
// selecionável, para virar flashcard sem sair da página.
//
// Por que pdf.js e não um <iframe> com o visualizador do navegador: o iframe
// seria cross-origin (o arquivo mora no Supabase), então não daria para LER a
// seleção do usuário — que é justamente o ponto aqui. Com pdf.js, cada página
// vira um canvas + uma camada de texto transparente por cima, e essa camada é
// DOM comum: `window.getSelection()` funciona normalmente.
//
// A biblioteca é carregada SOB DEMANDA (320 KB + 1 MB de worker). Quem nunca
// abre um material não paga por ela.

const LEITOR_VENDOR = 'js/vendor/pdf.min.js';
const LEITOR_WORKER = 'js/vendor/pdf.worker.min.js';

let leitorDoc = null;        // PDFDocumentProxy aberto
let leitorPagina = 1;
let leitorEscala = 1.3;
let leitorInfo = null;       // { caminho, nome, titulo }
let leitorTrecho = '';       // texto selecionado no momento
let leitorPendentes = [];    // flashcards gerados, aguardando salvar

// Carrega o pdf.js uma única vez. Injeta um <script> local — a CSP permite
// 'self', mas não permitiria um CDN para o worker, por isso tudo é vendorizado.
function carregarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = LEITOR_VENDOR;
    tag.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = LEITOR_WORKER;
      resolve(window.pdfjsLib);
    };
    tag.onerror = () => reject(new Error('Não consegui carregar o leitor de PDF.'));
    document.head.appendChild(tag);
  });
}

async function abrirLeitor(caminho, nome, titulo) {
  if (!/\.pdf$/i.test(nome)) {
    toast('Por enquanto só PDF abre aqui dentro.', 'error');
    return;
  }

  leitorInfo = { caminho, nome, titulo: titulo || nome };
  document.getElementById('leitor-titulo').textContent = leitorInfo.titulo;
  document.getElementById('leitor-paginas').innerHTML = '<p style="padding:20px">Abrindo...</p>';
  document.getElementById('leitor').style.display = 'flex';

  try {
    const pdfjsLib = await carregarPdfJs();
    // URL assinada com validade maior que a de "abrir em aba": a leitura é uma
    // sessão, não um clique — mas ainda temporária (o bucket é privado).
    const { data, error } = await sb.storage
      .from(MATERIAIS_BUCKET)
      .createSignedUrl(caminho, 3600);
    if (error) throw new Error(error.message);

    leitorDoc = await pdfjsLib.getDocument({ url: data.signedUrl }).promise;
    leitorPagina = 1;
    await renderizarPaginaLeitor();
  } catch (erro) {
    document.getElementById('leitor-paginas').innerHTML =
      `<p style="padding:20px">${esc(erro.message)}</p>`;
  }
}

async function renderizarPaginaLeitor() {
  if (!leitorDoc) return;
  const container = document.getElementById('leitor-paginas');
  const pagina = await leitorDoc.getPage(leitorPagina);
  const viewport = pagina.getViewport({ scale: leitorEscala });

  container.innerHTML = '';
  const moldura = document.createElement('div');
  moldura.className = 'leitor-pagina';
  moldura.style.width = `${viewport.width}px`;
  moldura.style.height = `${viewport.height}px`;

  const canvas = document.createElement('canvas');
  // devicePixelRatio evita o texto borrado em tela retina.
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const camadaTexto = document.createElement('div');
  camadaTexto.className = 'leitor-texto';
  camadaTexto.style.width = `${viewport.width}px`;
  camadaTexto.style.height = `${viewport.height}px`;
  // O pdf.js posiciona os spans em unidades multiplicadas por esta variável.
  // Sem ela o texto invisível fica DESALINHADO do desenho — a seleção pegaria
  // um trecho diferente do que o olho vê (e o console reclama).
  camadaTexto.style.setProperty('--scale-factor', String(viewport.scale));

  moldura.append(canvas, camadaTexto);
  container.appendChild(moldura);

  await pagina.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  }).promise;

  // Camada de texto: spans invisíveis posicionados sobre o desenho. É o que
  // permite selecionar com o mouse (o canvas sozinho é só pixels).
  const conteudo = await pagina.getTextContent();
  window.pdfjsLib.renderTextLayer({
    textContentSource: conteudo,
    container: camadaTexto,
    viewport,
    textDivs: [],
  });

  document.getElementById('leitor-pagina').textContent =
    `${leitorPagina} / ${leitorDoc.numPages}`;
}

function fecharLeitor() {
  document.getElementById('leitor').style.display = 'none';
  document.getElementById('leitor-criar-btn').style.display = 'none';
  document.getElementById('leitor-paginas').innerHTML = '';
  leitorDoc?.destroy?.();
  leitorDoc = null;
  leitorTrecho = '';
}

function irParaPagina(delta) {
  if (!leitorDoc) return;
  const alvo = leitorPagina + delta;
  if (alvo < 1 || alvo > leitorDoc.numPages) return;
  leitorPagina = alvo;
  renderizarPaginaLeitor();
}

document.getElementById('leitor-fechar')?.addEventListener('click', fecharLeitor);
document.getElementById('leitor-anterior')?.addEventListener('click', () => irParaPagina(-1));
document.getElementById('leitor-proxima')?.addEventListener('click', () => irParaPagina(1));
document.getElementById('leitor-mais')?.addEventListener('click', () => {
  leitorEscala = Math.min(leitorEscala + 0.2, 3);
  renderizarPaginaLeitor();
});
document.getElementById('leitor-menos')?.addEventListener('click', () => {
  leitorEscala = Math.max(leitorEscala - 0.2, 0.6);
  renderizarPaginaLeitor();
});

// Setas navegam; Esc fecha — só quando o leitor está aberto.
document.addEventListener('keydown', (e) => {
  const leitor = document.getElementById('leitor');
  if (!leitor || leitor.style.display === 'none') return;
  if (e.key === 'Escape') fecharLeitor();
  else if (e.key === 'ArrowRight') irParaPagina(1);
  else if (e.key === 'ArrowLeft') irParaPagina(-1);
});

// Mostra o botão de criar flashcards junto da seleção. Usa mouseup em vez de
// selectionchange porque este dispara a cada caractere arrastado — o botão
// ficaria piscando durante a seleção.
document.addEventListener('mouseup', () => {
  const leitor = document.getElementById('leitor');
  const botao = document.getElementById('leitor-criar-btn');
  if (!leitor || leitor.style.display === 'none') return;

  const selecao = window.getSelection();
  const texto = (selecao?.toString() || '').trim();
  // Trecho curto demais não dá flashcard decente — evita disparo acidental.
  if (texto.length < 40) {
    botao.style.display = 'none';
    leitorTrecho = '';
    return;
  }

  leitorTrecho = texto;
  const area = selecao.getRangeAt(0).getBoundingClientRect();
  botao.style.display = 'inline-flex';
  botao.style.top = `${Math.max(area.bottom + 8, 60)}px`;
  botao.style.left = `${Math.max(area.left, 12)}px`;
});

// Gera flashcards do trecho selecionado reusando a Edge Function `extrair`
// (mesmo caminho do painel de IA) e mostra para revisão antes de salvar.
document.getElementById('leitor-criar-btn')?.addEventListener('click', async () => {
  if (!leitorTrecho) return;
  const botao = document.getElementById('leitor-criar-btn');
  const original = botao.innerHTML;
  botao.disabled = true;
  botao.textContent = 'Gerando...';

  const materia = Estado.materias.find((m) => m.id === Estado.materiaId);
  const { data, error } = await sb.functions.invoke('extrair', {
    body: {
      modelo: 'ChatGPT',
      texto: leitorTrecho,
      tipo: 'flashcard',
      assunto: materia?.nome ?? 'Estudo',
      dificuldade_padrao: 'Média',
      matematica: materiaEhMatematica(),
      contexto: '',
      topicos_existentes: await topicosDaMateria(Estado.materiaId),
    },
  });

  botao.disabled = false;
  botao.innerHTML = original;
  if (error) { toast(await mensagemErroFuncao(error), 'error'); return; }

  leitorPendentes = (data?.flashcards || []).filter((f) => f.frente && f.verso);
  if (leitorPendentes.length === 0) {
    toast('Não consegui gerar flashcards desse trecho.', 'error');
    return;
  }

  botao.style.display = 'none';
  renderPreviewTrecho();
  openModal('modal-trecho');
});

function renderPreviewTrecho() {
  const mat = materiaEhMatematica();
  document.getElementById('modal-trecho-origem').textContent =
    `${leitorPendentes.length} card(s) de "${leitorInfo?.titulo ?? ''}", página ${leitorPagina}.`;

  document.getElementById('modal-trecho-lista').innerHTML = leitorPendentes
    .map((f, i) => `
      <div class="pergunta-card" data-idx="${i}">
        <label class="checkbox-label">
          <input type="checkbox" class="trecho-incluir" checked /> Incluir
        </label>
        <label>Frente</label>
        <textarea class="trecho-frente" rows="2">${esc(f.frente)}</textarea>
        <label>Verso</label>
        <textarea class="trecho-verso" rows="3">${esc(f.verso)}</textarea>
        ${mat ? `<div class="ia-math-preview">${formatarTexto(f.verso, { math: true, compacto: true })}</div>` : ''}
      </div>`)
    .join('');
}

document.getElementById('modal-trecho-salvar')?.addEventListener('click', async () => {
  const cards = [...document.querySelectorAll('#modal-trecho-lista .pergunta-card')]
    .filter((c) => c.querySelector('.trecho-incluir').checked)
    .map((c) => {
      const i = Number(c.dataset.idx);
      return {
        tipo: 'flashcard',
        enunciado: c.querySelector('.trecho-frente').value.trim(),
        verso: c.querySelector('.trecho-verso').value.trim(),
        dificuldade: leitorPendentes[i].dificuldade || 'Média',
        topico: leitorPendentes[i].topico || null,
        opcoes: [],
        origem: 'llm',
      };
    })
    .filter((f) => f.enunciado && f.verso);

  if (cards.length === 0) { toast('Nenhum card selecionado.', 'error'); return; }

  const btn = document.getElementById('modal-trecho-salvar');
  btn.disabled = true;
  try {
    for (const card of cards) {
      await inserirPergunta(Estado.materiaId, card);
    }
    closeModal('modal-trecho');
    toast(`${cards.length} flashcard(s) criado(s) — já entram na fila de estudo.`);
    leitorPendentes = [];
  } catch (erro) {
    toast(erro.message, 'error');
  } finally {
    btn.disabled = false;
  }
});
