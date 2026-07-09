# Layout de Painel Admin (SPA leve, sem framework)

Template extraído do painel admin da RW Analytics (`admin/`). Stack: HTML puro + CSS puro + JS vanilla, sem build step, sem framework. Um único `index.html` com todos os "painéis" (telas) escondidos via CSS, navegação trocando classes — SPA sem router nem bundler.

## Quando usar

Painéis internos (admin, dashboard interno, CRM simples) para uma pessoa ou time pequeno, servidos por um backend que já cuida de autenticação. Não é adequado para produto público/multi-tenant complexo — não tem roteamento por URL (tudo é `#` implícito via JS), então back/forward do navegador não navega entre telas.

## Estrutura de arquivos

```
admin/
├── index.html          # só o markup (shell): sidebar + main + panels + modais
├── css/
│   └── admin.css       # todo o CSS
└── js/
    ├── core.js          # API helper, navegação (goPanel), sidebar toggle,
    │                     # toast, modal, kebab menu, formatBRL/formatDate, esc()
    ├── <dominio-1>.js    # CRUD e render de cada domínio (ex: clientes.js)
    ├── <dominio-2>.js
    └── dashboard.js      # chama initApp() no final (carrega os dados iniciais)
```

Os módulos JS compartilham escopo global (sem import/export) e são carregados em ordem por `<script>` no fim do `<body>`: `core → domínio 1 → domínio 2 → ... → dashboard`. Funções usadas em `onclick="..."` no HTML **precisam ficar globais** (não dentro de closures/IIFE). `initApp()` (ou equivalente) deve ser chamado no fim do último script, porque hoisting de função não cruza arquivos — se `dashboard.js` roda antes de `clientes.js` estar carregado, quebra.

## HTML — esqueleto

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Painel Admin</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="css/admin.css"/>
</head>
<body>

<div id="app">

  <!-- SIDEBAR -->
  <aside class="sidebar" id="sidebar">
    <a href="/" class="sb-logo" target="_blank">
      <img src="logo.svg" alt="Logo" />
      <span class="sb-logo-text">Nome <span>Produto</span></span>
      <span class="sb-badge">ADMIN</span>
    </a>

    <nav class="sb-nav">
      <!-- item de nível único -->
      <a class="sb-item active" data-panel="dashboard">
        <svg class="sb-ico" viewBox="0 0 24 24" ...><!-- ícone --></svg>
        <span>Dashboard</span>
      </a>

      <!-- grupo colapsável (accordion) -->
      <div class="sb-group">
        <button type="button" class="sb-group-header">
          <svg class="sb-ico" viewBox="0 0 24 24" ...><!-- ícone --></svg>
          <span class="sb-group-title">Clientes</span>
          <svg class="sb-caret" viewBox="0 0 24 24" ...><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="sb-submenu">
          <a class="sb-item" data-panel="clientes-list"><span>Lista</span><span class="badge-count" id="sb-count-clientes">0</span></a>
          <a class="sb-item" data-panel="cliente-novo"><span>Novo</span></a>
        </div>
      </div>
    </nav>

    <div class="sb-footer">
      <div class="sb-user">
        <div class="sb-avatar">R</div>
        <div class="sb-user-info">
          <div class="sb-user-name">Nome do usuário</div>
          <div class="sb-user-role">Administrador</div>
        </div>
        <button class="sb-logout" id="logout-btn" title="Sair">
          <svg viewBox="0 0 24 24" ...><!-- ícone logout --></svg>
        </button>
      </div>
    </div>
  </aside>

  <!-- MAIN -->
  <main class="main">
    <div class="topbar">
      <button type="button" class="sb-toggle-btn" id="sidebar-toggle-btn" title="Expandir/recolher menu">
        <svg viewBox="0 0 24 24" ...><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
      </button>
      <div>
        <div class="topbar-title" id="topbar-title">Dashboard</div>
        <div class="topbar-breadcrumb">Produto / <span id="topbar-sub">Visão geral</span></div>
      </div>
    </div>

    <div class="content">
      <!-- cada tela é um .panel, só o .panel.active aparece -->
      <div class="panel active" id="panel-dashboard">...</div>
      <div class="panel" id="panel-clientes-list">...</div>
      <div class="panel" id="panel-cliente-novo">...</div>
    </div>
  </main>
