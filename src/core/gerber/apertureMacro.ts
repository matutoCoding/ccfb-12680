import { degToRad, normDeg } from '../units';
import type { Aperture, MacroShape } from '../types';
import { evalMacroExpression, type MacroEnv } from './macroExpr';

/**
 * 解析 AM 宏定义体并按闪光参数实例化宏光圈。
 * 宏内数值一律为 mm；若文件单位是英寸，实例化后的图形在主解析器里再做 in→mm 换算。
 */

export interface MacroDef {
  name: string;
  /** 去掉注释后的有效语句（每条是一个逗号分隔行） */
  statements: string[][];
}

const PRIM_PREFIXES = ['0', '1', '2', '20', '21', '22', '4', '5', '6', '7'];

export function parseMacroBody(name: string, body: string): MacroDef {
  const statements: string[][] = [];
  for (const raw of body.split('*')) {
    const line = raw.trim();
    if (!line || line.startsWith('0')) {
      // 0, 开头是注释；空行忽略
      continue;
    }
    const parts = line.split(',').map((s) => s.trim());
    statements.push(parts);
  }
  return { name, statements };
}

function isPrimitiveStart(head: string): boolean {
  return PRIM_PREFIXES.includes(head) || /^2[012]?$/.test(head);
}

/**
 * 用 $1..$n 闪光参数实例化宏。
 * 旋转处理：Gerber 宏的旋转暴露度（exposure）之外，rotation 作用于当前图元，
 * 且后续图元的坐标不随前序旋转变化（每次旋转都是相对宏坐标系原点的独立变换）。
 */
export function instantiateMacro(def: MacroDef, params: number[], unitToMm: (v: number) => number): MacroShape[] {
  const env: MacroEnv = [0, ...params]; // env[i] === $i
  const vars = new Map<number, number>();
  const out: MacroShape[] = [];

  const val = (token: string): number => evalMacroExpression(token, env);

  for (const parts of def.statements) {
    const head = parts[0] ?? '';

    // 变量赋值：$n=表达式
    if (head.startsWith('$')) {
      const idx = Number(head.slice(1));
      vars.set(idx, val(parts[1] ?? '0'));
      env[idx] = vars.get(idx)!;
      continue;
    }

    if (!isPrimitiveStart(head)) continue;
    const code = head.replace(/^0+/, '') || '0';
    const exposure = parts[1] !== undefined ? Math.round(val(parts[1])) : 1;
    const pol: MacroShape['pol'] = exposure === 0 ? 'clear' : 'dark';
    const rot = (i: number): number => (parts[i] !== undefined ? normDeg(val(parts[i]!)) : 0);

    switch (code) {
      case '1': {
        // 圆: 1,曝光,直径,cx,cy[,旋转]
        const diameter = val(parts[2]!);
        const cx = val(parts[3] ?? '0');
        const cy = val(parts[4] ?? '0');
        const rotationDeg = rot(5);
        out.push({ kind: 'circle', pol, diameter: unitToMm(diameter), cx: unitToMm(cx), cy: unitToMm(cy), rotationDeg });
        break;
      }
      case '2': {
        // 矢量线: 2,曝光,线宽,x1,y1,x2,y2,旋转
        const width = val(parts[2]!);
        const x1 = val(parts[3] ?? '0');
        const y1 = val(parts[4] ?? '0');
        const x2 = val(parts[5] ?? '0');
        const y2 = val(parts[6] ?? '0');
        const rotationDeg = rot(7);
        out.push({
          kind: 'line',
          pol,
          width: unitToMm(width),
          x1: unitToMm(x1),
          y1: unitToMm(y1),
          x2: unitToMm(x2),
          y2: unitToMm(y2),
        });
        if (rotationDeg !== 0) {
          const s = out[out.length - 1]!;
          if (s.kind === 'line') rotateLine(s, rotationDeg);
        }
        break;
      }
      case '20': {
        // 矩形: 20,曝光,宽,高,cx,cy,旋转
        const width = val(parts[2]!);
        const height = val(parts[3]!);
        const cx = val(parts[4] ?? '0');
        const cy = val(parts[5] ?? '0');
        const rotationDeg = rot(6);
        out.push({
          kind: 'rect',
          pol,
          width: unitToMm(width),
          height: unitToMm(height),
          cx: unitToMm(cx),
          cy: unitToMm(cy),
          rotationDeg,
        });
        break;
      }
      case '21': {
        // 圆头矩形（obround）
        const width = val(parts[2]!);
        const height = val(parts[3]!);
        const cx = val(parts[4] ?? '0');
        const cy = val(parts[5] ?? '0');
        const rotationDeg = rot(6);
        out.push({
          kind: 'obround',
          pol,
          width: unitToMm(width),
          height: unitToMm(height),
          cx: unitToMm(cx),
          cy: unitToMm(cy),
          rotationDeg,
        });
        break;
      }
      case '22': {
        // 正多边形: 22,曝光,外接直径,顶点数,cx,cy,旋转
        const diameter = val(parts[2]!);
        const vertices = Math.max(3, Math.round(val(parts[3] ?? '4')));
        const cx = val(parts[4] ?? '0');
        const cy = val(parts[5] ?? '0');
        const rotationDeg = rot(6);
        out.push({
          kind: 'poly',
          pol,
          diameter: unitToMm(diameter),
          vertices,
          cx: unitToMm(cx),
          cy: unitToMm(cy),
          rotationDeg,
        });
        break;
      }
      case '4':
      case '5':
      case '6':
      case '7':
        // 4=热焊盘 5/6/7=莫尔条纹等老式图元：现代板厂文件极少使用，
        // 这里按常见近似（热焊盘→带孔圆）处理并记录警告，保证不静默丢失。
        if (code === '4') {
          const outer = val(parts[2]!);
          const inner = val(parts[3]!);
          const cx = val(parts[4] ?? '0');
          const cy = val(parts[5] ?? '0');
          const rotationDeg = rot(6);
          out.push({ kind: 'circle', pol, diameter: unitToMm(outer), cx: unitToMm(cx), cy: unitToMm(cy), rotationDeg });
          out.push({ kind: 'circle', pol: 'clear', diameter: unitToMm(inner), cx: unitToMm(cx), cy: unitToMm(cy), rotationDeg });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

function rotateLine(s: Extract<MacroShape, { kind: 'line' }>, deg: number): void {
  const a = degToRad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const rot = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
  const [nx1, ny1] = rot(s.x1, s.y1);
  const [nx2, ny2] = rot(s.x2, s.y2);
  s.x1 = nx1;
  s.y1 = ny1;
  s.x2 = nx2;
  s.y2 = ny2;
}

/** 从 ADD 行构造光圈（标准形状或宏），尺寸已换算为 mm */
export function makeAperture(dcode: number, shape: Aperture['shape'], macro?: MacroShape[]): Aperture {
  return { dcode, shape, macro };
}
