import { bboxFromPoints, unionBBox, bboxGrow } from '../geometry';
import type { BBox } from '../types';
import { convertToMm, inToMm } from '../units';
import type {
  Aperture,
  ApertureShape,
  CoordFormat,
  FlashPrim,
  GerberFile,
  Graphic,
  ParseWarning,
  Polarity,
  RegionContour,
  RegionPrim,
  RegionSeg,
  Unit,
} from '../types';
import { instantiateMacro, parseMacroBody, type MacroDef } from './apertureMacro';

interface ParserState {
  unit: Unit;
  format: CoordFormat;
  absolute: boolean;
  curX: number;
  curY: number;
  polarity: Polarity;
  currentDcode: number | null;
  interp: 'line' | 'cw' | 'ccw';
  multiQuadrant: boolean;
  inRegion: boolean;
  regionContours: RegionContour[];
  regionStartX: number;
  regionStartY: number;
  regionSegs: RegionSeg[];
  blockApertureDcode: number | null;
  stepRepeat: { nx: number; ny: number; dx: number; dy: number } | null;
}

export function parseGerber(text: string, fileName: string): GerberFile {
  const warnings: ParseWarning[] = [];
  const apertures = new Map<number, Aperture>();
  const macroDefs = new Map<string, MacroDef>();
  const graphics: Graphic[] = [];
  let bbox: BBox | null = null;
  let initialPolarity: Polarity = 'dark';

  const st: ParserState = {
    unit: 'mm',
    format: { integer: 2, decimal: 5, zeroSuppression: 'L' }, // Gerber 缺省 2.5 L
    absolute: true,
    curX: 0,
    curY: 0,
    polarity: 'dark',
    currentDcode: null,
    interp: 'line',
    multiQuadrant: false,
    inRegion: false,
    regionContours: [],
    regionStartX: 0,
    regionStartY: 0,
    regionSegs: [],
    blockApertureDcode: null,
    stepRepeat: null,
  };

  const u2mm = (v: number): number => convertToMm(v, st.unit);

  /** I/J 圆心偏移：相对当前点，每条 NC 命令解析前提取一次；声明需早于主解析循环 */
  let pendingIJ: { i: number; j: number } | null = null;

  // 块光圈（AB）：dcode -> 块内图元，闪光时整组平移拷贝
  const blockApertures = new Map<number, Graphic[]>();

  const warn = (code: string, message: string, line?: number) => warnings.push({ code, message, line });

  const commands = splitCommands(text);

  for (let li = 0; li < commands.length; li++) {
    const raw = commands[li]!;
    const cmd = raw.trim();
    if (!cmd) continue;

    if (cmd.startsWith('%')) {
      handleExtended(cmd, li + 1);
      continue;
    }

    // 普通 NC 命令（可能一行多个 D 码）
    handleNc(cmd, li + 1);
  }

  if (st.inRegion) {
    warn('REGION_NOT_CLOSED', '文件结束时区域未遇到 G37，已按现状闭合');
    flushRegion();
  }

  return {
    fileName,
    unit: st.unit,
    format: st.format,
    apertures,
    graphics,
    bbox,
    initialPolarity,
    warnings,
  };

  /* ---------------- 扩展命令 %...% ---------------- */

  function handleExtended(cmd: string, lineNo: number): void {
    const body = cmd.replace(/^%/, '').replace(/%$/, '');
    // 一条物理行里可能有多个 %...% 块
    for (const piece of body.split('%%')) {
      const c = piece.trim();
      if (!c) continue;
      if (c.startsWith('FS')) handleFS(c);
      else if (c.startsWith('MO')) handleMO(c);
      else if (c.startsWith('AD')) handleAD(c);
      else if (c.startsWith('AM')) handleAM(c);
      else if (c.startsWith('LP')) {
        st.polarity = c.includes('C') ? 'clear' : 'dark';
        if (graphics.length === 0) initialPolarity = st.polarity;
      } else if (c.startsWith('LM')) {
        if (c.includes('I')) {
          st.absolute = false;
          warn('LM_INCREMENTAL', '文件使用增量坐标（LN=I），已支持', lineNo);
        } else {
          st.absolute = true;
        }
      } else if (c.startsWith('LR') || c.startsWith('LS')) {
        warn('ROTATION', `旋转/镜像命令 ${c.slice(0, 2)} 已解析但按恒等处理（小板文件罕见）`, lineNo);
      } else if (c.startsWith('SR')) {
        handleSR(c);
      } else if (c.startsWith('AB')) {
        handleAB(c);
      } else if (c.startsWith('TF') || c.startsWith('TA') || c.startsWith('TD') || c.startsWith('TO')) {
        // 文件属性：层识别在文件名/属性层做，这里忽略
      } else if (c.startsWith('G04')) {
        // 注释
      } else {
        warn('UNSUPPORTED_EXT', `未实现的扩展命令: ${c.slice(0, 12)}`, lineNo);
      }
    }
  }

  function handleFS(c: string): void {
    // FSLA X... Y...  / FSLAX36Y36
    const zero = c.includes('L') ? 'L' : c.includes('T') ? 'T' : 'D';
    st.absolute = c.includes('A');
    const xm = c.match(/X(\d)(\d)/);
    const ym = c.match(/Y(\d)(\d)/);
    if (xm) st.format = { integer: Number(xm[1]), decimal: Number(xm[2]), zeroSuppression: zero };
    if (ym && !xm) st.format = { integer: Number(ym[1]), decimal: Number(ym[2]), zeroSuppression: zero };
  }

  function handleMO(c: string): void {
    st.unit = c.includes('IN') ? 'in' : 'mm';
  }

  function handleAM(c: string): void {
    // 形如 %AMYMAC*\n1,1,...*\n% —— 定义体里的 * 是语句分隔符
    const nl = c.indexOf('\n');
    const headerRaw = nl >= 0 ? c.slice(0, nl) : c;
    const header = headerRaw.replace(/^%/, '').replace(/[*%]$/, '').trim();
    const name = header.replace(/^AM/, '').trim();
    const body = nl >= 0 ? c.slice(nl + 1).replace(/%$/, '') : '';
    macroDefs.set(name, parseMacroBody(name, body));
  }

  function handleAD(c: string): void {
    // ADD10C,0.25 或 ADD12MACRO,1.0X0.5X...
    // Gerber 光圈定义字面为 ADD<Dcode><形状>[,<参数>]
    const m = c.match(/^ADD(\d+)([A-Za-z][A-Za-z0-9_]*)(?:,(.*))?$/);
    if (!m) {
      warn('AD_BAD', `无法解析光圈定义: ${c}`);
      return;
    }
    const dcode = Number(m[1]);
    const shapeToken = m[2]!;
    const rest = m[3] ?? '';
    const mods = rest ? rest.split('X').map((s) => Number(s.trim())) : [];

    if (shapeToken === 'C' || shapeToken === 'R' || shapeToken === 'O' || shapeToken === 'P') {
      const shape = buildStandardShape(shapeToken, mods);
      if (shape) apertures.set(dcode, { dcode, shape });
      else warn('AD_BAD_SHAPE', `标准光圈参数非法: ${c}`);
      return;
    }

    // 宏光圈
    const def = macroDefs.get(shapeToken);
    if (!def) {
      warn('MACRO_MISSING', `光圈 D${dcode} 引用了未定义的宏 ${shapeToken}`);
      apertures.set(dcode, { dcode, shape: { kind: 'macro', macroName: shapeToken } });
      return;
    }
    const macro = instantiateMacro(def, mods, u2mm);
    apertures.set(dcode, { dcode, shape: { kind: 'macro', macroName: shapeToken }, macro });
  }

  function buildStandardShape(token: string, mods: number[]): ApertureShape | null {
    const d0 = mods[0];
    if (d0 === undefined || !Number.isFinite(d0) || d0 <= 0) return null;
    const hole = mods[1] && mods[1] > 0 ? u2mm(mods[1]) : undefined;
    switch (token) {
      case 'C':
        return { kind: 'circle', diameter: u2mm(d0), holeDiameter: hole };
      case 'R': {
        const h = mods[1];
        if (h === undefined || h <= 0) return null;
        return { kind: 'rect', width: u2mm(d0), height: u2mm(h), holeDiameter: mods[2] ? u2mm(mods[2]) : undefined };
      }
      case 'O': {
        const h = mods[1];
        if (h === undefined || h <= 0) return null;
        return { kind: 'obround', width: u2mm(d0), height: u2mm(h), holeDiameter: mods[2] ? u2mm(mods[2]) : undefined };
      }
      case 'P': {
        const vertices = mods[1];
        if (vertices === undefined || vertices < 3) return null;
        return {
          kind: 'poly',
          diameter: u2mm(d0),
          vertices: Math.round(vertices),
          rotationDeg: mods[2] ?? 0,
          holeDiameter: mods[3] ? u2mm(mods[3]) : undefined,
        };
      }
      default:
        return null;
    }
  }

  function handleSR(c: string): void {
    // SRX2Y3I0J5 —— 结束符 %SR% 关闭。I/J 是板坐标，按 FS 格式解析
    if (c === 'SR') {
      st.stepRepeat = null;
      return;
    }
    const x = Number(c.match(/X(\d+)/)?.[1] ?? 1);
    const y = Number(c.match(/Y(\d+)/)?.[1] ?? 1);
    const iToken = c.match(/I([-\d.]+)/)?.[1];
    const jToken = c.match(/J([-\d.]+)/)?.[1];
    const dx = iToken !== undefined ? parseCoord(iToken) : 0;
    const dy = jToken !== undefined ? parseCoord(jToken) : 0;
    st.stepRepeat = { nx: x, ny: y, dx, dy };
  }

  function handleAB(c: string): void {
    // ABD12 开始块定义；AB 结束。块内 D03 不直接出图，而是记入块模板
    const m = c.match(/^ABD?(\d+)?/);
    if (m && m[1]) {
      st.blockApertureDcode = Number(m[1]);
      blockBuffer = [];
    } else if (c === 'AB' || c === 'AB%') {
      if (st.blockApertureDcode !== null) {
        blockApertures.set(st.blockApertureDcode, blockBuffer);
        apertures.set(st.blockApertureDcode, {
          dcode: st.blockApertureDcode,
          shape: { kind: 'macro', macroName: `__block_${st.blockApertureDcode}` },
          macro: [],
        });
      }
      st.blockApertureDcode = null;
      blockBuffer = [];
    }
  }
  let blockBuffer: Graphic[] = [];

  /* ---------------- NC 命令 ---------------- */

  function handleNc(rawCmd: string, lineNo: number): void {
    let cmd = rawCmd.replace(/^N\d+/, '');
    pendingIJ = null;
    const iMatch = cmd.match(/I([-+]?[\d.]+)/);
    const jMatch = cmd.match(/J([-+]?[\d.]+)/);
    if (iMatch || jMatch) {
      pendingIJ = {
        i: iMatch ? parseCoord(iMatch[1]!) : 0,
        j: jMatch ? parseCoord(jMatch[1]!) : 0,
      };
    }
    // G 码与坐标可在同一命令；逐个 G 前缀处理
    const gMatches = [...cmd.matchAll(/G0?(\d+)/g)];
    for (const gm of gMatches) {
      const g = Number(gm[1]);
      if (g === 1) st.interp = 'line';
      else if (g === 2) st.interp = 'cw';
      else if (g === 3) st.interp = 'ccw';
      else if (g === 4) st.multiQuadrant = false;
      else if (g === 5) st.multiQuadrant = true;
      else if (g === 36) beginRegion();
      else if (g === 37) flushRegion();
      else if (g === 70) st.unit = 'in';
      else if (g === 71) st.unit = 'mm';
      else if (g === 90) st.absolute = true;
      else if (g === 91) st.absolute = false;
      else if (g === 54 || g === 55) warn('G54', `G${g} 已废弃，按普通选光圈处理`, lineNo);
    }
    cmd = cmd.replace(/G0?\d+/g, '');

    // 坐标
    const hasX = /X[-+]?[\d.]+/.test(cmd);
    const hasY = /Y[-+]?[\d.]+/.test(cmd);
    let nx = st.curX;
    let ny = st.curY;
    if (hasX) {
      const v = parseCoord(cmd.match(/X([-+]?[\d.]+)/)![1]!);
      nx = st.absolute ? v : st.curX + v;
    }
    if (hasY) {
      const v = parseCoord(cmd.match(/Y([-+]?[\d.]+)/)![1]!);
      ny = st.absolute ? v : st.curY + v;
    }

    const dMatch = cmd.match(/D0?(\d+)\s*$/);
    const d = dMatch ? Number(dMatch[1]) : null;

    // 纯 D 码（无坐标）：D01/D02/D03 或选光圈
    if (!hasX && !hasY) {
      if (d !== null) {
        if (d >= 10) st.currentDcode = d;
        else if (d === 2) moveTo(nx, ny);
      }
      return;
    }

    if (d === null) {
      // 有坐标无 D 码：区域内视作绘制段，区域外按 D01 画线
      if (st.inRegion) addRegionSeg(nx, ny);
      else drawSegment(nx, ny);
      st.curX = nx;
      st.curY = ny;
      return;
    }

    if (d >= 10) {
      // 换光圈同时带坐标：选光圈，坐标忽略移动语义（罕见，按规范不移动）
      st.currentDcode = d;
      return;
    }

    if (d === 2) {
      moveTo(nx, ny);
    } else if (d === 1) {
      if (st.inRegion) addRegionSeg(nx, ny);
      else drawSegment(nx, ny);
      st.curX = nx;
      st.curY = ny;
    } else if (d === 3) {
      if (st.inRegion) {
        warn('D03_IN_REGION', '区域内出现 D03 闪光，按 D02 移动处理', lineNo);
        moveTo(nx, ny);
      } else {
        flashAt(nx, ny);
      }
      st.curX = nx;
      st.curY = ny;
    }
  }

  function parseCoord(token: string): number {
    // 显式小数点：直接按文件单位取值
    if (token.includes('.')) return u2mm(Number(token));
    const neg = token.startsWith('-');
    const digits = token.replace(/[+-]/g, '');
    const { integer, decimal, zeroSuppression } = st.format;
    let padded = digits;
    if (zeroSuppression === 'L') {
      padded = digits.padStart(integer + decimal, '0');
    } else if (zeroSuppression === 'T') {
      padded = digits.padEnd(integer + decimal, '0');
    }
    const intPart = padded.slice(0, integer);
    const decPart = padded.slice(integer);
    const value = Number(`${intPart}.${decPart}`);
    return u2mm(neg ? -value : value);
  }

  function currentAperture(): Aperture | null {
    if (st.currentDcode === null) return null;
    return apertures.get(st.currentDcode) ?? null;
  }

  function moveTo(x: number, y: number): void {
    if (st.inRegion) {
      // 区域内 D02：结束当前轮廓，开新轮廓
      if (st.regionSegs.length > 0) st.regionContours.push({ sx: st.regionStartX, sy: st.regionStartY, segs: st.regionSegs });
      st.regionStartX = x;
      st.regionStartY = y;
      st.regionSegs = [];
    }
    st.curX = x;
    st.curY = y;
  }

  function drawSegment(x: number, y: number): void {
    const ap = currentAperture();
    if (!ap) {
      warn('NO_APERTURE', `D01 绘制时未选择光圈，位置 (${x.toFixed(2)}, ${y.toFixed(2)})`);
      return;
    }
    const width = apertureDrawWidth(ap);
    if (st.interp === 'line') {
      emit({ kind: 'line', pol: st.polarity, x1: st.curX, y1: st.curY, x2: x, y2: y, width, dcode: ap.dcode });
    } else {
      // G02/G03：I/J 是相对当前点的圆心偏移
      const cx = st.curX + (pendingIJ?.i ?? 0);
      const cy = st.curY + (pendingIJ?.j ?? 0);
      const samePoint = x === st.curX && y === st.curY;
      emit({
        kind: 'arc',
        pol: st.polarity,
        x1: st.curX,
        y1: st.curY,
        x2: x,
        y2: y,
        cx,
        cy,
        width,
        ccw: st.interp === 'ccw',
        // G75 起终点重合 = 整圆；G74 不允许整圆，标记 full 后渲染端按多象限处理
        full: samePoint,
        dcode: ap.dcode,
      });
    }
  }

  function flashAt(x: number, y: number): void {
    if (st.currentDcode === null) {
      warn('NO_APERTURE', 'D03 闪光时未选择光圈');
      return;
    }
    const block = blockApertures.get(st.currentDcode);
    if (block) {
      for (const g of block) emit(translateGraphic(g, x, y));
      return;
    }
    const f: FlashPrim = {
      kind: 'flash',
      pol: st.polarity,
      x,
      y,
      dcode: st.currentDcode,
      rotationDeg: 0,
    };
    emit(f);
  }

  function beginRegion(): void {
    st.inRegion = true;
    st.regionContours = [];
    st.regionSegs = [];
    st.regionStartX = st.curX;
    st.regionStartY = st.curY;
  }

  function addRegionSeg(x: number, y: number): void {
    if (st.interp === 'line') {
      st.regionSegs.push({ type: 'line', x, y });
    } else {
      st.regionSegs.push({
        type: 'arc',
        x,
        y,
        cx: st.curX + (pendingIJ?.i ?? 0),
        cy: st.curY + (pendingIJ?.j ?? 0),
        ccw: st.interp === 'ccw',
      });
    }
  }

  function flushRegion(): void {
    if (!st.inRegion) return;
    if (st.regionSegs.length > 0) {
      st.regionContours.push({ sx: st.regionStartX, sy: st.regionStartY, segs: st.regionSegs });
    }
    if (st.regionContours.length > 0) {
      const prim: RegionPrim = { kind: 'region', pol: st.polarity, contours: st.regionContours };
      emit(prim);
    }
    st.inRegion = false;
    st.regionContours = [];
    st.regionSegs = [];
  }

  /* I/J 已在 handleNc 入口提取到 pendingIJ */

  function emit(g: Graphic): void {
    if (st.blockApertureDcode !== null) {
      blockBuffer.push(g);
      return;
    }
    if (st.stepRepeat) {
      const { nx, ny, dx, dy } = st.stepRepeat;
      for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
          const gg = translateGraphic(g, ix * dx, iy * dy);
          graphics.push(gg);
          bbox = unionBBox(bbox, graphicBBox(gg));
        }
      }
    } else {
      graphics.push(g);
      bbox = unionBBox(bbox, graphicBBox(g));
    }
  }
}