</div>

<!-- MODAL padrão de confirmação (reaproveitável) -->
<div class="modal-overlay" id="modal-delete">
  <div class="modal">
    <h3>Confirmar exclusão</h3>
    <p id="modal-delete-msg">Tem certeza? Esta ação não pode ser desfeita.</p>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('modal-delete')">Cancelar</button>
      <button class="btn btn-danger" id="modal-delete-confirm">Excluir</button>
    </div>
  </div>
</div>

<div id="toast-container"></div>

<script src="js/core.js"></script>
<script src="js/clientes.js"></script>
<script src="js/dashboard.js"></script>
</body>
</html>
```

## CSS — design tokens

```css
:root {
  --blue: #1a56db; --blue-dark: #1245b8; --blue-light: #eff4ff;
  --slate-900: #0f172a; --slate-700: #334155; --slate-600: #475569;
  --slate-500: #64748b; --slate-400: #94a3b8; --slate-200: #e2e8f0;
  --slate-100: #f1f5f9; --slate-50: #f8fafc; --white: #ffffff;
  --green: #16a34a; --green-light: #dcfce7;
  --red: #dc2626; --red-light: #fef2f2;
  --amber: #d97706; --amber-light: #fef3c7;
  --purple: #7c3aed; --purple-light: #ede9fe;
  --radius: 12px; --radius-sm: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06);
  --shadow-md: 0 4px 16px rgba(0,0,0,.10);
  --shadow-lg: 0 20px 60px rgba(0,0,0,.12);
  --sidebar-w: 248px;
  --sidebar-w-rail: 72px;
  --sidebar-bg: var(--slate-600); /* cor neutra por padrão — trocar pela cor de marca se quiser mais identidade */
}
```

Ajuste só as cores (`--blue`, `--sidebar-bg`) para a identidade do projeto; o resto (espaçamentos, raios, sombras) é neutro o suficiente para reaproveitar direto.

### Densidade (opcional)

```css
body { zoom: 0.8; font-family: 'Inter', sans-serif; background: var(--slate-100); color: var(--slate-900); }
#app { min-height: calc(100vh / 0.8); }
.main { min-height: calc(100vh / 0.8); }
```

`zoom: 0.8` no `body` deixa a UI mais compacta (padrão "enterprise", cabe mais informação sem scroll) — é o único jeito simples de escalar tudo (fontes, paddings, ícones) sem reescrever cada valor. Efeito colateral: qualquer cálculo de posição em JS que use `getBoundingClientRect()` (menus flutuantes, tooltips) devolve pixels do viewport real e precisa ser **dividido pelo fator de zoom** para converter para o "espaço" em que o CSS está posicionando (ver seção do kebab menu abaixo). Se não quiser lidar com isso, remova o `zoom` e use tamanhos de fonte/padding normais.

### Sidebar — rail colapsável + pin

Comportamento: recolhida por padrão (só ícones, `--sidebar-w-rail`), expande no `:hover`, ou fica fixa expandida com a classe `.pinned` (alternada por um botão no topbar, preferência salva em `localStorage`).

```css
.sidebar {
  position: fixed; top: 0; left: 0; bottom: 0;
  width: var(--sidebar-w-rail);
  background: var(--sidebar-bg);
  display: flex; flex-direction: column;
  z-index: 100; overflow: hidden;
  transition: width .16s ease;
}
.sidebar:not(.pinned):hover,
.sidebar.pinned { width: var(--sidebar-w); }

