const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('web/js/leitor.js','utf8');
function setup(){
 const els=new Map();
 const ctx=vm.createContext({document:{getElementById:id=>{
  if(!els.has(id))els.set(id,{style:{},innerHTML:'',textContent:''});
  return els.get(id);
 }},window:{getSelection:()=>({removeAllRanges(){}})},toast:()=>{throw Error('unexpected error');}});
 vm.runInContext(`let leitorDoc={numPages:20},leitorRenderizacao=0,leitorEscala=1.3,leitorPagina=1,leitorDuplo=true,leitorTrecho='';const leitorTarefas=new Set();`,ctx);
 vm.runInContext(source.slice(source.indexOf('function cancelarRenderizacaoLeitor'),source.indexOf('async function desenharPagina')),ctx);
 return {ctx,els};
}
test('renderização antiga não insere segunda página nem sobrescreve contador após novo zoom/página',async()=>{
 const {ctx,els}=setup(); let liberar; const chamadas=[];
 ctx.desenharPagina=async(n,c,doc,escala)=>{chamadas.push([n,escala]);if(chamadas.length===1)await new Promise(r=>liberar=r);};
 const antiga=ctx.renderizarPaginaLeitor();
 vm.runInContext('leitorPagina=5;leitorEscala=1.7',ctx);
 await ctx.renderizarPaginaLeitor();
 liberar(); await antiga;
 assert.deepEqual(chamadas,[[1,1.3],[5,1.7],[6,1.7]]);
 assert.equal(els.get('leitor-pagina').textContent,'5–6 / 20');
});
test('cancelamento encerra tarefa pendente sem erro visível ou rejeição solta',async()=>{
 const {ctx,els}=setup();
 let rejeitar, cancelou=false;
 const tarefa={promise:new Promise((_,r)=>rejeitar=r),cancel(){cancelou=true;rejeitar(Error('cancelado'));}};
 ctx.desenharPagina=()=>ctx.aguardarTarefaLeitor(tarefa);
 const render=ctx.renderizarPaginaLeitor();
 ctx.cancelarRenderizacaoLeitor();
 await render;
 assert.equal(cancelou,true);
 assert.equal(els.has('leitor-pagina'),false);
});
