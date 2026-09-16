// Edital BCB 2024, seção 7.1: 50 itens básicos + 70 específicos (1 ponto/item).
// Os agrupamentos abaixo somam disciplinas oficiais que o usuário cadastrou
// com outra divisão. Não há peso oficial separado para cada matéria do grupo.
const BACEN_EDITAL = 'https://bcb.gov.br/content/acessoinformacao/analista_2024/Edital-n-1-de-Abertura-do-concurso.pdf';
const BACEN_GRUPOS = [
  { nome: 'Língua Portuguesa', peso: 25, materias: ['Língua Portuguesa'] },
  { nome: 'Lógica e Estatística', peso: 10, materias: ['Noções de Lógica e Estatística'] },
  { nome: 'Direito Administrativo', peso: 5, materias: ['Direito Administrativo'] },
  { nome: 'Microeconomia e Macroeconomia', peso: 10, materias: ['Fundamentos de Microeconomia e Macroeconomia'] },
  { nome: 'Banco de Dados e Ciência de Dados', peso: 18, materias: ['Banco de Dados e Ciência de Dados'] },
  { nome: 'Engenharia e Desenvolvimento de Software', peso: 24, materias: ['Engenharia de Software', 'Desenvolvimento de Software'] },
  { nome: 'Redes, Segurança e Sistemas Operacionais', peso: 24, materias: ['Redes e Segurança', 'Sistemas Operacionais'] },
  { nome: 'Governança de TI', peso: 4, materias: ['Governança de TI'] },
];

function materiasBacen() {
  return Estado.materias.filter((m) => /^BACEN — Analista TI — /.test(m.trilha_nome || '') &&
    BACEN_GRUPOS.some((g) => g.materias.includes(m.nome)));
}

async function buscarItensBacen() {
  const materias = materiasBacen();
  if (!materias.length) throw new Error('Cadastre as matérias nas trilhas do BACEN para usar este modo.');
  const lotes = await Promise.all(materias.map(async (m) => {
    // Paginação: um banco grande não pode excluir silenciosamente os itens antigos.
    const itens = [];
    for (let inicio = 0; ; inicio += 500) {
      const { data, error } = await sb.from('perguntas').select(SELECT_PERGUNTA)
        .eq('subdivisoes.materia_id', m.id).order('id').range(inicio, inicio + 499);
      if (error) throw new Error(error.message);
      itens.push(...data.map((p) => ({ ...normalizarPergunta(p), origem_nome: m.nome })));
      if (data.length < 500) break;
    }
    return itens;
  }));
  return lotes.flat();
}

function misturarBacen(itens, random = Math.random) {
  const copia = itens.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Distribuição proporcional com teto de disponibilidade e maiores restos.
// Redistribui vagas de grupos sem conteúdo; nunca repete um item para completar.
function cotasBacen(grupos, limite, random = Math.random) {
  const cotas = grupos.map(() => 0);
  let restantes = Math.min(Math.max(0, Math.floor(limite)), grupos.reduce((n, g) => n + g.itens.length, 0));
  let ativos = grupos.map((_, i) => i).filter((i) => grupos[i].itens.length > 0);
  while (ativos.length && restantes > 0) {
    const peso = ativos.reduce((n, i) => n + grupos[i].peso, 0);
    const limitados = ativos.filter((i) => grupos[i].itens.length <= restantes * grupos[i].peso / peso);
    if (limitados.length) {
      for (const i of limitados) { cotas[i] = grupos[i].itens.length; restantes -= cotas[i]; }
      ativos = ativos.filter((i) => !limitados.includes(i));
      continue;
    }
    const ideais = ativos.map((i) => ({ i, valor: restantes * grupos[i].peso / peso, desempate: random() }));
    for (const { i, valor } of ideais) { cotas[i] = Math.floor(valor); restantes -= cotas[i]; }
    ideais.sort((a, b) => (b.valor % 1 - a.valor % 1) || (a.desempate - b.desempate));
    for (let j = 0; j < restantes; j++) cotas[ideais[j].i]++;
    break;
  }
  return cotas;
}

function selecionarBacen(itens, limite = 120, random = Math.random) {
  const materias = new Map(materiasBacen().map((m) => [m.id, m.nome]));
  const unicos = [...new Map(itens.filter((p) => !p.oculta && ['pergunta', 'flashcard'].includes(p.tipo))
    .map((p) => [p.id, p])).values()];
  const grupos = BACEN_GRUPOS.map((g) => ({ ...g,
    itens: unicos.filter((p) => g.materias.includes(materias.get(p.materia_id))),
  }));
  const cotas = cotasBacen(grupos, limite, random);
  const escolhidos = [];
  grupos.forEach((g, i) => {
    // Alterna as matérias de cada grupo, sem favorecer a que tem mais cartões.
    const filas = g.materias.map((nome) => misturarBacen(g.itens.filter((p) => materias.get(p.materia_id) === nome), random));
    let rodada = [];
    for (let n = 0; n < cotas[i]; n++) {
      if (!rodada.length) rodada = misturarBacen(filas.filter((f) => f.length), random);
      escolhidos.push(rodada.pop().pop());
    }
  });
  return { itens: misturarBacen(escolhidos, random), grupos: grupos.map((g, i) => ({ ...g, selecionados: cotas[i] })) };
}

function resumoBacenHTML(resultado) {
  const falta = resultado?.grupos.filter((g) => g.itens.length === 0).map((g) => g.nome) || [];
  return `<p><b>BACEN misturado — referência: edital 2024.</b> Sorteio proporcional, sem repetir itens na seleção.
    A quantidade se ajusta ao conteúdo disponível; a discursiva é estudada separadamente.</p>
    ${falta.length ? `<p>Sem itens disponíveis nesta sessão: ${falta.map(esc).join('; ')}. As vagas foram redistribuídas.</p>` : ''}
    <details><summary>Ver pesos e distribuição</summary>
    <ul>${BACEN_GRUPOS.map((g, i) => `<li>${esc(g.nome)}: ${g.peso}/120 (${(g.peso / 1.2).toFixed(1)}%)${resultado ? ` — ${resultado.grupos[i].selecionados} selecionados` : ''}</li>`).join('')}</ul>
    <p>Dados: 14 + 4. Software: 24 entre Engenharia e Desenvolvimento. Infraestrutura e Segurança: 17 + 7 entre Redes/Segurança e Sistemas Operacionais. Dentro de cada grupo, as matérias se alternam igualmente enquanto houver itens.</p>
    <a href="${BACEN_EDITAL}" target="_blank" rel="noopener noreferrer">Consultar edital, seção 7.1</a></details>`;
}
