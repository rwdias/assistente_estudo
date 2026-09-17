const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('web/js/leitor.js','utf8');
test('seleção no PDF envia matéria do arquivo, páginas reais e deixa contexto para o servidor',async()=>{
 let clique, pedido, abriu=false;
 const botao={innerHTML:'Criar',style:{},addEventListener:(_,fn)=>clique=fn};
 const ctx=vm.createContext({
  document:{getElementById:()=>botao},
  leitorTrecho:'Definição selecionada',leitorInfo:{materiaId:123,titulo:'PDF de origem'},
  leitorPagina:8,leitorAbertura:1,leitorSelecaoPaginas:2,leitorPendentes:[],leitorOrigemGeracao:null,
  Estado:{materiaId:456,materias:[{id:123,nome:'Governança de TI'},{id:456,nome:'Outra matéria'}]},
  materiaEhMatematica:()=>false,topicosDaMateria:async id=>{assert.equal(id,123);return ['ITIL'];},
  sb:{functions:{invoke:async(_,args)=>{pedido=args.body;return {data:{flashcards:[{frente:'Qual a regra?',verso:'Resposta'}]}};}}},
  toast:()=>{},renderPreviewTrecho:()=>{},openModal:()=>{abriu=true;}
 });
 const a=source.indexOf("document.getElementById('leitor-criar-btn')?.addEventListener");
 vm.runInContext(source.slice(a,source.indexOf('function renderPreviewTrecho',a)),ctx);
 await clique();
 assert.equal(pedido.materia_id,123);
 assert.equal(pedido.paginas_selecionadas,2);
 assert.equal(pedido.assunto,'Governança de TI');
 assert.equal('contexto' in pedido,false);
 assert.equal(ctx.leitorOrigemGeracao.materiaId,123);
 assert.equal(abriu,true);
});

test('salvar a prévia mantém a matéria de origem mesmo após mudar o seletor',async()=>{
 let salvar, gravado;
 const card={dataset:{idx:'0'},querySelector:s=>s==='.trecho-incluir'?{checked:true}:{value:s==='.trecho-frente'?'Pergunta':'Resposta'}};
 const ctx=vm.createContext({
  document:{getElementById:()=>({addEventListener:(_,fn)=>salvar=fn}),querySelectorAll:()=>[card]},
  leitorOrigemGeracao:{materiaId:123},leitorPendentes:[{topico:'ITIL'}],
  Estado:{materiaId:456},materiaEhMatematica:()=>false,
  inserirPergunta:async(id,c)=>{gravado={id,c};},toast(){},closeModal(){}
 });
 const a=source.indexOf("document.getElementById('modal-trecho-salvar')?.addEventListener");
 vm.runInContext(source.slice(a),ctx);
 await salvar();
 assert.equal(gravado.id,123);
 assert.equal(gravado.c.topico,'ITIL');
});