/* textos só aparecem expandida */
.sb-logo-text, .sb-badge, .sb-item span, .sb-group-title, .sb-caret, .sb-user-info {
  opacity: 1; max-width: 180px; overflow: hidden; white-space: nowrap;
  transition: opacity .1s ease, max-width .16s ease;
}
.sidebar:not(.pinned):not(:hover) .sb-logo-text,
.sidebar:not(.pinned):not(:hover) .sb-badge,
.sidebar:not(.pinned):not(:hover) .sb-item span,
.sidebar:not(.pinned):not(:hover) .sb-group-title,
.sidebar:not(.pinned):not(:hover) .sb-caret,
.sidebar:not(.pinned):not(:hover) .sb-user-info { opacity: 0; max-width: 0; margin: 0; }
.sidebar:not(.pinned):not(:hover) .sb-item,
.sidebar:not(.pinned):not(:hover) .sb-group-header { gap: 0; justify-content: center; }
.sidebar:not(.pinned):not(:hover) .sb-logout { display: none; }
.sidebar:not(.pinned):not(:hover) .sb-user { justify-content: center; padding: 8px 0; }

.sb-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 8px; cursor: pointer;
  transition: background .15s, color .15s;
  color: rgba(255,255,255,.7); font-size: .88rem; font-weight: 500;
}
.sb-item svg { width: 17px; height: 17px; flex-shrink: 0; }
.sb-item:hover { background: rgba(255,255,255,.1); color: white; }
.sb-item.active { background: rgba(26,86,219,.4); color: white; }

/* grupo colapsável (accordion) dentro da sidebar */
.sb-group-header {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 10px 12px; border: none; background: transparent; cursor: pointer;
  color: rgba(255,255,255,.7); font: inherit; font-size: .9rem; font-weight: 600;
  border-radius: 8px; text-align: left;
}
.sb-caret { width: 15px; height: 15px; opacity: .55; transition: transform .18s ease; }
.sb-group.open > .sb-group-header .sb-caret { transform: rotate(90deg); }
.sb-submenu {
  display: none; margin: 2px 0 6px 15px; padding-left: 11px;
  border-left: 1px solid rgba(255,255,255,.1);
}
.sb-group:hover .sb-submenu, .sb-group.open .sb-submenu { display: block; }

/* MAIN acompanha a largura da sidebar */
.main {
  margin-left: var(--sidebar-w-rail);
  transition: margin-left .16s ease;
}
#sidebar.pinned ~ .main { margin-left: var(--sidebar-w); }

.topbar {
  background: white; border-bottom: 1px solid var(--slate-200);
  padding: 0 32px; height: 62px;
  display: flex; align-items: center; gap: 16px;
  position: sticky; top: 0; z-index: 50;
}
.content { flex: 1; padding: 32px; }
```

### Panels (troca de tela)

```css
.panel { display: none; }
.panel.active { display: block; }
```

### Cards, botões, tabela, empty state, badges (blocos reutilizáveis)

```css
.card { background: white; border-radius: var(--radius); border: 1px solid var(--slate-200); box-shadow: var(--shadow); }
.card-header { padding: 20px 24px 0; display: flex; align-items: center; justify-content: space-between; }
.card-title { font-size: 1rem; font-weight: 700; color: var(--slate-900); }
.card-body { padding: 20px 24px 24px; }

.btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 18px; border-radius: 8px; font-size: .88rem; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.btn-primary { background: var(--blue); color: white; }
.btn-primary:hover { background: var(--blue-dark); transform: translateY(-1px); }
.btn-secondary { background: transparent; color: var(--slate-600); border: 1px solid var(--slate-200); }
.btn-danger { background: var(--red-light); color: var(--red); }
.btn-sm { padding: 6px 12px; font-size: .8rem; }

table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: .75rem; font-weight: 700; color: var(--slate-500); text-transform: uppercase; letter-spacing: .05em; padding: 10px 14px; background: var(--slate-50); border-bottom: 1px solid var(--slate-200); }
td { padding: 13px 14px; font-size: .88rem; border-bottom: 1px solid var(--slate-100); }
tr:hover td { background: var(--slate-50); }

.empty-state { text-align: center; padding: 56px 24px; }
.empty-icon { width: 56px; height: 56px; border-radius: 16px; background: var(--slate-100); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }

.badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 20px; font-size: .72rem; font-weight: 700; }
.badge-blue { background: var(--blue-light); color: var(--blue); }
.badge-green { background: var(--green-light); color: var(--green); }
.badge-red { background: var(--red-light); color: var(--red); }
```

### Menu "⋯" (kebab) por linha de tabela

```css
.kebab-btn { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid transparent; border-radius: 8px; color: var(--slate-500); cursor: pointer; font-size: 1.15rem; font-weight: 800; }
.kebab-btn:hover { background: var(--slate-100); border-color: var(--slate-200); color: var(--slate-900); }
.kebab-menu { position: fixed; z-index: 900; min-width: 180px; background: white; border: 1px solid var(--slate-200); border-radius: 10px; box-shadow: 0 10px 28px rgba(15,23,42,.14); padding: 6px; }
.kebab-item { display: block; width: 100%; text-align: left; padding: 9px 12px; background: transparent; border: 0; border-radius: 7px; font-size: .85rem; font-weight: 500; color: var(--slate-700); cursor: pointer; }
.kebab-item:hover { background: var(--slate-100); }
.kebab-item.danger { color: var(--red); }
```

### Modal e toast

```css
.modal-overlay { display: none; position: fixed; inset: 0; background: rgba(15,23,42,.5); z-index: 500; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.modal-overlay.open { display: flex; }
.modal { background: white; border-radius: 16px; padding: 32px; width: 100%; max-width: 480px; margin: 24px; box-shadow: var(--shadow-lg); }

#toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 900; display: flex; flex-direction: column; gap: 10px; }
.toast { display: flex; align-items: center; gap: 12px; background: var(--slate-900); color: white; padding: 12px 18px; border-radius: 10px; box-shadow: var(--shadow-md); font-size: .88rem; font-weight: 500; animation: slideIn .25s ease; min-width: 280px; }
.toast-success { border-left: 3px solid var(--green); }
.toast-error { border-left: 3px solid var(--red); }
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
```

### Print (para telas que geram PDF, ex: propostas/contratos)

```css
@media print {
  .sidebar, .topbar, .no-print { display: none !important; }
  .main { margin-left: 0 !important; }
  body { background: white; }
}
```

## JS — padrões (core.js)

### Navegação entre panels (SPA sem router)

```js
const panelMeta = {
  'dashboard': { title: 'Dashboard', sub: 'Visão geral' },
  'clientes-list': { title: 'Clientes', sub: 'Lista de clientes' },
  // ... um registro por panel
};

function goPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));

  document.getElementById('panel-' + id)?.classList.add('active');
  document.querySelector(`.sb-item[data-panel="${id}"]`)?.classList.add('active');

  const meta = panelMeta[id] || { title: id, sub: '' };
  document.getElementById('topbar-title').textContent = meta.title;
  document.getElementById('topbar-sub').textContent = meta.sub;

  // hook por panel: carregar/renderizar dados ao entrar na tela
  if (id === 'clientes-list') renderClientesTable();
  if (id === 'cliente-novo') resetClienteForm();

  window.scrollTo(0, 0);
}

document.querySelectorAll('.sb-item').forEach(item => {
  item.addEventListener('click', () => goPanel(item.dataset.panel));
});
```

Botões fora da sidebar (ex: "Ver todos" num card do dashboard) chamam `goPanel('clientes-list')` direto via `onclick`.

### Sidebar toggle (pin) com persistência

```js
(function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle-btn');
  if (!sidebar || !btn) return;
  if (localStorage.getItem('sidebarPinned') === '1') sidebar.classList.add('pinned');
  btn.addEventListener('click', () => {
    const pinned = sidebar.classList.toggle('pinned');
    localStorage.setItem('sidebarPinned', pinned ? '1' : '0');
  });
})();
```

### Grupos colapsáveis da sidebar (accordion)

```js
document.querySelectorAll('.sb-group-header').forEach(header => {
  header.addEventListener('click', () => {
    const group = header.closest('.sb-group');
    const open = group.classList.contains('open');
    document.querySelectorAll('.sb-group').forEach(g => g.classList.remove('open'));
    if (!open) group.classList.add('open');
  });
});
document.querySelectorAll('.sb-submenu .sb-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.sb-group').forEach(g => g.classList.remove('open'));
    item.closest('.sb-group')?.classList.add('open');
  });
});
```

### Kebab menu (ações por linha de tabela)

Problema que resolve: `onclick` inline não aceita objetos/funções como argumento, só strings. A solução é guardar os itens de menu (com closures) num array em memória e passar só o índice pro `onclick`.

```js
let _kebabItems = [];
let _kebabOpen = null;

