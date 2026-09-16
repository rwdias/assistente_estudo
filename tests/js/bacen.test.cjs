const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/js/bacen.js'), 'utf8');

function fixture() {
  const context = vm.createContext({ Estado: { materias: [] }, esc: String });
  vm.runInContext(source, context);
  const groups = vm.runInContext('BACEN_GRUPOS', context);
  let id = 0;
  const items = [];
  for (const g of groups) for (const nome of g.materias) {
    const materia = { id: ++id, nome, trilha_nome: 'BACEN — Analista TI — Teste' };
    context.Estado.materias.push(materia);
    for (let j = 0; j < 100; j++) items.push({ id: id * 1000 + j, materia_id: id, tipo: j % 2 ? 'flashcard' : 'pergunta', oculta: false });
  }
  return { context, items, groups };
}

test('120 itens seguem exatamente o edital agregado, sem duplicação', () => {
  const { context, items } = fixture();
  const result = context.selecionarBacen(items, 120);
  assert.deepEqual(Array.from(result.grupos, g => g.selecionados), [25, 10, 5, 10, 18, 24, 24, 4]);
  assert.equal(result.itens.length, 120);
  assert.equal(new Set(result.itens.map(p => p.id)).size, 120);
});

test('mantém proporções em sessões menores com arredondamento', () => {
  const { context, items, groups } = fixture();
  const result = context.selecionarBacen(items, 37);
  assert.equal(result.itens.length, 37);
  result.grupos.forEach((g, i) => assert.ok(Math.abs(g.selecionados - groups[i].peso * 37 / 120) < 1));
});

test('redistribui falta de conteúdo e termina mesmo com banco vazio', () => {
  const { context, items } = fixture();
  const few = items.filter(p => p.materia_id === 1).slice(0, 3).concat(items.filter(p => p.materia_id === 2));
  const result = context.selecionarBacen(few, 20);
  assert.equal(result.itens.length, 20);
  assert.equal(result.grupos[0].selecionados, 3);
  assert.equal(result.grupos[1].selecionados, 17);
  assert.equal(context.selecionarBacen([], 120).itens.length, 0);
  assert.equal(context.selecionarBacen(few.slice(0, 2), 120).itens.length, 2);
});

test('não inclui ocultos, exercícios, discursivas, duplicados ou outras trilhas', () => {
  const { context, items } = fixture();
  context.Estado.materias.push({ id: 999, nome: 'Língua Portuguesa', trilha_nome: 'Outro concurso' });
  context.Estado.materias.push({ id: 998, nome: 'Discursivas sem correção', trilha_nome: 'BACEN — Analista TI — Prova discursiva' });
  const input = [items[0], items[0], { ...items[1], oculta: true }, { ...items[2], tipo: 'exercicio' },
    { ...items[3], materia_id: 999 }, { ...items[4], materia_id: 998 }];
  assert.deepEqual(Array.from(context.selecionarBacen(input).itens, p => p.id), [items[0].id]);
});

test('divide o grupo Software igualmente entre as matérias e mistura a ordem', () => {
  const { context, items } = fixture();
  const result = context.selecionarBacen(items, 120);
  const software = result.grupos[5];
  const ids = context.Estado.materias.filter(m => software.materias.includes(m.nome)).map(m => m.id);
  for (const id of ids) assert.equal(result.itens.filter(p => p.materia_id === id).length, 12);
  const other = context.selecionarBacen(items, 120);
  assert.notDeepEqual(Array.from(result.itens, p => p.id), Array.from(other.itens, p => p.id));
});

test('paginação busca todos os itens e preserva a matéria de origem', async () => {
  const { context } = fixture();
  context.Estado.materias = context.Estado.materias.slice(0, 1);
  const ranges = [];
  context.SELECT_PERGUNTA = 'test';
  context.normalizarPergunta = p => p;
  context.sb = { from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; },
    async range(start, end) { ranges.push([start, end]); return { data: Array.from({ length: start === 0 ? 500 : 2 }, (_, i) => ({ id: start + i, materia_id: 1 })) }; },
  }) };
  const items = await context.buscarItensBacen();
  assert.equal(items.length, 502);
  assert.deepEqual(ranges, [[0, 499], [500, 999]]);
  assert.equal(items[0].origem_nome, 'Língua Portuguesa');
});
