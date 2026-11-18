import { distanceToCopper, labelConnectedNets, netAt, rasterizeGerber, rasterPoint, type Raster } from '../raster';
import { dist } from '../geometry';
import { fmtMm } from '../units';
import type {
  BoardLayer,
  DrillFile,
  DrcRuleSet,
  DrcViolation,
  GerberFile,
  Graphic,
} from '../types';
import { RULE_LABELS, makeViolation } from './rules';

export interface DrcProgress {
  phase: string;
  percent: number;
}

/**
 * 单板工艺检查。
 * 线宽走矢量（直接量走线/光圈宽度，精确）；
 * 线距走栅格距离变换（能覆盖区域铜皮，不会漏）；
 * 孔径/孔环结合钻孔表与焊盘掩膜。
 */
export async function runDrc(
  layers: ReadonlyArray<BoardLayer>,
  rules: DrcRuleSet,
  onProgress?: (p: DrcProgress) => void,
): Promise<DrcViolation[]> {
  const violations: DrcViolation[] = [];
  const copperLayers = layers.filter((l) => l.role === 'copper' && l.gerber);
  const drillLayers = layers.filter((l) => l.role === 'drill' && l.drill);
  const silkLayers = layers.filter((l) => l.role === 'silkscreen' && l.gerber);

  // 1. 矢量类检查：最小线宽
  onProgress?.({ phase: '检查走线线宽', percent: 10 });
  for (const layer of copperLayers) {
    checkTraceWidth(layer.gerber!, rules, violations, layer.id);
  }

  // 2. 钻孔孔径
  onProgress?.({ phase: '检查钻孔孔径', percent: 25 });
  for (const layer of drillLayers) {
    checkDrillSize(layer.drill!, rules, violations, layer.id);
  }

  // 3. 栅格类检查：每层铜皮线距 + 孔环
  for (let i = 0; i < copperLayers.length; i++) {
    const layer = copperLayers[i]!;
    onProgress?.({ phase: `栅格化 ${layer.fileName}`, percent: 30 + (i / copperLayers.length) * 50 });
    await yieldToUi();
    const bbox = layer.gerber!.bbox;
    if (!bbox) continue;
    const raster = rasterizeGerber(layer.gerber!, bbox, { resolutionMm: 0.01 });
    const nets = labelConnectedNets(raster);

    checkClearance(raster, nets, rules, violations, layer.id);
    const drill = drillLayers.find((d) => d.drill)?.drill;
    if (drill) checkAnnularRing(raster, drill, rules, violations, layer.id);
    checkDangling(raster, nets, rules, violations, layer.id);
  }

  // 4. 丝印间距（丝印对焊盘）
  onProgress?.({ phase: '检查丝印间距', percent: 90 });
  for (const silk of silkLayers) {
    const copper = copperLayers.find((l) => l.side === silk.side) ?? copperLayers[0];
    if (copper?.gerber && silk.gerber?.bbox && copper.gerber.bbox) {
      checkSilkSpacing(silk.gerber, copper.gerber, rules, violations, silk.id);
    }
  }

  onProgress?.({ phase: '完成', percent: 100 });
  return violations.sort((a, b) => a.rule.localeCompare(b.rule));
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* ---------------- 线宽（矢量，精确） ---------------- */

function checkTraceWidth(gf: GerberFile, rules: DrcRuleSet, out: DrcViolation[], layerId: string): void {
  const min = rules.rules.minTraceWidth;
  const reported = new Set<string>();
  for (const g of gf.graphics) {
    if (g.pol === 'clear') continue;
    const width = graphicWidth(g, gf);
    if (width === null || width >= min) continue;
    const key = `${Math.round(width * 1000)}`;
    if (reported.has(key)) continue; // 同类细线只报首例，避免清单爆炸；位置给首件
    reported.add(key);
    const p = graphicPoint(g);
    out.push(
      makeViolation({
        rule: 'minTraceWidth',
        severity: 'error',
        message: `${RULE_LABELS.minTraceWidth} ${fmtMm(width)} 小于要求 ${fmtMm(min)}`,
        x: p.x,
        y: p.y,
        measured: width,
        required: min,
        layerId,
      }),
    );
  }
}

function graphicWidth(g: Graphic, gf: GerberFile): number | null {
  if (g.kind === 'line' || g.kind === 'arc') return g.width;
  if (g.kind === 'flash') {
    const ap = gf.apertures.get(g.dcode);
    if (!ap) return null;
    const s = ap.shape;
    if (s.kind === 'circle') return s.diameter;
    if (s.kind === 'rect' || s.kind === 'obround') return Math.min(s.width, s.height);
    if (s.kind === 'poly') return s.diameter * Math.cos(Math.PI / s.vertices);
  }
  return null;
}

function graphicPoint(g: Graphic): { x: number; y: number } {
  if (g.kind === 'flash') return { x: g.x, y: g.y };
  if (g.kind === 'region') return { x: g.contours[0]?.sx ?? 0, y: g.contours[0]?.sy ?? 0 };
  return { x: g.x1, y: g.y1 };
}

/* ---------------- 孔径 ---------------- */

function checkDrillSize(df: DrillFile, rules: DrcRuleSet, out: DrcViolation[], layerId: string): void {
  const min = rules.rules.minDrillSize;
  for (const tool of df.tools.values()) {
    if (tool.diameter >= min) continue;
    const first = df.hits.find((h) => h.tool === tool.tool) ?? df.slots.find((s) => s.tool === tool.tool)?.points[0];
    if (!first) continue;
    const p = 'x' in first ? first : first!;
    out.push(
      makeViolation({
        rule: 'minDrillSize',
        severity: 'error',
        message: `刀具 ${tool.tool} 孔径 ${fmtMm(tool.diameter)} 小于要求 ${fmtMm(min)}`,
        x: p.x,
        y: p.y,
        measured: tool.diameter,
        required: min,
        layerId,
      }),
    );
  }
}

/* ---------------- 线距（栅格距离变换） ---------------- */

function checkClearance(r: Raster, nets: { labels: Int32Array; count: number }, rules: DrcRuleSet, out: DrcViolation[], layerId: string): void {
  const min = rules.rules.minClearance;
  const distMap = distanceToCopper(r);
  // 找"夹在两个不同网络之间"的基材像素：只在边界附近、且距离最小的位置报一处
  let best: { d: number; idx: number; n1: number; n2: number } | null = null;
  const { widthPx: w, heightPx: h, mask } = r;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (mask[idx]) continue;
      const d = distMap[idx]!;
      if (d >= min / 2 + r.resolutionMm) continue; // 两侧间隙 = 2d
      // 看四邻铜像素是否属于不同网络
      const neigh = new Set<number>();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = (y + dy) * w + (x + dx);
        if (mask[n]) neigh.add(nets.labels[n]!);
      }
      if (neigh.size >= 2) {
        const ids = [...neigh];
        if (!best || d < best.d) best = { d, idx, n1: ids[0]!, n2: ids[1]! };
      }
    }
  }

  if (best && best.d * 2 < min) {
    const py = Math.floor(best.idx / w);
    const px = best.idx - py * w;
    const board = rasterToBoardLocal(r, px, py);
    out.push(
      makeViolation({
        rule: 'minClearance',
        severity: 'error',
        message: `${RULE_LABELS.minClearance}约 ${fmtMm(best.d * 2)} 小于要求 ${fmtMm(min)}（网络 #${best.n1} ↔ #${best.n2}）`,
        x: board.x,
        y: board.y,
        measured: best.d * 2,
        required: min,
        layerId,
      }),
    );
  }
}

