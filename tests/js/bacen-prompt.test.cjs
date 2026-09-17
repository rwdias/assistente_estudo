const {test}=require('node:test');
const assert=require('node:assert/strict');

test('perfil BACEN substitui cobertura exaustiva, preserva JSON, tópicos e LaTeX',async()=>{
 const {promptFlashcards}=await import('../../supabase/functions/_shared/comum.ts');
 const {recorteBacen,limiteBacen,contextoPadraoBacen}=await import('../../supabase/functions/_shared/bacen.ts');
 const recorte=recorteBacen('Noções de Lógica e Estatística','BACEN — Analista TI — Conhecimentos gerais');
 const prompt=promptFlashcards('Lógica','Média',limiteBacen(2),contextoPadraoBacen('Noções de Lógica e Estatística','BACEN — Analista TI — Conhecimentos gerais')+'\nMeu edital específico',['Probabilidade'],true,recorte);
 assert.match(prompt,/Limite técnico deste envio: 10/);
 assert.match(prompt,/"flashcards":\[\]/);
 assert.match(prompt,/Meu edital específico/);
 assert.match(prompt,/Probabilidade/);
 assert.match(prompt,/ESCAPE JSON/);
 assert.doesNotMatch(prompt,/COBERTURA EXAUSTIVA|Gere QUANTOS|Na dúvida entre incluir/);
 assert.match(promptFlashcards('Lógica','Média',100,'',[],true),/COBERTURA EXAUSTIVA/);
 assert.equal(recorteBacen('Governança de TI','Faculdade'),null);
 assert.ok(recorteBacen('Discursivas sem correção','BACEN — Analista TI — Prova discursiva'));
 for(const p of [undefined,0,-1,'2',1.5])assert.equal(limiteBacen(p),5);
 assert.equal(limiteBacen(999),100);
});

test('extrair resolve perfil e contexto com JWT, limita lote e aceita zero sem erro',async()=>{
 let handler, pedidoIA, consulta, materia, resultado=[], quotas=0;
 global.Deno={serve:fn=>{handler=fn;},env:{get:k=>k==='SUPABASE_URL'?'https://teste.invalid':k==='IA_QUOTA_DIARIA'?'20':'fake'}};
 const original=global.fetch;
 global.fetch=async(url,init={})=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'usuario'});
  if(url.includes('/rest/v1/materias?')){
   consulta=init;return Response.json(materia?[materia]:[]);
  }
  if(url.includes('consumir_quota_ia')){quotas++;return Response.json(true);}
  if(url.endsWith('/chat/completions')){
   pedidoIA=JSON.parse(init.body);return Response.json({choices:[{message:{content:JSON.stringify({flashcards:resultado})}}]});
  }
  throw Error('Endpoint inesperado');
 };
 try{
  await import('../../supabase/functions/extrair/index.ts');
  const req=extras=>new Request('https://teste.invalid/extrair',{method:'POST',headers:{Authorization:'Bearer JWT_DO_USUARIO','Content-Type':'application/json'},
   body:JSON.stringify({tipo:'flashcard',modelo:'ChatGPT',texto:'Texto fonte',assunto:'Nome enviado',materia_id:123,...extras})});
  materia={nome:'Governança de TI',tipo:'normal',contexto_ia:'Contexto salvo da matéria',trilhas:{nome:'BACEN — Analista TI — Conhecimentos específicos de TI'}};
  let resp=await handler(req({}));
  assert.equal(resp.status,200);assert.deepEqual(await resp.json(),{flashcards:[]});
  assert.equal(consulta.headers.Authorization,'Bearer JWT_DO_USUARIO');
  assert.match(pedidoIA.messages[0].content,/Contexto salvo da matéria/);
  assert.doesNotMatch(pedidoIA.messages[0].content,/ITIL v4/);
  resultado=Array.from({length:12},(_,i)=>({frente:'Pergunta '+i,verso:'Resposta',dificuldade:'Média',topico:null}));
  resp=await handler(req({paginas_selecionadas:2,contexto:'Contexto editado no painel'}));
  assert.equal((await resp.json()).flashcards.length,12);
  assert.match(pedidoIA.messages[0].content,/Contexto editado no painel/);
  assert.doesNotMatch(pedidoIA.messages[0].content,/Contexto salvo da matéria/);
  // Consulta do campo não consome quota e retorna exatamente a edição salva.
  const quotaAntes=quotas;
  resp=await handler(req({acao:'contexto_flashcards'}));
  assert.deepEqual(await resp.json(),{contexto:'Contexto salvo da matéria',padrao:false});
  assert.equal(quotas,quotaAntes);
  materia.contexto_ia=null;
  resp=await handler(req({acao:'contexto_flashcards'}));
  const padrao=await resp.json();
  assert.equal(padrao.padrao,true);
  assert.match(padrao.contexto,/Matéria: Governança de TI/);
  assert.match(padrao.contexto,/ITIL v4/);
  assert.equal(quotas,quotaAntes);
  resp=await handler(req({paginas_selecionadas:2}));
  assert.equal((await resp.json()).flashcards.length,10);
  assert.ok(pedidoIA.messages[0].content.includes(padrao.contexto.trim()));
  // Uma edição pode mudar estilo, quantidade e recorte, sem regras ocultas.
  materia.contexto_ia='Gere até 8 cartões com exemplos de Scrum.';
  resp=await handler(req({}));
  assert.equal((await resp.json()).flashcards.length,12); // apenas teto técnico; modelo é simulado
  assert.match(pedidoIA.messages[0].content,/Gere até 8 cartões com exemplos de Scrum/);
  assert.doesNotMatch(pedidoIA.messages[0].content,/Ignore introduções|excepcionalmente 5|ITIL v4/);
  materia.contexto_ia='';
  resp=await handler(req({acao:'contexto_flashcards'}));
  assert.deepEqual(await resp.json(),{contexto:'',padrao:false});
  materia.trilhas.nome='Faculdade';
  resp=await handler(req({}));
  assert.equal((await resp.json()).flashcards.length,12);
  assert.match(pedidoIA.messages[0].content,/COBERTURA EXAUSTIVA/);
  materia=null;const antes=quotas;
  resp=await handler(req({}));
  assert.equal(resp.status,404);assert.equal(quotas,antes);
 }finally{global.fetch=original;delete global.Deno;}
});
