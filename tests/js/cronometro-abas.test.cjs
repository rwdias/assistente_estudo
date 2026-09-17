const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = fs.readFileSync('web/js/cronometro.js', 'utf8');

function ambiente() {
  const storage = new Map(), filas = new Map(), ocupados = new Set(), envios = [];
  let agora = 1000;
  const locks = { async request(nome, opcoes, fn) {
    if (typeof opcoes === 'function') { fn = opcoes; opcoes = {}; }
    if (opcoes.ifAvailable && ocupados.has(nome)) return fn(null);
    ocupados.add(nome);
    const anterior = filas.get(nome) || Promise.resolve();
    const atual = anterior.then(() => fn({name:nome}));
    const cauda = atual.catch(() => {});
    filas.set(nome, cauda);
    try { return await atual; } finally {
      if (filas.get(nome) === cauda) ocupados.delete(nome);
    }
  }};
  function aba(visible=true) {
    const eventos = {}, botoes = {};
    const ctx = vm.createContext({
      crypto, navigator:{locks}, Date:class extends Date { static now(){return agora;} },
      Estado:{materiaId:1,materias:[{id:1,nome:'A'},{id:2,nome:'B'}]},
      localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
      document:{visibilityState:visible?'visible':'hidden',hasFocus:()=>visible,
        getElementById:id=>({addEventListener:(e,f)=>{botoes[id]=f;},classList:{contains:()=>false}}),
        addEventListener(){}},
      window:{addEventListener:(e,f)=>{eventos[e]=f;}},
      sb:{rpc:async(n,p)=>{envios.push(p); await Promise.resolve(); return {};} }
    });
    vm.runInContext(source,ctx);
    vm.runInContext("tempoUsuario='u';tempoMateria=1;renderTempo=()=>{};",ctx);
    return {ctx,eventos,botoes};
  }
  return {aba,storage,envios,tempo:t=>{agora=t;}};
}
test('duas abas iniciam uma única sessão e sincronizam um só intervalo',async()=>{
  const a=ambiente(), x=a.aba(), y=a.aba();
  await Promise.all([x.ctx.alterarTempo(),y.ctx.alterarTempo()]);
  await Promise.all([x.botoes['tempo-iniciar'](),y.botoes['tempo-iniciar']()]);
  a.tempo(61000);
  await Promise.all([x.ctx.alterarTempo(),y.ctx.alterarTempo()]);
  await Promise.all([x.ctx.sincronizarTempo(),y.ctx.sincronizarTempo()]);
  const s=JSON.parse(a.storage.get('tempo-estudo:u'));
  assert.equal(s.rodando,true);
  assert.equal(s.decorrido,60000);
  assert.equal(new Set(a.envios.map(p=>p.p_id)).size,1);
  assert.equal(a.envios.length,1);
  assert.equal(Date.parse(a.envios[0].p_fim)-Date.parse(a.envios[0].p_inicio),60000);
});
test('aba em segundo plano não troca matéria e recebe pausa da outra aba',async()=>{
  const a=ambiente(), x=a.aba(), y=a.aba(false);
  await x.ctx.alterarTempo();
  await x.botoes['tempo-iniciar']();
  a.tempo(31000);
  await y.ctx.mudarMateriaTempo(2);
  let s=JSON.parse(a.storage.get('tempo-estudo:u'));
  assert.equal(s.segmento.materia_id,1);
  await x.botoes['tempo-iniciar']();
  y.eventos.storage({key:'tempo-estudo:u',newValue:a.storage.get('tempo-estudo:u')});
  assert.equal(vm.runInContext('tempoEstado.rodando',y.ctx),false);
  assert.equal(vm.runInContext('tempoEstado.decorrido',y.ctx),30000);
});