/* ---------------- 孔环：焊盘外半径 - 孔半径 ---------------- */

function checkAnnularRing(r: Raster, df: DrillFile, rules: DrcRuleSet, out: DrcViolation[], layerId: string): void {
  const min = rules.rules.minAnnularRing;
  const checkRadius = Math.ceil((min + 1.2) / r.resolutionMm); // 采样窗口
  const reported = new Set<string>();

  for (const hit of df.hits) {
    if (!hit.plated) continue; // 非镀孔不要求孔环
    const tool = df.tools.get(hit.tool);
    if (!tool) continue;
    const { px, py } = rasterPoint(r, hit.x, hit.y);
    // 找窗口内离孔心最远的铜像素距离（mm），即焊盘外半径近似
    let outer = 0;
    for (let dy = -checkRadius; dy <= checkRadius; dy++) {
      for (let dx = -checkRadius; dx <= checkRadius; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= r.widthPx || y >= r.heightPx) continue;
        if (!r.mask[y * r.widthPx + x]) continue;
        const dMm = Math.hypot(dx, dy) * r.resolutionMm;
        if (dMm > outer) outer = dMm;
      }
    }
    if (outer === 0) continue; // 该层无对应焊盘（可能是内层散热盘，交给人工）
    const ring = outer - tool.diameter / 2;
    if (ring < min) {
      const key = `${tool.tool}:${Math.round(ring * 1000)}`;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push(
        makeViolation({
          rule: 'minAnnularRing',
          severity: 'error',
          message: `孔 ${tool.tool} 处孔环约 ${fmtMm(Math.max(ring, 0))} 小于要求 ${fmtMm(min)}`,
          x: hit.x,
          y: hit.y,
          measured: Math.max(ring, 0),
          required: min,
          layerId,
        }),
      );
    }
  }
}

