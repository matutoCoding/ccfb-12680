import type { BBox, Vec } from './types';

/* ---------------- 包围盒 ---------------- */

export function bboxFromPoints(pts: ReadonlyArray<Vec>): BBox | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxGrow(b: BBox | null, d: number): BBox | null {
  if (!b) return b;
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function bboxContainsPoint(b: BBox, p: Vec, eps = 0): boolean {
  return p.x >= b.minX - eps && p.x <= b.maxX + eps && p.y >= b.minY - eps && p.y <= b.maxY + eps;
}

/* ---------------- 基础距离 ---------------- */

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function distPointSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 返回点在线段上的投影点与参数 t */
export function projectPointSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; t: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: x1, y: y1, t: 0 };
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy, t };
}

export function segmentsIntersect(
  p1: Vec,
  p2: Vec,
  p3: Vec,
  p4: Vec,
): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/* ---------------- 圆弧细分 ---------------- */

/** 弧线弦高不超过 maxErrMm 的最大步长角（弧度） */
function arcStepAngle(radius: number, maxErrMm: number): number {
  const r = Math.max(radius, 1e-6);
  const cosA = Math.max(-1, 1 - maxErrMm / r);
  return Math.max(0.02, Math.acos(cosA) * 2);
  // 下限约 1.1°，防止超大半径产生天价点数
}

export interface ArcTessOptions {
  /** false=G74 单象限（方向由几何决定） true=G75 多象限（ccw 指定） */
  multiQuadrant: boolean;
  ccw?: boolean;
  full?: boolean;
  maxErrMm?: number;
}

/**
 * 圆弧细分。返回从起点（含）到终点（含）的折线点；整圆不含重复的闭合点。
 * G74：起终点必在圆心的水平/垂直轴上，扫角 ≤90°，方向由起终点几何决定。
 * G75：扫向由 G02/G03 决定，起终点重合时按整圆处理。
 */
export function tessellateArc(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  opt: ArcTessOptions,
): Vec[] {
  const maxErr = opt.maxErrMm ?? 0.005; // 5µm 弦高，足够车间精度
  const r1 = dist(x1, y1, cx, cy);
  const r2 = dist(x2, y2, cx, cy);
  const radius = (r1 + r2) / 2;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);

  let sweep: number;
  if (opt.full || (opt.multiQuadrant && x1 === x2 && y1 === y2)) {
    sweep = opt.ccw === false ? -Math.PI * 2 : Math.PI * 2;
  } else if (opt.multiQuadrant) {
    const d = a2 - a1;
    if (opt.ccw) {
      sweep = d > 0 ? d : d + Math.PI * 2;
    } else {
      sweep = d < 0 ? d : d - Math.PI * 2;
    }
  } else {
    // G74：归一到 (-π, π]，单象限下绝对值 ≤ π/2，符号即扫向
    let d = a2 - a1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d <= -Math.PI) d += Math.PI * 2;
    sweep = d;
  }

  const step = arcStepAngle(radius, maxErr);
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  const pts: Vec[] = [{ x: x1, y: y1 }];
  for (let i = 1; i < n; i++) {
    const a = a1 + (sweep * i) / n;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  if (Math.abs(sweep) < Math.PI * 2 - 1e-9) pts.push({ x: x2, y: y2 });
  return pts;
}

/* ---------------- 区域：奇偶规则 ---------------- */

/** 偶数-奇数规则点在多边形内判断。ring 可含多个子环（外框+洞），逐环计数取奇偶和 */
export function pointInPolygonEvenOdd(px: number, py: number, ring: ReadonlyArray<Vec>): boolean {
  let crossings = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const yi = ring[i]!.y;
    const xj = ring[j]!.x;
    const yj = ring[j]!.y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) crossings++;
  }
  return crossings % 2 === 1;
}

/** 把一条区域轮廓（含弧）细分为闭合折线点（不重复闭合点） */
export function tessellateContour(
  sx: number,
  sy: number,
  segs: ReadonlyArray<{ type: 'line' | 'arc'; x: number; y: number; cx?: number; cy?: number; ccw?: boolean }>,
  maxErrMm = 0.005,
): Vec[] {
  const pts: Vec[] = [{ x: sx, y: sy }];
  for (const s of segs) {
    const prev = pts[pts.length - 1]!;
    if (s.type === 'line') {
      pts.push({ x: s.x, y: s.y });
    } else if (s.cx !== undefined && s.cy !== undefined) {
      const arc = tessellateArc(prev.x, prev.y, s.x, s.y, s.cx, s.cy, {
        multiQuadrant: true,
        ccw: s.ccw,
        maxErrMm,
      });
      for (let i = 1; i < arc.length; i++) pts.push(arc[i]!);
    }
  }
  // 去掉与起点重合的末点，fill('evenodd') 会自动闭合
  const last = pts[pts.length - 1]!;
  if (pts.length > 1 && Math.hypot(last.x - sx, last.y - sy) < 1e-7) pts.pop();
  return pts;
}

/** 均匀网格空间索引：图元按包围盒入桶，视口裁剪/拾取用 */
export class GridIndex<T extends { bbox: BBox }> {
  private cells = new Map<number, T[]>();
  private readonly nx: number;
  private readonly ny: number;
  private readonly cellW: number;
  private readonly cellH: number;
  private readonly originX: number;
  private readonly originY: number;

  constructor(
    items: ReadonlyArray<T>,
    bounds: BBox,
    targetCells = 64,
  ) {
    const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
    this.nx = Math.max(1, Math.round(targetCells * Math.sqrt(w / Math.max(h, 1e-6))));
    this.ny = Math.max(1, Math.round(targetCells * Math.sqrt(h / Math.max(w, 1e-6))));
    this.cellW = w / this.nx;
    this.cellH = h / this.ny;
    this.originX = bounds.minX;
    this.originY = bounds.minY;
    for (const it of items) this.insert(it);
  }

  private key(ix: number, iy: number): number {
    return iy * this.nx + ix;
  }

  private insert(it: T): void {
    const x0 = Math.max(0, Math.floor((it.bbox.minX - this.originX) / this.cellW));
    const x1 = Math.min(this.nx - 1, Math.floor((it.bbox.maxX - this.originX) / this.cellW));
    const y0 = Math.max(0, Math.floor((it.bbox.minY - this.originY) / this.cellH));
    const y1 = Math.min(this.ny - 1, Math.floor((it.bbox.maxY - this.originY) / this.cellH));
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = this.key(ix, iy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(it);
        else this.cells.set(k, [it]);
      }
    }
  }

  query(q: BBox, out: T[] = []): T[] {
    const x0 = Math.max(0, Math.floor((q.minX - this.originX) / this.cellW));
    const x1 = Math.min(this.nx - 1, Math.floor((q.maxX - this.originX) / this.cellW));
    const y0 = Math.max(0, Math.floor((q.minY - this.originY) / this.cellH));
    const y1 = Math.min(this.ny - 1, Math.floor((q.maxY - this.originY) / this.cellH));
    const seen = new Set<T>();
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const bucket = this.cells.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const it of bucket) {
          if (!seen.has(it) && bboxIntersects(it.bbox, q)) {
            seen.add(it);
            out.push(it);
          }
        }
      }
    }
    return out;
  }
}
