import { dist, distPointSegment, projectPointSegment, tessellateArc } from './geometry';
import type { Aperture, DrillFile, GerberFile, Graphic, Vec } from './types';

export interface SnapTarget {
  point: Vec;
  kind: 'pad-center' | 'trace-edge' | 'drill-center' | 'vertex';
  distanceMm: number;
  graphic?: Graphic;
}

/**
 * 在阈值半径内找吸附目标。优先焊盘/钻孔中心，其次走线边缘投影，最后区域顶点。
 * 只在以光标为中心的小包围盒内检索，避免几十万图元全扫。
 */
export function snap(
  gerbers: ReadonlyArray<GerberFile>,
  drills: ReadonlyArray<DrillFile>,
  p: Vec,
  thresholdMm: number,
): SnapTarget | null {
  const q = { minX: p.x - thresholdMm, minY: p.y - thresholdMm, maxX: p.x + thresholdMm, maxY: p.y + thresholdMm };
  const candidates: SnapTarget[] = [];

  for (const gf of gerbers) {
    for (const g of gf.graphics) {
      if (!bboxHit(g, q)) continue;
      collectSnaps(g, gf.apertures, p, thresholdMm, candidates);
    }
  }
  for (const df of drills) {
    for (const h of df.hits) {
      const d = dist(p.x, p.y, h.x, h.y);
      if (d <= thresholdMm) candidates.push({ point: { x: h.x, y: h.y }, kind: 'drill-center', distanceMm: d });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => priority(a) - priority(b) || a.distanceMm - b.distanceMm);
  return candidates[0]!;
}

function priority(t: SnapTarget): number {
  return t.kind === 'pad-center' || t.kind === 'drill-center' ? 0 : t.kind === 'trace-edge' ? 1 : 2;
}

function bboxHit(g: Graphic, q: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  switch (g.kind) {
    case 'line':
      return !(Math.max(g.x1, g.x2) < q.minX || Math.min(g.x1, g.x2) > q.maxX || Math.max(g.y1, g.y2) < q.minY || Math.min(g.y1, g.y2) > q.maxY);
    case 'arc': {
      const r = Math.hypot(g.x1 - g.cx, g.y1 - g.cy);
      return !(g.cx + r < q.minX || g.cx - r > q.maxX || g.cy + r < q.minY || g.cy - r > q.maxY);
    }
    case 'flash':
      return g.x >= q.minX && g.x <= q.maxX && g.y >= q.minY && g.y <= q.maxY;
    case 'region':
      return g.contours.some((c) => {
        if (c.sx < q.minX || c.sx > q.maxX || c.sy < q.minY || c.sy > q.maxY) {
          // 粗检：任一段端点在框内即可
        }
        return true; // 区域通常数量少，直接放行到细检
      });
  }
}

function collectSnaps(
  g: Graphic,
  apertures: Map<number, Aperture>,
  p: Vec,
  threshold: number,
  out: SnapTarget[],
): void {
  if (g.kind === 'flash') {
    const d = dist(p.x, p.y, g.x, g.y);
    if (d <= threshold + apertureRadius(apertures.get(g.dcode))) {
      out.push({ point: { x: g.x, y: g.y }, kind: 'pad-center', distanceMm: d, graphic: g });
    }
    return;
  }
  if (g.kind === 'line') {
    const proj = projectPointSegment(p.x, p.y, g.x1, g.y1, g.x2, g.y2);
    const d = dist(p.x, p.y, proj.x, proj.y) - g.width / 2;
    if (Math.abs(d) <= threshold) {
      // 边缘点：沿法向推半线宽
      const nx = -(g.y2 - g.y1);
      const ny = g.x2 - g.x1;
      const nl = Math.hypot(nx, ny) || 1;
      const side = Math.sign((p.x - proj.x) * nx + (p.y - proj.y) * ny) || 1;
      out.push({
        point: { x: proj.x + (nx / nl) * (g.width / 2) * side, y: proj.y + (ny / nl) * (g.width / 2) * side },
        kind: 'trace-edge',
        distanceMm: Math.abs(d),
        graphic: g,
      });
    }
    if (dist(p.x, p.y, g.x1, g.y1) <= threshold) out.push({ point: { x: g.x1, y: g.y1 }, kind: 'vertex', distanceMm: dist(p.x, p.y, g.x1, g.y1), graphic: g });
    if (dist(p.x, p.y, g.x2, g.y2) <= threshold) out.push({ point: { x: g.x2, y: g.y2 }, kind: 'vertex', distanceMm: dist(p.x, p.y, g.x2, g.y2), graphic: g });
    return;
  }
  if (g.kind === 'arc') {
    const pts = tessellateArc(g.x1, g.y1, g.x2, g.y2, g.cx, g.cy, { multiQuadrant: true, ccw: g.ccw, full: g.full });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const d = distPointSegment(p.x, p.y, a.x, a.y, b.x, b.y) - g.width / 2;
      if (Math.abs(d) <= threshold) {
        const proj = projectPointSegment(p.x, p.y, a.x, a.y, b.x, b.y);
        out.push({ point: { x: proj.x, y: proj.y }, kind: 'trace-edge', distanceMm: Math.abs(d), graphic: g });
        return;
      }
    }
    return;
  }
  if (g.kind === 'region') {
    for (const c of g.contours) {
      if (dist(p.x, p.y, c.sx, c.sy) <= threshold) {
        out.push({ point: { x: c.sx, y: c.sy }, kind: 'vertex', distanceMm: dist(p.x, p.y, c.sx, c.sy), graphic: g });
      }
    }
  }
}

function apertureRadius(ap: Aperture | undefined): number {
  if (!ap) return 0.5;
  const s = ap.shape;
  if (s.kind === 'circle') return s.diameter / 2;
  if (s.kind === 'rect') return Math.max(s.width, s.height) / 2;
  if (s.kind === 'obround') return Math.max(s.width, s.height) / 2;
  if (s.kind === 'poly') return s.diameter / 2;
  return 0.5;
}

/** 点选图元（网络高亮用）：返回光标命中的第一个铜皮图元 */
export function hitTestGraphic(gerbers: ReadonlyArray<GerberFile>, p: Vec): { gerber: GerberFile; graphic: Graphic } | null {
  let best: { gerber: GerberFile; graphic: Graphic; d: number } | null = null;
  for (const gf of gerbers) {
    for (const g of gf.graphics) {
      if (g.pol === 'clear') continue;
      const d = distanceToGraphic(p, g, gf.apertures);
      if (d !== null && (best === null || d < best.d)) best = { gerber: gf, graphic: g, d };
    }
  }
  return best ? { gerber: best.gerber, graphic: best.graphic } : null;
}

export function distanceToGraphic(p: Vec, g: Graphic, apertures: Map<number, Aperture>): number | null {
  switch (g.kind) {
    case 'line':
      return distPointSegment(p.x, p.y, g.x1, g.y1, g.x2, g.y2) - g.width / 2;
    case 'arc': {
      const pts = tessellateArc(g.x1, g.y1, g.x2, g.y2, g.cx, g.cy, { multiQuadrant: true, ccw: g.ccw, full: g.full });
      let min = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        min = Math.min(min, distPointSegment(p.x, p.y, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y));
      }
      return min - g.width / 2;
    }
    case 'flash': {
      const d = dist(p.x, p.y, g.x, g.y) - apertureRadius(apertures.get(g.dcode));
      return d;
    }
    case 'region':
      // 区域命中用包围盒粗判 + 奇偶细判
      return null; // 网络提取阶段区域已栅格化，点选走栅格网络
  }
}