/* ---------------- 断头线：极小网络（孤立线段/死铜） ---------------- */

function checkDangling(r: Raster, nets: { labels: Int32Array; sizes: Map<number, number>; count: number }, _rules: DrcRuleSet, out: DrcViolation[], layerId: string): void {
  // 面积小于 0.5mm² 且不接触任何焊盘尺寸的连通域，视为断头/死铜候选
  const minAreaPx = 0.5 / (r.resolutionMm * r.resolutionMm);
  for (const [nid, size] of nets.sizes) {
    if (size >= minAreaPx) continue;
    // 找该网络首个像素定位
    let idx = -1;
    for (let i = 0; i < nets.labels.length; i++) {
      if (nets.labels[i] === nid) {
        idx = i;
        break;
      }
    }
    if (idx < 0) continue;
    const py = Math.floor(idx / r.widthPx);
    const px = idx - py * r.widthPx;
    const board = rasterToBoardLocal(r, px, py);
    out.push(
      makeViolation({
        rule: 'minClearance',
        severity: 'warning',
        message: `疑似断头线/孤立死铜：网络 #${nid} 面积仅 ${(size * r.resolutionMm * r.resolutionMm).toFixed(3)} mm²`,
        x: board.x,
        y: board.y,
        layerId,
      }),
    );
  }
}

/* ---------------- 丝印间距（栅格掩膜边界距离） ---------------- */

function checkSilkSpacing(silk: GerberFile, copper: GerberFile, rules: DrcRuleSet, out: DrcViolation[], layerId: string): void {
  const min = rules.rules.minSilkSpacing;
  const bbox = silk.bbox ?? copper.bbox;
  if (!bbox) return;
  const silkR = rasterizeGerber(silk, bbox, { resolutionMm: 0.02, color: '#fff' });
  const copR = rasterizeGerber(copper, bbox, { resolutionMm: 0.02, color: '#fff' });
  const copDist = distanceToCopper(copR);

  let worst: { d: number; idx: number } | null = null;
  for (let i = 0; i < silkR.mask.length; i++) {
    if (!silkR.mask[i]) continue;
    const d = copDist[i]!;
    if (!worst || d < worst.d) worst = { d, idx: i };
  }
  if (worst && worst.d < min) {
    const py = Math.floor(worst.idx / silkR.widthPx);
    const px = worst.idx - py * silkR.widthPx;
    const board = rasterToBoardLocal(silkR, px, py);
    out.push(
      makeViolation({
        rule: 'minSilkSpacing',
        severity: 'warning',
        message: `丝印距焊盘/铜皮约 ${fmtMm(worst.d)} 小于要求 ${fmtMm(min)}`,
        x: board.x,
        y: board.y,
        measured: worst.d,
        required: min,
        layerId,
      }),
    );
  }
}

function rasterToBoardLocal(r: Raster, px: number, py: number): { x: number; y: number } {
  return {
    x: r.bbox.minX + (px + 0.5) * r.resolutionMm,
    y: r.bbox.maxY - (py + 0.5) * r.resolutionMm,
  };
}

/** 供查看页调用：点一根走线找整网图元 */
export function findNetAt(layer: BoardLayer, x: number, y: number): { net: number; graphics: Set<Graphic> } | null {
  if (!layer.gerber?.bbox) return null;
  const r = rasterizeGerber(layer.gerber, layer.gerber.bbox, { resolutionMm: 0.02 });
  const nets = labelConnectedNets(r);
  const nid = netAt(nets, r, x, y);
  if (nid < 0) return null;
  return { net: nid, graphics: collectNetGraphics(layer.gerber, r, nets, nid) };
}

function collectNetGraphics(gf: GerberFile, r: Raster, nets: ReturnType<typeof labelConnectedNets>, nid: number): Set<Graphic> {
  const out = new Set<Graphic>();
  for (const g of gf.graphics) {
    if (g.pol === 'clear') continue;
    const p = graphicPoint(g);
    const { px, py } = rasterPoint(r, p.x, p.y);
    if (nets.labels[py * r.widthPx + px] === nid) out.add(g);
  }
  return out;
}

// 防止未使用告警（dist 预留给后续几何校验）
void dist;
