import { bboxFromPoints, unionBBox } from '../geometry';
import { convertToMm } from '../units';
import type { BBox, CoordFormat, DrillFile, DrillHit, DrillTool, ParseWarning, RoutedSlot, Unit, Vec } from '../types';

/**
 * Excellon 2 钻孔解析。
 * 支持：METRIC/INCH、显式小数、前导/尾随零抑制、T 刀表（含 C 直径、P 镀覆属性）、
 * G81/G82 单孔、G85 路由槽、M15/M16 路由段、M71/M72 单位、% 注释、分号注释。
 */
export function parseExcellon(text: string, fileName: string): DrillFile {
  const warnings: ParseWarning[] = [];
  const tools = new Map<string, DrillTool>();
  const hits: DrillHit[] = [];
  const slots: RoutedSlot[] = [];
  let bbox: BBox | null = null;
  const unit: Unit = inferUnit(text);
  const format: CoordFormat = { integer: unit === 'in' ? 2 : 3, decimal: unit === 'in' ? 4 : 3, zeroSuppression: inferZero(text, unit) };

  let curTool: string | null = null;
  let curPlated = true;
  let curX: number | null = null;
  let curY: number | null = null;
  let routing = false;
  let routPoints: Vec[] = [];
  let routTool: DrillTool | null = null;

  const u2mm = (v: number): number => convertToMm(v, unit);

  function parseCoord(token: string): number {
    if (token.includes('.')) return u2mm(Number(token));
    const neg = token.startsWith('-');
    const digits = token.replace(/[+-]/g, '');
    const { integer, decimal, zeroSuppression } = format;
    let padded = digits;
    if (zeroSuppression === 'L') padded = digits.padStart(integer + decimal, '0');
    else if (zeroSuppression === 'T') padded = digits.padEnd(integer + decimal, '0');
    const v = Number(`${padded.slice(0, integer)}.${padded.slice(integer)}`);
    return u2mm(neg ? -v : v);
  }

  const addHit = (x: number, y: number): void => {
    if (curTool === null) {
      warnings.push({ code: 'NO_TOOL', message: `钻孔坐标出现但未选刀: (${x.toFixed(2)}, ${y.toFixed(2)})` });
      return;
    }
    hits.push({ x, y, tool: curTool, plated: curPlated });
    bbox = unionBBox(bbox, bboxFromPoints([{ x, y }]));
  };

  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]!;
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('%')) continue;

    // 刀表定义 T1 C0.3 或 T1C0.3（板厂两种写法都常见）
    const toolDef = line.match(/^T(\d+)\s*C\s*([\d.]+)(.*)$/i);
    if (toolDef) {
      const id = `T${toolDef[1]}`;
      const diameter = u2mm(Number(toolDef[2]));
      const tail = toolDef[3] ?? '';
      // P 标识：Excellon 用 P 表示 plated（部分厂用文件头统一声明）
      const plated = /P\b/i.test(tail) || !/NPT|NON[-_ ]?PLATED/i.test(tail);
      tools.set(id, { tool: id, diameter, plated, routed: false });
      continue;
    }

    if (/^M48$/i.test(line) || /^%$/i.test(line) || /^INCH$/i.test(line) || /^METRIC/i.test(line)) {
      if (/^INCH$/i.test(line)) format.integer = 2, format.decimal = 4;
      if (/^METRIC/i.test(line)) format.integer = 3, format.decimal = 3;
      continue;
    }
    if (/^M95$/i.test(line) || /^M30$/i.test(line) || /^G90$/i.test(line) || /^G05$/i.test(line)) continue;
    if (/^G9[34]$/i.test(line)) continue; // 原点/绝对模式，默认即绝对
    if (/^G8[12]$/i.test(line)) continue; // 普通钻孔循环，坐标行处理
    if (/^G00/i.test(line) || /^G01/i.test(line)) continue;

    // 选刀（单独一行 T1）
    const toolSel = line.match(/^T(\d+)\s*$/);
    if (toolSel) {
      curTool = `T${toolSel[1]}`;
      const t = tools.get(curTool);
      curPlated = t?.plated ?? true;
      continue;
    }

    // 非镀孔区段：/ 标记（如 T2/）
    const nonPlatedSel = line.match(/^T(\d+)\s*\/\s*$/);
    if (nonPlatedSel) {
      curTool = `T${nonPlatedSel[1]}`;
      curPlated = false;
      continue;
    }

    // G85 路由槽：G85 开启路由模式，后续 X/Y 都是槽路径点，M15/M16 收尾
    if (/^G85/i.test(line)) {
      routing = true;
      routTool = curTool ? tools.get(curTool) ?? null : null;
      routPoints = [];
      const coords = readXY(line);
      if (coords) {
        routPoints.push(coords);
        curX = coords.x;
        curY = coords.y;
      }
      continue;
    }
    if (/^M15$/i.test(line)) {
      // 部分文件用 M15 开启、M16 结束；若尚未进路由则在此开启
      if (!routing) {
        routing = true;
        routTool = curTool ? tools.get(curTool) ?? null : null;
        routPoints = [];
      }
      continue;
    }
    if (routing && /^M1[67]$/i.test(line)) {
      if (routPoints.length >= 2 && routTool) {
        const slot: RoutedSlot = {
          tool: routTool.tool,
          width: routTool.diameter,
          points: routPoints,
          plated: routTool.plated,
        };
        slots.push(slot);
        routTool.routed = true;
        bbox = unionBBox(bbox, bboxFromPoints(routPoints));
      }
      routing = false;
      routPoints = [];
      routTool = null;
      continue;
    }

    const coords = readXY(line);
    if (coords) {
      if (routing) {
        routPoints.push(coords);
      } else {
        addHit(coords.x, coords.y);
      }
      curX = coords.x;
      curY = coords.y;
      continue;
    }

    if (!/^T\d+/.test(line)) {
      warnings.push({ code: 'UNHANDLED_LINE', message: `未识别的钻孔行: ${line.slice(0, 30)}`, line: li + 1 });
    }
  }

  if (routing && routPoints.length >= 2 && routTool) {
    slots.push({ tool: routTool.tool, width: routTool.diameter, points: routPoints, plated: routTool.plated });
  }

  return { fileName, unit, format, tools, hits, slots, bbox, warnings };

  function readXY(line: string): Vec | null {
    const xm = line.match(/X([-+]?[\d.]+)/);
    const ym = line.match(/Y([-+]?[\d.]+)/);
    if (!xm && !ym) return null;
    const x = xm ? parseCoord(xm[1]!) : curX ?? 0;
    const y = ym ? parseCoord(ym[1]!) : curY ?? 0;
    return { x, y };
  }
}

function inferUnit(text: string): Unit {
  if (/^METRIC/m.test(text) || /;.*metric/i.test(text)) return 'mm';
  if (/^INCH/m.test(text)) return 'in';
  // 无声明时看小数坐标量级：含 0.2~0.5 类小数多半是 mm 直径，但坐标多为整数
  return 'mm';
}

function inferZero(text: string, unit: Unit): CoordFormat['zeroSuppression'] {
  if (/ICI|IZS|TZ[,\s]|LEADING/i.test(text)) return 'T';
  if (/ICA|IZL|LZ[,\s]|TRAILING/i.test(text)) return 'L';
  // 无声明：公制缺省尾随零省略(T)在老机床上常见，但板厂 Gerber 配套多为前导零省略(L)。
  // 用坐标数字长度分布猜：若多数坐标长度 < 整数+小数位，按 L 处理更安全。
  const nums = [...text.matchAll(/[XY]([-+]?\d+)/g)].map((m) => m[1]!.replace(/[+-]/g, ''));
  if (nums.length === 0) return 'L';
  const expected = (unit === 'in' ? 6 : 6);
  const shortRatio = nums.filter((n) => n.length < expected).length / nums.length;
  return shortRatio > 0.5 ? 'L' : 'T';
}
