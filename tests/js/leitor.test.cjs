const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('web/js/leitor.js','utf8').split('// Carrega o pdf.js')[0];
function setup(data=null,error=null) {
 const storage=new Map(), writes=[];
 const ctx=vm.createContext({
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
 window:{addEventListener(){}},toast(){},
 sb:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data,error})})})}),
 rpc:async(n,p)=>{writes.push(p);return {error};}}
 });
 vm.runInContext(source,ctx);
 return {ctx,storage,writes};
}
test('restaura posição da conta sem armazenamento local, inclusive no dia seguinte',async()=>{
 const {ctx}=setup({pagina:42,atualizado_em:'2026-09-16T12:00:00Z'});
 assert.equal(await ctx.recuperarPaginaLeitor('u/m/pdf',100),42);
});
test('migra posição antiga local quando ainda não existe na conta',async()=>{
 const {ctx,storage,writes}=setup();
 storage.set('leitorPagina:u/m/pdf','17');
 assert.equal(await ctx.recuperarPaginaLeitor('u/m/pdf',100),17);
 assert.equal(writes[0].p_pagina,17);
});
test('posição remota substitui cache antigo sem reenviar a primeira página',async()=>{
 const {ctx,storage,writes}=setup({pagina:38,atualizado_em:'2026-09-17T12:00:00Z'});
 storage.set('leitorPagina:u/m/pdf','1');
 assert.equal(await ctx.recuperarPaginaLeitor('u/m/pdf',100),38);
 assert.equal(writes.length,0);
});
test('posição offline mais recente pode voltar páginas e sincroniza',async()=>{
 const {ctx,storage,writes}=setup({pagina:38,atualizado_em:'2026-09-16T12:00:00Z'});
 storage.set('leitorPagina:u/m/pdf',JSON.stringify({pagina:12,atualizado_em:'2026-09-17T12:00:00Z',pendente:true}));
 assert.equal(await ctx.recuperarPaginaLeitor('u/m/pdf',100),12);
 assert.equal(writes[0].p_pagina,12);
});
test('falha de rede preserva posição local sem sobrescrever servidor',async()=>{
 const {ctx,storage,writes}=setup(null,new Error('offline'));
 storage.set('leitorPagina:u/m/pdf','20');
 assert.equal(await ctx.recuperarPaginaLeitor('u/m/pdf',10),10);
 assert.equal(writes.length,0);
});
