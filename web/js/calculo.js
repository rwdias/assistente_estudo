// Avaliador determinístico de ARITMÉTICA — o código faz a conta, não a IA.
//
// Por quê: LLM erra conta; um parser exato não. Na ingestão de matemática, a IA
// só TRADUZ o problema numa expressão canônica; este módulo AVALIA com exatidão
// (fonte da verdade onde a conta é 100% computável; conferência onde é parcial).
//
// Segurança: parser recursivo próprio, SEM `eval`/`Function` (a CSP proíbe e
// seria perigoso). Só faz aritmética — não toca DOM nem rede. Escopo global
// `Calc` (o projeto é sem módulos/bundler).
//
// Gramática (precedência do menor p/ o maior nível):
//   comparacao := soma ( (= | != | < | > | <= | >=) soma )?
//   soma       := termo ( (+|-) termo )*
//   termo      := potencia ( (*|/|·) potencia )*      (· = multiplicação)
//   potencia   := unario ( ^ potencia )?              (^ associa à direita)
//   unario     := (+|-) unario | posfixo
//   posfixo    := primario ('!')?                     (! = fatorial)
//   primario   := numero | constante | funcao '(' comparacao ')'
//               | '(' comparacao ')' | '√' potencia
//
// avaliar(expr)   → número (ou null se inválida / não for expressão numérica).
// proposicao(expr)→ booleano de uma comparação tipo "3+2=7" (ou null se não
//                    for uma comparação avaliável).
const Calc = (function () {
  const FUNCS = {
    sqrt: Math.sqrt, raiz: Math.sqrt,
    sin: Math.sin, sen: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    ln: Math.log, log: (x) => Math.log10(x), exp: Math.exp,
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  };
  const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

  // Igualdade tolerante: irracionais em float não batem exato
  // (ex.: √2·√8 = 3.9999999996, mas é 4). Tolerância relativa.
  function quaseIgual(a, b) {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }

  function fatorial(n) {
    if (!Number.isInteger(n) || n < 0 || n > 170) return NaN; // 170! ~ limite do double
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  // Lê um grupo { ... } balanceado a partir de s[i] (i aponta para '{').
  // Devolve { conteudo, fim } (fim = índice logo após o '}').
  function lerGrupo(s, i) {
    let nivel = 0, j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') nivel++;
      else if (s[j] === '}') { nivel--; if (nivel === 0) return { conteudo: s.slice(i + 1, j), fim: j + 1 }; }
    }
    return { conteudo: s.slice(i + 1), fim: s.length }; // sem fechar: tolera
  }

  // Expande construções LaTeX com AGRUPAMENTO para a forma com parênteses
  // (senão tirar { } cru quebraria, ex.: \sqrt{9-5} viraria √9-5). Recursivo
  // para lidar com aninhamento (\frac dentro de \sqrt etc.).
  function expandirLatex(s) {
    let out = '';
    for (let i = 0; i < s.length; ) {
      if (s.startsWith('\\frac', i)) {
        let k = i + 5;
        while (s[k] === ' ') k++;
        const a = lerGrupo(s, k); let k2 = a.fim; while (s[k2] === ' ') k2++;
        const b = lerGrupo(s, k2);
        out += '((' + expandirLatex(a.conteudo) + ')/(' + expandirLatex(b.conteudo) + '))';
        i = b.fim; continue;
      }
      if (s.startsWith('\\sqrt', i)) {
        let k = i + 5; while (s[k] === ' ') k++;
        if (s[k] === '{') { const g = lerGrupo(s, k); out += 'sqrt((' + expandirLatex(g.conteudo) + '))'; i = g.fim; continue; }
        out += '√'; i = i + 5; continue;
      }
      // ^{...} e _{...} (subscrito é descartado — não faz sentido em aritmética)
      if ((s[i] === '^' || s[i] === '_') && s[i + 1] === '{') {
        const g = lerGrupo(s, i + 1);
        out += s[i] === '^' ? '^(' + expandirLatex(g.conteudo) + ')' : '';
        i = g.fim; continue;
      }
      out += s[i]; i++;
    }
    return out;
  }

  // Normaliza símbolos que a IA/LaTeX pode emitir para a forma ASCII do parser.
  function normalizar(s) {
    return expandirLatex(String(s))
      .replace(/\\cdot|·|×/g, '*')
      .replace(/÷/g, '/')
      .replace(/\\sqrt/g, '√')
      .replace(/\\pi/g, 'π')
      .replace(/\\left|\\right/g, '')
      .replace(/\\neq|≠/g, '!=')
      .replace(/≤/g, '<=').replace(/≥/g, '>=')
      .replace(/\*\*/g, '^')       // ** como potência
      .replace(/[{}$]/g, '')        // chaves/cifrões que sobraram (sem agrupamento)
      .replace(/\s+/g, ' ')
      .trim();
  }

  // --- tokenizador ---
  function tokenizar(s) {
    const toks = [];
    let i = 0;
    const OPS = ['<=', '>=', '!=', '==', '=', '<', '>', '+', '-', '*', '/', '^', '(', ')', '!', '√'];
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      // número (com decimal por . ou ,)
      if (/[0-9.,]/.test(c)) {
        let j = i, ponto = false;
        while (j < s.length && /[0-9.,]/.test(s[j])) {
          if (s[j] === '.' || s[j] === ',') { if (ponto) break; ponto = true; }
          j++;
        }
        toks.push({ t: 'num', v: parseFloat(s.slice(i, j).replace(',', '.')) });
        i = j; continue;
      }
      // identificador (função ou constante)
      if (/[a-zA-Zπ]/.test(c)) {
        let j = i;
        while (j < s.length && /[a-zA-Zπ]/.test(s[j])) j++;
        toks.push({ t: 'id', v: s.slice(i, j).toLowerCase() });
        i = j; continue;
      }
      // operador de 2 ou 1 caractere
      const op2 = s.slice(i, i + 2);
      if (OPS.includes(op2)) { toks.push({ t: 'op', v: op2 }); i += 2; continue; }
      if (OPS.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
      throw new Error('token inesperado: ' + c);
    }
    return toks;
  }

  // --- parser recursivo descendente ---
  function analisar(toks) {
    let pos = 0;
    const olhar = () => toks[pos];
    const consumir = () => toks[pos++];
    const ehOp = (v) => olhar() && olhar().t === 'op' && olhar().v === v;

    function comparacao() {
      const esq = soma();
      const o = olhar();
      if (o && o.t === 'op' && ['=', '==', '!=', '<', '>', '<=', '>='].includes(o.v)) {
        consumir();
        const dir = soma();
        return { tipo: 'cmp', op: o.v === '==' ? '=' : o.v, esq, dir };
      }
      return esq;
    }
    function soma() {
      let n = termo();
      while (ehOp('+') || ehOp('-')) { const op = consumir().v; n = { tipo: 'bin', op, esq: n, dir: termo() }; }
      return n;
    }
    function termo() {
      let n = unario();
      while (ehOp('*') || ehOp('/')) { const op = consumir().v; n = { tipo: 'bin', op, esq: n, dir: unario() }; }
      return n;
    }
    // unário é MAIS FRACO que o expoente: -5^2 = -(5^2) = -25 (convenção usual).
    function unario() {
      if (ehOp('-')) { consumir(); return { tipo: 'neg', arg: unario() }; }
      if (ehOp('+')) { consumir(); return unario(); }
      if (ehOp('√')) { consumir(); return { tipo: 'fn', nome: 'sqrt', arg: unario() }; }
      return potencia();
    }
    function potencia() {
      const base = posfixo();
      // expoente pode ter unário à direita (2^-3) e associa à direita (2^3^2).
      if (ehOp('^')) { consumir(); return { tipo: 'bin', op: '^', esq: base, dir: unario() }; }
      return base;
    }
    function posfixo() {
      let n = primario();
      if (ehOp('!')) { consumir(); n = { tipo: 'fat', arg: n }; }
      return n;
    }
    function primario() {
      const o = olhar();
      if (!o) throw new Error('fim inesperado');
      if (o.t === 'num') { consumir(); return { tipo: 'num', v: o.v }; }
      if (ehOp('(')) {
        consumir();
        const n = comparacao();
        if (!ehOp(')')) throw new Error('faltou )');
        consumir();
        return n;
      }
      if (o.t === 'id') {
        consumir();
        if (ehOp('(')) {
          consumir();
          const arg = comparacao();
          if (!ehOp(')')) throw new Error('faltou )');
          consumir();
          return { tipo: 'fn', nome: o.v, arg };
        }
        return { tipo: 'const', nome: o.v };
      }
      throw new Error('esperava número/(/função, veio: ' + JSON.stringify(o));
    }

    const arv = comparacao();
    if (pos !== toks.length) throw new Error('sobrou token');
    return arv;
  }

  // --- avaliação da árvore ---
  function calcular(no) {
    switch (no.tipo) {
      case 'num': return no.v;
      case 'neg': return -calcular(no.arg);
      case 'fat': return fatorial(calcular(no.arg));
      case 'const': {
        if (no.nome in CONSTS) return CONSTS[no.nome];
        throw new Error('constante desconhecida: ' + no.nome);
      }
      case 'fn': {
        const f = FUNCS[no.nome];
        if (!f) throw new Error('função desconhecida: ' + no.nome);
        return f(calcular(no.arg));
      }
      case 'bin': {
        const a = calcular(no.esq), b = calcular(no.dir);
        switch (no.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return a / b;
          case '^': return Math.pow(a, b);
        }
        throw new Error('op binário: ' + no.op);
      }
      case 'cmp': {
        const a = calcular(no.esq), b = calcular(no.dir);
        switch (no.op) {
          case '=': return quaseIgual(a, b);
          case '!=': return !quaseIgual(a, b);
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          case '>=': return a >= b;
        }
        throw new Error('op comparação: ' + no.op);
      }
    }
    throw new Error('nó desconhecido: ' + no.tipo);
  }

  function parse(expr) {
    return analisar(tokenizar(normalizar(expr)));
  }

  return {
    // número da expressão, ou null se inválida / for comparação (use proposicao)
    avaliar(expr) {
      try {
        const r = calcular(parse(expr));
        return typeof r === 'number' && Number.isFinite(r) ? r : null;
      } catch (_) { return null; }
    },
    // booleano de uma comparação ("3+2=7" → false), ou null se não for comparação
    proposicao(expr) {
      try {
        const arv = parse(expr);
        if (arv.tipo !== 'cmp') return null;
        return calcular(arv) === true;
      } catch (_) { return null; }
    },
    _quaseIgual: quaseIgual, // exposto para teste
  };
})();

// Node (testes) vs navegador (global implícito).
if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
