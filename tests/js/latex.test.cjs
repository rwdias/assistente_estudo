const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'web/js/core.js'), 'utf8');
const context = vm.createContext({
  esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
});
vm.runInContext(fs.readFileSync(path.join(root, 'web/js/vendor/temml.min.js'), 'utf8'), context);
vm.runInContext(core.slice(core.indexOf('function normalizarLatex'), core.indexOf('// Chip com a origem')), context);

test('recupera os escapes JSON observados nos cartões de lógica e indução', () => {
  const original = 'Símbolos: $\neg$, $\bigwedge$, $\bigvee$, $\to$, $\rightleftarrows$; ${\textstyle \frac{n(n-1)(n+1)}{3}}$ e $a \times x$.';
  const expected = 'Símbolos: $\\neg$, $\\bigwedge$, $\\bigvee$, $\\to$, $\\rightleftarrows$; ${\\textstyle \\frac{n(n-1)(n+1)}{3}}$ e $a \\times x$.';
  assert.equal(context.prepararTextoMatematico(original), expected);
  const html = context.formatarTexto(original, { math: true });
  assert.match(html, /<math/);
  assert.doesNotMatch(html, /ParseError|temml-error|\u0008|\u000c/);
});

test('recupera CR normalizado para LF pelo textarea e mantém comandos válidos', () => {
  assert.equal(context.prepararTextoMatematico('$\nightleftarrows$'), String.raw`$\rightleftarrows$`);
  const valid = String.raw`$\neg p \to q$, $\frac{a}{b}$ e $\text{em } X$.`;
  assert.equal(context.prepararTextoMatematico(valid), valid);
});

test('preserva quebras de linha e tabulação fora das fórmulas', () => {
  const prose = 'Linha um\nLinha dois\nnegativo\n\ttexto\n$P(n)$';
  assert.equal(context.normalizarLatex(prose), prose);
  assert.equal(context.prepararTextoMatematico('$$a +\nb$$'), '$$a +\nb$$');
  assert.equal(context.prepararTextoMatematico('$$a +\ne +\nu$$'), '$$a +\ne +\nu$$');
});

test('recusa comandos desconhecidos, frações incompletas e delimitadores abertos', () => {
  for (const text of [String.raw`$\comandoInexistente$`, String.raw`$\frac{1}$`, 'Fórmula $x + 1', '$$x + 1$', '$\u0008desconhecido$']) {
    assert.throws(() => context.prepararTextoMatematico(text), /inválid|incompleta/);
  }
});

test('renderiza delimitadores alternativos e não ativa matemática em matérias normais', () => {
  assert.match(context.formatarTexto(String.raw`\(\frac{1}{2}\) e \[x^2\]`, { math: true }), /<math/);
  assert.doesNotMatch(context.formatarTexto('$x$', { math: false }), /<math/);
});

test('mantém HTML e comandos de links não confiáveis inertes', () => {
  const html = context.formatarTexto(String.raw`<img src=x onerror=alert(1)> $\href{javascript:alert(1)}{x}$`, { math: true });
  assert.doesNotMatch(html, /<img|href="javascript:|<script/);
  assert.match(html, /&lt;img/);
});

test('não grava nem cria tópico quando a fórmula é inválida', async () => {
  let writes = 0;
  context.materiaEhMatematica = () => true;
  context.garantirSubdivisao = async () => { writes++; return 1; };
  context.sb = { from() { writes++; throw new Error('Não deveria gravar'); } };
  const perguntas = fs.readFileSync(path.join(root, 'web/js/perguntas.js'), 'utf8');
  vm.runInContext(perguntas.slice(perguntas.indexOf('async function inserirPergunta'), perguntas.indexOf("document.getElementById('form-novo-flashcard')")), context);
  await assert.rejects(context.inserirPergunta(86, { enunciado: 'Frente', verso: String.raw`$\frac{1}$` }), /inválida/);
  assert.equal(writes, 0);
});
