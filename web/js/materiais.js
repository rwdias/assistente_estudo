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

  // Metadados (título/autores) vivem na tabela `materiais`; o arquivo, no
  // bucket. A lista é montada pelo STORAGE e só enriquecida pela tabela — assim
  // um arquivo sem metadados (upload antigo, PDF ilegível) continua aparecendo.
  const { data: metas } = await sb
    .from('materiais')
    .select('caminho, titulo, autores, ano, editora, edicao, descricao')
    .eq('materia_id', Estado.materiaId);
  const porCaminho = new Map((metas || []).map((m) => [m.caminho, m]));

  const ICONE_ABRIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  alvo.innerHTML = arquivos
    .map((f) => {
      const meta = porCaminho.get(`${pasta}/${f.name}`);
      const temTitulo = Boolean(meta?.titulo);
      // Com metadados, o título vira o destaque e o nome do arquivo desce para
      // a linha de apoio — é assim que se reconhece um livro numa estante.
      const ficha = [
        (meta?.autores || []).join(', '),
        meta?.editora,
        meta?.edicao,
        meta?.ano,
      ].filter(Boolean).map((x) => `<span>${esc(String(x))}</span>`).join('');

      return `
      <div class="pergunta-card material-item" data-nome="${esc(f.name)}">
        <div style="display:flex; align-items:flex-start; gap:12px">
          <div style="flex:1; min-width:0">
            <div class="pergunta-enunciado" style="word-break:break-word">${esc(temTitulo ? meta.titulo : f.name)}</div>
            <div class="pergunta-meta">
              ${ficha}
              <span>${esc(formatarTamanho(f.metadata?.size))}</span>
              ${f.created_at ? `<span>${new Date(f.created_at).toLocaleDateString('pt-BR')}</span>` : ''}
            </div>
            ${temTitulo ? `<div class="pergunta-meta"><span class="material-arquivo">${esc(f.name)}</span></div>` : ''}
          </div>
          <button type="button" class="btn btn-secondary btn-sm material-abrir">${ICONE_ABRIR} Abrir</button>
          ${renderMenuItemHTML([
            { acao: 'metadados', rotulo: temTitulo ? 'Reler dados do PDF' : 'Ler dados do PDF', icone: ICONE_VARIANTE_MENU },
            { acao: 'excluir', rotulo: 'Excluir arquivo', icone: ICONE_LIXEIRA, perigo: true },
          ])}
        </div>
      </div>`;
    })
    .join('');

  alvo.querySelectorAll('.material-item').forEach((item) => {
    const nome = item.dataset.nome;
    const meta = porCaminho.get(`${pasta}/${nome}`);
    item.querySelector('.material-abrir').addEventListener('click', () => {
      // PDF abre no leitor embutido (dá para selecionar texto e virar flashcard);
      // outros formatos, que o leitor não renderiza, vão para uma aba nova.
      if (/\.pdf$/i.test(nome)) abrirLeitor(`${pasta}/${nome}`, nome, meta?.titulo);
      else abrirMaterial(pasta, nome);
    });
    wireMenuItem(item, (acao) => {
      if (acao === 'excluir') excluirMaterial(pasta, nome);
      else if (acao === 'metadados') lerMetadados(`${pasta}/${nome}`, nome, true);
    });
  });
}