/* ---------------- 模块级辅助 ---------------- */

function splitCommands(text: string): string[] {
  // 规则：普通命令以 * 结束；%...% 扩展块整体作为一条，块内 * 不切分；
  // 扩展块结束的 % 后立即收口。AM 宏体可跨多行，全部收在块内。
  const out: string[] = [];
  let buf = '';
  let inExt = false;
  for (const ch of text) {
    if (ch === '%') {
      if (!inExt) {
        if (buf.trim()) out.push(buf);
        buf = '%';
        inExt = true;
      } else {
        // 普通参数（FS/MO/AD/LP 等）收口前的 * 要去掉；AM 宏体的 * 是语句分隔符，保留
        if (buf.endsWith('*') && !buf.startsWith('%AM')) buf = buf.slice(0, -1);
        buf += '%';
        out.push(buf);
        buf = '';
        inExt = false;
      }
      continue;
    }
    if (ch === '*' && !inExt) {
      if (buf.trim()) out.push(buf);
      buf = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inExt) {
      if (buf.trim()) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function apertureDrawWidth(ap: Aperture): number {
  const s = ap.shape;
  if (s.kind === 'circle') return s.diameter;
  if (s.kind === 'rect') return Math.min(s.width, s.height);
  if (s.kind === 'obround') return Math.min(s.width, s.height);
  if (s.kind === 'poly') return s.diameter * Math.cos(Math.PI / s.vertices); // 对边距近似
  return 0.2; // 宏光圈画线罕见，给兜底并由警告覆盖
}

function translateGraphic(g: Graphic, dx: number, dy: number): Graphic {
  switch (g.kind) {
    case 'line':
      return { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy };
    case 'arc':
      return { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy, cx: g.cx + dx, cy: g.cy + dy };
    case 'flash':
      return { ...g, x: g.x + dx, y: g.y + dy };
    case 'region':
      return {
        ...g,
        contours: g.contours.map((c) => ({
          sx: c.sx + dx,
          sy: c.sy + dy,
          segs: c.segs.map((s) =>
            s.type === 'line'
              ? { type: 'line', x: s.x + dx, y: s.y + dy }
              : { type: 'arc', x: s.x + dx, y: s.y + dy, cx: s.cx + dx, cy: s.cy + dy, ccw: s.ccw },
          ) as RegionSeg[],
        })),
      };
  }
}

export function graphicBBox(g: Graphic): BBox | null {
  switch (g.kind) {
    case 'line':
      return bboxGrow(bboxFromPoints([{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }]), g.width / 2);
    case 'arc': {
      const r = Math.hypot(g.x1 - g.cx, g.y1 - g.cy);
      return bboxGrow(bboxFromPoints([{ x: g.cx, y: g.cy }]), r + g.width / 2);
    }
    case 'flash':
      return bboxFromPoints([{ x: g.x, y: g.y }]); // 精确半径由渲染端补，这里给点
    case 'region': {
      const pts: { x: number; y: number }[] = [];
      for (const c of g.contours) {
        pts.push({ x: c.sx, y: c.sy });
        for (const s of c.segs) pts.push({ x: s.x, y: s.y });
      }
      return bboxFromPoints(pts);
    }
  }
}

/** 英寸文件在实例化宏之后若需要二次换算（预留，目前宏内已直接 u2mm） */
export function ensureMm(v: number, unit: Unit): number {
  return unit === 'in' ? inToMm(v) : v;
}
