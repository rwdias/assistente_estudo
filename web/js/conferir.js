// Confere/computa a resposta de um card matemático DETERMINISTICAMENTE, a partir
// de um objeto `verificacao` que a IA emite junto do card. É o elo "a IA traduz
// → o código calcula": a IA só descreve o que calcular; aqui roda Calc/Logica.
//
// Tipos de verificacao (o que a IA preenche quando a questão é calculável):
//   { tipo:'numerico', expressao:'2+7' }
//       → resultado numérico da expressão.
//   { tipo:'logica_valor', expressao:'a & b',
//     atomos:[ {simbolo:'a', aritmetica:'3+2=7'}, {simbolo:'b', valor:'V'} ] }
//       → V/F da expressão proposicional, onde cada átomo vem de uma conta
//         (aritmetica, computada por Calc) OU de um valor dado (valor: fato do
//         mundo/atribuição que a IA fornece). Cobre Q3, Q4 e Q5 da lista.
//   { tipo:'logica_incognita',
//     restricoes:[ {expressao:'p & q', valor:'F'}, {expressao:'q', valor:'F'} ],
//     incognitas:['p'] }
//       → resolve as incógnitas por enumeração (Logica.resolver). Cobre Q6, Q7.
//   { tipo:'nenhuma' } (ou ausente) → não é calculável (tradução, prova, etc.).
//
// Retorna { ok, resposta, detalhe }:
//   ok=true  → `resposta` é a resposta determinística (string curta).
//   ok=false → não deu para calcular (verificacao ausente/inválida); sem alarme.
function conferirVerificacao(v) {
  if (!v || !v.tipo || v.tipo === 'nenhuma') return { ok: false };
  try {
    if (v.tipo === 'numerico') {
      const n = Calc.avaliar(v.expressao || '');
      if (n === null) return { ok: false };
      return { ok: true, resposta: formatarNumero(n) };
    }

    if (v.tipo === 'logica_valor') {
      const atrib = {};
      for (const at of v.atomos || []) {
        let b;
        if (at.aritmetica != null && at.aritmetica !== '') {
          b = Calc.proposicao(at.aritmetica);      // código calcula a conta
          if (b === null) return { ok: false };    // conta não avaliável → aborta
        } else {
          b = normalizarVF(at.valor);              // valor dado pela IA (fato/atrib)
          if (b === null) return { ok: false };
        }
        atrib[at.simbolo] = b;
      }
      const r = Logica.avaliar(v.expressao || '', atrib);
      return { ok: true, resposta: r ? 'V' : 'F' };
    }

    if (v.tipo === 'logica_incognita') {
      const restricoes = (v.restricoes || []).map((r) => ({ expr: r.expressao, valor: r.valor }));
      const inc = v.incognitas || [];
      if (!restricoes.length || !inc.length) return { ok: false };
      const res = Logica.resolver(restricoes, inc);
      // formata: "V(p)=F" ou "V(p)=V ou F; V(q)=V"
      const partes = inc.map((x) => `V(${x})=${res[x]}`);
      return { ok: true, resposta: partes.join('; ') };
    }
  } catch (_) {
    return { ok: false };
  }
  return { ok: false };
}

// "V"/"F"/"v"/"f"/true/false/1/0 → boolean, ou null se não reconhecido.
function normalizarVF(x) {
  if (x === true || x === 1) return true;
  if (x === false || x === 0) return false;
  const s = String(x).trim().toUpperCase();
  if (s === 'V' || s === 'VERDADEIRO' || s === 'TRUE') return true;
  if (s === 'F' || s === 'FALSO' || s === 'FALSE') return false;
  return null;
}

// número "bonito": inteiro sem casas; senão até 4 casas sem zeros à toa.
function formatarNumero(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4))).replace('.', ',');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { conferirVerificacao, normalizarVF, formatarNumero };
}