// Lê título/autores/editora das primeiras páginas do PDF (Edge Function) e grava
// na tabela. `avisar` controla o toast: no upload em lote o processo é silencioso
// (só o resultado final importa); pelo menu, o usuário espera retorno.
async function lerMetadados(caminho, nome, avisar = false) {
  if (!/\.pdf$/i.test(nome)) {
    if (avisar) toast('Só PDF tem metadados legíveis.', 'error');
    return false;
  }
  if (avisar) toast('Lendo as primeiras páginas...');

  const { data, error } = await sb.functions.invoke('metadados_material', {
    body: { caminho, modelo: 'ChatGPT' },
  });
  if (error) {
    if (avisar) toast(await mensagemErroFuncao(error), 'error');
    return false;
  }

  const m = data?.metadados || {};
  // Sem título não vale gravar: seria uma linha vazia atrapalhando a lista.
  if (!m.titulo) {
    if (avisar) toast('Não encontrei os dados nas primeiras páginas.', 'error');
    return false;
  }

  const { error: erroGravar } = await sb.from('materiais').upsert({
    // usuario_id vai explícito porque faz parte da chave do ON CONFLICT —
    // deixar para o default do banco funcionaria no insert, mas o upsert precisa
    // do valor para casar a linha existente. Vem do próprio caminho.
    usuario_id: caminho.split('/')[0],
    materia_id: Estado.materiaId,
    caminho,
    nome_arquivo: nome,
    titulo: m.titulo,
    autores: Array.isArray(m.autores) ? m.autores : [],
    ano: m.ano ?? null,
    editora: m.editora ?? null,
    edicao: m.edicao ?? null,
    isbn: m.isbn ?? null,
    idioma: m.idioma ?? null,
    descricao: m.descricao ?? null,
    origem: 'ia',
  }, { onConflict: 'usuario_id,caminho' });

  if (erroGravar) {
    if (avisar) toast(erroGravar.message, 'error');
    return false;
  }
  if (avisar) toast(`Identificado: ${m.titulo}`);
  return true;
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
  const caminho = `${pasta}/${nome}`;
  const { error } = await sb.storage.from(MATERIAIS_BUCKET).remove([caminho]);
  if (error) { toast(error.message, 'error'); return; }
  // A linha de metadados não some sozinha (Storage e Postgres são mundos
  // separados) — apagar aqui evita ficha órfã apontando para arquivo inexistente.
  await sb.from('materiais').delete().eq('caminho', caminho);
  toast('Arquivo excluído.');
  await carregarMateriais();
}

// Baixar de um link: quem busca é a Edge Function `baixar_material` (o navegador
// seria barrado por CORS na maioria dos sites, e o servidor ainda valida o
// destino contra SSRF). Depois lê os metadados como num upload normal.
document.getElementById('materiais-baixar-btn')?.addEventListener('click', async () => {
  const campo = document.getElementById('materiais-url');
  const status = document.getElementById('materiais-status');
  const url = campo.value.trim();
  if (!url) { toast('Cole um link primeiro.', 'error'); return; }
  if (!Estado.materiaId) { toast('Crie ou selecione uma matéria primeiro.', 'error'); return; }

  const btn = document.getElementById('materiais-baixar-btn');
  btn.disabled = true;
  status.textContent = 'Baixando do link...';

  const { data, error } = await sb.functions.invoke('baixar_material', {
    body: { url, materia_id: Estado.materiaId },
  });

  if (error) {
    btn.disabled = false;
    status.textContent = '';
    toast(await mensagemErroFuncao(error), 'error');
    return;
  }

  status.textContent = 'Lendo os dados do PDF...';
  await lerMetadados(data.caminho, data.nome);

  btn.disabled = false;
  status.textContent = '';
  campo.value = '';
  toast(`"${data.nome}" adicionado.`);
  await carregarMateriais();
});

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
  let semDados = 0; // PDFs que subiram mas não tiveram os dados identificados

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

    // Logo após subir, tenta identificar o material pelas primeiras páginas.
    // A falha aqui (PDF digitalizado, quota, erro do provedor) NÃO desfaz o
    // upload — mas também não pode passar batida, senão o usuário fica achando
    // que a leitura simplesmente não existe. Conta e avisa no fim.
    if (/\.pdf$/i.test(caminho)) {
      status.textContent = `Lendo os dados de ${i + 1} de ${arquivos.length}...`;
      if (!(await lerMetadados(caminho, caminho.split('/').pop()))) semDados += 1;
    }
  }

  btn.disabled = false;
  status.textContent = '';
  input.value = '';
  if (enviados > 0) toast(`${enviados} arquivo(s) enviado(s).`);
  if (semDados > 0) {
    toast(
      `${semDados} PDF(s) sem dados identificados — use "Ler dados do PDF" no menu.`,
      'error',
    );
  }
  await carregarMateriais();
});
