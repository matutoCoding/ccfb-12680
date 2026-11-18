/**
 * RS-274X 宏光圈（AM）表达式求值。
 * 支持运算符 + - x /，括号，一元负号，变量 $n。
 * Gerber 规范里乘法就是字符 'x'（不区分大小写）。
 */

export type MacroEnv = number[]; // env[1] = $1 ...

class Tokenizer {
  private pos = 0;
  constructor(private readonly src: string) {}

  tokenize(): string[] {
    const out: string[] = [];
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === ' ' || c === '\t') {
        this.pos++;
        continue;
      }
      if (c === '$') {
        let n = '';
        this.pos++;
        while (this.pos < this.src.length && /[0-9]/.test(this.src[this.pos]!)) n += this.src[this.pos++];
        out.push(`$${n}`);
      } else if (/[0-9.]/.test(c)) {
        let n = '';
        while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos]!)) n += this.src[this.pos++];
        out.push(n);
      } else if (c === 'x' || c === 'X') {
        out.push('*');
        this.pos++;
      } else if ('+-*/()'.includes(c)) {
        out.push(c);
        this.pos++;
      } else {
        // 非法字符直接跳过，保持宽容
        this.pos++;
      }
    }
    return out;
  }
}

/** 递归下降：expr := term (('+'|'-') term)* */
export function evalMacroExpression(src: string, env: MacroEnv): number {
  const tokens = new Tokenizer(src).tokenize();
  let p = 0;

  const peek = (): string | undefined => tokens[p];
  const next = (): string => tokens[p++]!;

  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      const t = peek();
      if (t === '+') {
        next();
        v += parseTerm();
      } else if (t === '-') {
        next();
        v -= parseTerm();
      } else return v;
    }
  }

  function parseTerm(): number {
    let v = parseFactor();
    for (;;) {
      const t = peek();
      if (t === '*') {
        next();
        v *= parseFactor();
      } else if (t === '/') {
        next();
        v /= parseFactor();
      } else return v;
    }
  }

  function parseFactor(): number {
    const t = next();
    if (t === '(') {
      const v = parseExpr();
      next(); // ')'
      return v;
    }
    if (t === '-') return -parseFactor();
    if (t === '+') return parseFactor();
    if (t === undefined) return 0;
    if (t.startsWith('$')) {
      const idx = Number(t.slice(1));
      const v = env[idx];
      if (v === undefined) throw new Error(`宏变量 ${t} 未定义`);
      return v;
    }
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`宏表达式无法识别的 token: ${t}`);
    return n;
  }

  const result = parseExpr();
  if (p !== tokens.length) throw new Error(`宏表达式尾部多余 token: ${src}`);
  return result;
}
