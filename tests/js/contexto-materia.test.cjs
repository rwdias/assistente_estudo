const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('web/js/ia.js','utf8');
function setup(){
 const elements=new Map(),requests=[],updates=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:'',disabled:false,addEventListener:(_,fn)=>elements.get(id).click=fn});
  return elements.get(id);
 };
 const ctx=vm.createContext({
  document:{getElementById:element},Estado:{materiaId:1},
  ehMateriaBacen:()=>true,toast(){},mensagemErroFuncao:async()=> 'Falha',
  sb:{functions:{invoke:(_,args)=>new Promise(resolve=>requests.push({id:args.body.materia_id,resolve}))},
    from:()=>({update:body=>({eq:async(_,id)=>{updates.push({body,id});return {};}})})},
 });
 vm.runInContext(source.slice(source.indexOf('let contextoMateriaCarregada'),source.indexOf('// --- extração ---')),ctx);
 return {ctx,element,requests,updates};
}
test('campo mostra prompt completo; troca rápida de matéria ignora resposta anterior',async()=>{
 const a=setup();
 const p1=a.ctx.aoAbrirIa();
 a.ctx.Estado.materiaId=2;
 const p2=a.ctx.aoAbrirIa();
 a.requests[1].resolve({data:{contexto:'Prompt de Redes editável',padrao:true}});
 await p2;
 a.requests[0].resolve({data:{contexto:'Prompt antigo',padrao:true}});
 await p1;
 assert.equal(a.element('ia-contexto').value,'Prompt de Redes editável');
 a.element('ia-contexto').value='Minha regra: gerar 3 cartões.';
 await a.element('salvar-contexto-btn').click();
 assert.equal(a.updates[0].id,2);
 assert.equal(a.updates[0].body.contexto_ia,'Minha regra: gerar 3 cartões.');
});
test('falha de carregamento impede sobrescrever contexto; vazio é salvo intencionalmente',async()=>{
 const a=setup();
 const failed=a.ctx.aoAbrirIa();
 a.requests[0].resolve({error:{message:'Falha'}});await failed;
 assert.equal(a.element('salvar-contexto-btn').disabled,true);
 await a.element('salvar-contexto-btn').click();
 assert.equal(a.updates.length,0);
 const ok=a.ctx.aoAbrirIa();
 a.requests[1].resolve({data:{contexto:'',padrao:false}});await ok;
 assert.equal(a.element('ia-contexto').value,'');
 await a.element('salvar-contexto-btn').click();
 assert.equal(a.updates[0].body.contexto_ia,'');
});
