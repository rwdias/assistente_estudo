const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/js/cronometro.js'), 'utf8');
const context = vm.createContext({ crypto, document: { getElementById: () => ({ addEventListener() {} }), addEventListener() {} }, window: { addEventListener() {} } });
vm.runInContext(source, context);

test('tempo livre conta relógio real e exclui pausas', () => {
  const s = context.novoEstadoTempo();
  s.rodando = true;
  context.iniciarSegmentoTempo(s, 1000, 86);
  context.avancarTempo(s, 61000);
  assert.equal(s.decorrido, 60000);
  s.rodando = false;
  context.avancarTempo(s, 121000);
  assert.equal(s.decorrido, 60000);
  s.rodando = true;
  context.iniciarSegmentoTempo(s, 121000, 86);
  context.avancarTempo(s, 151000);
  assert.equal(s.decorrido, 90000);
  assert.equal(Object.values(s.pendentes).reduce((n, p) => n + p.fim-p.inicio, 0), 90000);
});
test('Pomodoro recuperado depois de horas conta apenas o foco e aguarda pausa', () => {
  const s = { ...context.novoEstadoTempo(), preset: '25', restante: 25*60000, rodando: true };
  context.iniciarSegmentoTempo(s, 1000, 86);
  context.avancarTempo(s, 1000 + 3*3600000);
  assert.equal(s.decorrido, 25*60000);
  assert.equal(s.rodando, false);
  assert.equal(s.fase, 'pausa');
  assert.equal(s.restante, 5*60000);
  s.rodando = true;
  context.iniciarSegmentoTempo(s, 12000000, 86);
  context.avancarTempo(s, 12300000);
  assert.equal(s.decorrido, 25*60000);
  assert.equal(s.fase, 'estudo');
  assert.equal(s.rodando, false);
});
test('troca de matéria divide o tempo sem duplicar segundos', () => {
  const s = { ...context.novoEstadoTempo(), rodando: true };
  context.iniciarSegmentoTempo(s, 1000, 86);
  context.avancarTempo(s, 31000);
  context.iniciarSegmentoTempo(s, 31000, 87);
  context.avancarTempo(s, 51000);
  const parts = Object.values(s.pendentes);
  assert.deepEqual(parts.map(p => [p.materia_id,p.fim-p.inicio]), [[86,30000],[87,20000]]);
});
test('checkpoints repetidos e restauração não duplicam tempo', () => {
  let s = { ...context.novoEstadoTempo(), rodando: true };
  context.iniciarSegmentoTempo(s, 1000, 86);
  context.avancarTempo(s, 16000);
  s = JSON.parse(JSON.stringify(s));
  context.avancarTempo(s, 31000);
  context.avancarTempo(s, 31000);
  assert.equal(s.decorrido, 30000);
  assert.equal(Object.keys(s.pendentes).length, 1);
  assert.equal(Object.values(s.pendentes)[0].fim, 31000);
});
test('agrega trilhas BACEN e mantém faculdade separada', () => {
  assert.equal(context.grupoTempo({trilha_nome:'BACEN — Analista TI — Conhecimentos gerais'}), 'BACEN — Analista TI');
  assert.equal(context.grupoTempo({trilha_nome:'Estatística UFPR'}), 'Estatística UFPR');
});
