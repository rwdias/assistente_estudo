// Materiais da matéria: livros, PDFs, slides e listas guardados junto da
// matéria a que pertencem (bucket PRIVADO `materiais`, migr. 0027).
//
// Caminho de cada arquivo: {usuario_id}/{materia_id}/{nome}
// O uid como primeiro segmento é o que sustenta a política de Storage — ela
// exige `storage.foldername(name)[1] = auth.uid()`, então ninguém alcança a
// pasta de outro. O materia_id no segundo segmento é a "pasta por matéria".
//
// Nada de URL pública: o bucket é privado e cada abertura gera uma URL ASSINADA
// de validade curta. É o certo para material pessoal/protegido por direitos.

const MATERIAIS_BUCKET = 'materiais';
const MATERIAIS_MAX_BYTES = 50 * 1024 * 1024; // espelha o file_size_limit do bucket
const MATERIAIS_URL_SEGUNDOS = 300; // validade da URL assinada (5 min)

// Prefixo da pasta da matéria atual. Sem usuário ou sem matéria, não há pasta.
async function pastaMateriais() {
  const { data } = await sb.auth.getUser();
  const uid = data?.user?.id;
  if (!uid || !Estado.materiaId) return null;
  return `${uid}/${Estado.materiaId}`;
}

// Nome de arquivo seguro para o Storage: sem acentos e sem caracteres que
// compliquem o path, mas ainda legível (o usuário precisa reconhecer o livro).
// A extensão é preservada.
function nomeArquivoSeguro(nome) {
  const limpo = nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .replace(/[^a-zA-Z0-9._-]+/g, '-')                // resto vira hífen
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return limpo || 'arquivo';
}

function formatarTamanho(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Chamado pelo goPanel ao abrir o painel.
async function aoAbrirMateriais() {
  document.getElementById('materiais-status').textContent = '';
  document.getElementById('materiais-input').value = '';
  await carregarMateriais();
}

async function carregarMateriais() {
  const alvo = document.getElementById('materiais-lista');
  const pasta = await pastaMateriais();
  if (!pasta) {
    alvo.innerHTML = '<p>Crie ou selecione uma matéria primeiro.</p>';
    return;
  }

  const { data, error } = await sb.storage
    .from(MATERIAIS_BUCKET)
    .list(pasta, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });

  if (error) { alvo.innerHTML = `<p>${esc(error.message)}</p>`; return; }

  // O Storage devolve um placeholder oculto (.emptyFolderPlaceholder) quando a
  // pasta foi criada vazia — não é arquivo do usuário, então some da lista.
  const arquivos = (data || []).filter((f) => f.name && !f.name.startsWith('.'));

  if (arquivos.length === 0) {
    alvo.innerHTML = '<p>Nenhum arquivo ainda — envie o primeiro acima.</p>';
    return;
  }

  const ICONE_ABRIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  alvo.innerHTML = arquivos
    .map((f) => `
      <div class="pergunta-card material-item" data-nome="${esc(f.name)}">
        <div style="display:flex; align-items:center; gap:12px">
          <div style="flex:1; min-width:0">
            <div class="pergunta-enunciado" style="word-break:break-word">${esc(f.name)}</div>
            <div class="pergunta-meta">
              <span>${esc(formatarTamanho(f.metadata?.size))}</span>
              ${f.created_at ? `<span>${new Date(f.created_at).toLocaleDateString('pt-BR')}</span>` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm material-abrir">${ICONE_ABRIR} Abrir</button>
          ${renderMenuItemHTML([
            { acao: 'excluir', rotulo: 'Excluir arquivo', icone: ICONE_LIXEIRA, perigo: true },
          ])}
        </div>
      </div>`)
    .join('');

  alvo.querySelectorAll('.material-item').forEach((item) => {
    const nome = item.dataset.nome;
    item.querySelector('.material-abrir').addEventListener('click', () => abrirMaterial(pasta, nome));
    wireMenuItem(item, (acao) => {
      if (acao === 'excluir') excluirMaterial(pasta, nome);
    });
  });
}

// Abre o arquivo numa aba nova. O bucket é privado, então a URL é assinada na
// hora e expira em poucos minutos — não dá para compartilhar sem querer.
async function abrirMaterial(pasta, nome) {
  const { data, error } = await sb.storage
    .from(MATERIAIS_BUCKET)
    .createSignedUrl(`${pasta}/${nome}`, MATERIAIS_URL_SEGUNDOS);
  if (error) { toast(error.message, 'error'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}

async function excluirMaterial(pasta, nome) {
  const { error } = await sb.storage.from(MATERIAIS_BUCKET).remove([`${pasta}/${nome}`]);
  if (error) { toast(error.message, 'error'); return; }
  toast('Arquivo excluído.');
  await carregarMateriais();
}

document.getElementById('materiais-enviar-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('materiais-input');
  const status = document.getElementById('materiais-status');
  const arquivos = [...(input.files || [])];
  if (arquivos.length === 0) { toast('Escolha um arquivo primeiro.', 'error'); return; }

  const pasta = await pastaMateriais();
  if (!pasta) { toast('Crie ou selecione uma matéria primeiro.', 'error'); return; }

  const btn = document.getElementById('materiais-enviar-btn');
  btn.disabled = true;
  let enviados = 0;

  for (const [i, arquivo] of arquivos.entries()) {
    status.textContent = `Enviando ${i + 1} de ${arquivos.length}...`;
    if (arquivo.size > MATERIAIS_MAX_BYTES) {
      toast(`"${arquivo.name}" passa de 50 MB.`, 'error');
      continue;
    }
    const caminho = `${pasta}/${nomeArquivoSeguro(arquivo.name)}`;
    // upsert:false de propósito: sobrescrever em silêncio faria perder a versão
    // anterior sem o usuário perceber.
    const { error } = await sb.storage
      .from(MATERIAIS_BUCKET)
      .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || undefined });
    if (error) {
      const dup = /exists/i.test(error.message);
      toast(dup ? `Já existe um arquivo chamado "${arquivo.name}".` : error.message, 'error');
      continue;
    }
    enviados += 1;
  }

  btn.disabled = false;
  status.textContent = '';
  input.value = '';
  if (enviados > 0) toast(`${enviados} arquivo(s) enviado(s).`);
  await carregarMateriais();
});