// uso: `<td>${kebabMenu([{ label: 'Editar', fn: () => editCliente(id) }, { label: 'Excluir', danger: true, fn: () => excluirCliente(id) }])}</td>`
function kebabMenu(items) {
  const idx = _kebabItems.push(items) - 1;
  return `<button type="button" class="kebab-btn" title="Ações" onclick="openKebab(event, ${idx})">&hellip;</button>`;
}

function openKebab(ev, idx) {
  ev.stopPropagation();
  const jaAberto = _kebabOpen && _kebabOpen.idx === idx;
  closeKebab();
  if (jaAberto) return;
  const items = _kebabItems[idx] || [];
  const menu = document.createElement('div');
  menu.className = 'kebab-menu';
  menu.innerHTML = items.map((it, i) => it.sep
    ? '<div class="kebab-sep"></div>'
    : `<button type="button" class="kebab-item${it.danger ? ' danger' : ''}" data-i="${i}">${it.label}</button>`
  ).join('');
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('.kebab-item');
    if (!b) return;
    closeKebab();
    items[+b.dataset.i].fn();
  });
  document.body.appendChild(menu);

  // Posiciona "fixed" colado ao botão, abre pra cima se não couber embaixo.
  // Se o body tiver `zoom` aplicado (densidade), getBoundingClientRect() devolve
  // px do viewport real — divide-se pelo fator pra casar com o espaço do zoom.
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const r = ev.currentTarget.getBoundingClientRect();
  const right = r.right / z, bottom = r.bottom / z, top = r.top / z;
  const vh = window.innerHeight / z;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, right - mw) + 'px';
  menu.style.top = (bottom + mh + 8 > vh ? top - mh - 4 : bottom + 4) + 'px';
  _kebabOpen = { idx, el: menu };
}
function closeKebab() {
  if (_kebabOpen) { _kebabOpen.el.remove(); _kebabOpen = null; }
}
document.addEventListener('click', closeKebab);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeKebab(); });
window.addEventListener('scroll', closeKebab, true);
```

Se o projeto novo **não** usar `zoom` no body, remova a divisão por `z` (fica `getBoundingClientRect()` puro).

### Toast e modal

```js
function toast(msg, type = 'success') {
  const icon = type === 'success'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = icon + '<span>' + msg + '</span>';
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});
```

### Helpers de formatação e segurança XSS

```js
function formatBRL(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatDate(iso) {
  if (!iso) return '—';
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR');
}
// SEMPRE usar antes de injetar texto do usuário via innerHTML (nome, obs, etc.)
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
```

### API helper mínimo (fetch + sessão via cookie)

```js
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  if (method === 'DELETE') return {};
  return r.json();
}
```

## Checklist para reproduzir em outro projeto

1. Copiar `admin.css` inteiro (design tokens + blocos genéricos: sidebar/topbar/card/btn/table/kebab/modal/toast/empty-state).
2. Trocar `--blue` e `--sidebar-bg` pela cor de marca do novo projeto (ou manter neutro).
3. Copiar `core.js` inteiro (navegação, sidebar toggle, kebab, toast, modal, `esc()`, `formatBRL/formatDate`, `api()`).
4. Montar `index.html`: 1 `<a class="sb-item" data-panel="...">` ou `<div class="sb-group">` por seção do menu, 1 `<div class="panel" id="panel-...">` por tela, registrar cada um em `panelMeta` no `core.js`.
5. Criar um `.js` por domínio (CRUD + função `renderXTable()`/`resetXForm()`), sempre com funções **globais** (sem IIFE) se forem chamadas via `onclick`.
6. Carregar os `<script>` em ordem: `core → domínio(s) → dashboard` (o último chama `initApp()` ou equivalente no final do arquivo).
7. Decidir se quer `zoom: 0.8` (mais denso) — se sim, lembrar de dividir por `z` em qualquer cálculo de posição via `getBoundingClientRect()`.
8. Servir tudo atrás de autenticação/sessão no backend (esse template não inclui login).
