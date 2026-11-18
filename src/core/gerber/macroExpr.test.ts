import { describe, expect, it } from 'vitest';
import { evalMacroExpression } from './macroExpr';

describe('宏表达式求值', () => {
  it('四则运算与优先级', () => {
    expect(evalMacroExpression('1+2*3', [])).toBe(7);
    expect(evalMacroExpression('(1+2)*3', [])).toBe(9);
    expect(evalMacroExpression('10/4', [])).toBeCloseTo(2.5, 6);
  });
  it('一元负号与变量', () => {
    expect(evalMacroExpression('-$1+5', [0, 3])).toBe(2);
    expect(evalMacroExpression('$1x$2', [0, 4, 2.5])).toBeCloseTo(10, 6);
  });
  it('嵌套括号', () => {
    expect(evalMacroExpression('(($1+1)*2)-1', [0, 2])).toBe(5);
  });
});
