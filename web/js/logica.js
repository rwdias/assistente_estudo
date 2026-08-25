// Avaliador determinístico de LÓGICA PROPOSICIONAL — o código combina a lógica,
// não a IA. Mesma filosofia do calculo.js: a IA traduz o enunciado numa
// expressão canônica; aqui a gente AVALIA/RESOLVE com exatidão.
//
// Aceita as três formas que a IA/LaTeX pode emitir para cada operador:
//   ¬  \neg  ~  !        → negação
//   ∧  \land \wedge  &   → conjunção (E)
//   ∨  \lor  \vee   |    → disjunção (OU)
//   →  \to \rightarrow ->→ condicional (se…então)
//   ↔  \leftrightarrow <->→ bicondicional (se e somente se)
// Variáveis: letras (p, q, r, ...). Constantes: V/1 (verdadeiro), F/0 (falso).
//
// Precedência (mais forte → mais fraco): ¬ , ∧ , ∨ , → (dir.) , ↔.
// Segurança: parser próprio, sem `eval`. Escopo global `Logica`.
const Logica = (function () {
  // Normaliza operadores para tokens de 1 caractere internos.
  function normalizar(s) {
    return String(s)
      .replace(/\\leftrightarrow|<->|↔|\\iff/g, '=')   // = interno = bicondicional
      .replace(/\\rightarrow|\\to|->|→|\\implies/g, '>') // > interno = condicional
      .replace(/\\land|\\wedge|∧|&&|&/g, '&')
      .replace(/\\lor|\\vee|∨|\|\||\|/g, '|')
      .replace(/\\neg|\\lnot|¬|~|!/g, '~')
      .replace(/\\left|\\right|\$|\{|\}/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function tokenizar(s) {
    const toks = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ('&|~>=()'.includes(c)) { toks.push(c); continue; }
      if (/[A-Za-z01]/.test(c)) { toks.push(c); continue; }
      throw new Error('token inesperado em lógica: ' + c);
    }
    return toks;
  }

  // Parser recursivo. Retorna AST: {op,...} ou {var} ou {const}.
  function analisar(toks) {
    let pos = 0;
    const olhar = () => toks[pos];
    const ehTok = (c) => olhar() === c;

    function bic() { // ↔ (associa à esquerda; encadeia)
      let n = cond();
      while (ehTok('=')) { pos++; n = { op: 'bic', a: n, b: cond() }; }
      return n;
    }
    function cond() { // → (associa à direita)
      const a = disj();
      if (ehTok('>')) { pos++; return { op: 'cond', a, b: cond() }; }
      return a;
    }
    function disj() {
      let n = conj();
      while (ehTok('|')) { pos++; n = { op: 'ou', a: n, b: conj() }; }
      return n;
    }
    function conj() {
      let n = neg();
      while (ehTok('&')) { pos++; n = { op: 'e', a: n, b: neg() }; }
      return n;
    }
    function neg() {
      if (ehTok('~')) { pos++; return { op: 'nao', a: neg() }; }
      return prim();
    }
    function prim() {
      const c = olhar();
      if (c === '(') {
        pos++;
        const n = bic();
        if (!ehTok(')')) throw new Error('faltou ) na lógica');
        pos++;
        return n;
      }
      if (c === 'V' || c === '1') { pos++; return { const: true }; }
      if (c === 'F' || c === '0') { pos++; return { const: false }; }
      if (/[A-Za-z]/.test(c || '')) { pos++; return { var: c }; }
      throw new Error('esperava variável/(/¬, veio: ' + c);
    }

    const arv = bic();
    if (pos !== toks.length) throw new Error('sobrou token na lógica');
    return arv;
  }

  function parse(expr) { return analisar(tokenizar(normalizar(expr))); }

  // Coleta as variáveis (letras) da árvore, em ordem estável.
  function coletarVars(no, set) {
    if (no.var) set.add(no.var);
    if (no.a) coletarVars(no.a, set);
    if (no.b) coletarVars(no.b, set);
    return set;
  }

  // Avalia a árvore sob uma atribuição {p:true,q:false}. Aceita V/F por comodidade.
  function calc(no, atrib) {
    if ('const' in no) return no.const;
    if (no.var) {
      let v = atrib[no.var];
      if (v === 'V' || v === 'v' || v === 1) v = true;
      if (v === 'F' || v === 'f' || v === 0) v = false;
      if (typeof v !== 'boolean') throw new Error('variável sem valor: ' + no.var);
      return v;
    }
    switch (no.op) {
      case 'nao': return !calc(no.a, atrib);
      case 'e': return calc(no.a, atrib) && calc(no.b, atrib);
      case 'ou': return calc(no.a, atrib) || calc(no.b, atrib);
      case 'cond': return !calc(no.a, atrib) || calc(no.b, atrib); // p→q ≡ ¬p∨q
      case 'bic': return calc(no.a, atrib) === calc(no.b, atrib);
    }
    throw new Error('operador lógico desconhecido: ' + no.op);
  }

  // Gera todas as 2^n atribuições das variáveis dadas.
  function* atribuicoes(vars) {
    const n = vars.length;
    for (let mask = 0; mask < (1 << n); mask++) {
      const a = {};
      vars.forEach((v, i) => { a[v] = Boolean(mask & (1 << i)); });
      yield a;
    }
  }

  return {
    variaveis(expr) { return [...coletarVars(parse(expr), new Set())]; },

    // valor booleano da expressão sob uma atribuição (aceita V/F).
    avaliar(expr, atrib) { return calc(parse(expr), atrib); },

    // tabela-verdade: { vars, linhas:[{atrib, valor}] }.
    tabelaVerdade(expr) {
      const arv = parse(expr);
      const vars = [...coletarVars(arv, new Set())];
      const linhas = [];
      for (const a of atribuicoes(vars)) linhas.push({ atrib: { ...a }, valor: calc(arv, a) });
      return { vars, linhas };
    },

    // Resolve incógnitas: dadas restrições [{expr, valor}] (valor V/F/bool),
    // testa TODAS as combinações das variáveis envolvidas e, para cada
    // incógnita, devolve os valores possíveis: 'V', 'F', 'V ou F' (indeterminado)
    // ou 'contradição' (nenhuma combinação satisfaz).
    resolver(restricoes, incognitas) {
      const arvs = restricoes.map((r) => ({
        no: parse(r.expr),
        alvo: r.valor === 'V' || r.valor === true || r.valor === 1,
      }));
      const vars = new Set();
      arvs.forEach((r) => coletarVars(r.no, vars));
      incognitas.forEach((v) => vars.add(v));
      const listaVars = [...vars];

      const possiveis = {};
      incognitas.forEach((v) => { possiveis[v] = new Set(); });
      for (const a of atribuicoes(listaVars)) {
        if (arvs.every((r) => calc(r.no, a) === r.alvo)) {
          incognitas.forEach((v) => possiveis[v].add(a[v]));
        }
      }
      const out = {};
      incognitas.forEach((v) => {
        const s = possiveis[v];
        if (s.size === 0) out[v] = 'contradição';
        else if (s.size === 2) out[v] = 'V ou F';
        else out[v] = s.has(true) ? 'V' : 'F';
      });
      return out;
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Logica;
