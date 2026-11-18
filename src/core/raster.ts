import { drawGerber } from './render/draw';
import type { BBox, GerberFile, Graphic } from './types';

/**
 * 栅格分析底座：把铜皮图元画到离屏画布，得到二值掩膜，
 * 再提供连通域（Union-Find）、距离变换、轮廓提取等车间检查常用算法。
 * 全部在浏览器本地完成，像素分辨率按板尺寸自适应（默认 25µm/px）。
 */
export interface Raster {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bbox: BBox;
  /** 每像素毫米数 */
  resolutionMm: number;
  widthPx: number;
  heightPx: number;
  /** 铜皮掩膜（Uint8，1=铜 0=基材），行优先，行对应板 Y 从高到低 */
  mask: Uint8Array;
}

export interface RasterOptions {
  /** 目标分辨率，mm/px。越小越精细越吃内存 */
  resolutionMm?: number;
  /** 最长边像素上限，防止大板爆内存 */
  maxPixels?: number;
  color?: string;
}

export function rasterizeGerber(gerber: GerberFile, bbox: BBox, opt: RasterOptions = {}): Raster {
  const maxPixels = opt.maxPixels ?? 4096;
  const bw = Math.max(bbox.maxX - bbox.minX, 1e-6);
  const bh = Math.max(bbox.maxY - bbox.minY, 1e-6);
  let res = opt.resolutionMm ?? 0.025;
  const longestMm = Math.max(bw, bh);
  if (longestMm / res > maxPixels) res = longestMm / maxPixels;

  const widthPx = Math.max(2, Math.ceil(bw / res));
  const heightPx = Math.max(2, Math.ceil(bh / res));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = opt.color ?? '#fff';
  ctx.strokeStyle = opt.color ?? '#fff';
  // 板 mm → 像素：平移到原点，Y 翻转
  ctx.scale(widthPx / bw, -heightPx / bh);
  ctx.translate(-bbox.minX, -bbox.maxY);
  drawGerber(ctx, gerber, opt.color ?? '#fff');

  const image = ctx.getImageData(0, 0, widthPx, heightPx);
  const mask = new Uint8Array(widthPx * heightPx);
  for (let i = 0, p = 0; i < image.data.length; i += 4, p++) {
    // alpha>0 或亮通道>128 都算铜（clear 极性已在绘制阶段擦除 alpha）
    mask[p] = image.data[i + 3]! > 16 && image.data[i]! > 128 ? 1 : 0;
  }
  return { canvas, ctx, bbox, resolutionMm: res, widthPx, heightPx, mask };
}

export function rasterPoint(r: Raster, xMm: number, yMm: number): { px: number; py: number } {
  const px = Math.floor((xMm - r.bbox.minX) / r.resolutionMm);
  const py = Math.floor((r.bbox.maxY - yMm) / r.resolutionMm);
  return { px: clamp(px, 0, r.widthPx - 1), py: clamp(py, 0, r.heightPx - 1) };
}

export function rasterToBoard(r: Raster, px: number, py: number): { x: number; y: number } {
  return {
    x: r.bbox.minX + (px + 0.5) * r.resolutionMm,
    y: r.bbox.maxY - (py + 0.5) * r.resolutionMm,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ---------------- Union-Find 连通域 ---------------- */

export class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root]!;
    while (this.parent[x] !== root) {
      const next = this.parent[x]!;
      this.parent[x] = root;
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export interface NetResult {
  /** 每个铜像素的网络 id（非铜像素为 -1） */
  labels: Int32Array;
  /** 网络 id → 像素数 */
  sizes: Map<number, number>;
  count: number;
}

/** 4 邻接连通域：同一铜网络的走线/焊盘/区域连成一片 */
export function labelConnectedNets(r: Raster): NetResult {
  const { widthPx: w, heightPx: h, mask } = r;
  const uf = new UnionFind(w * h);
  const labels = new Int32Array(w * h).fill(-1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx]) continue;
      if (x > 0 && mask[idx - 1]) uf.union(idx, idx - 1);
      if (y > 0 && mask[idx - w]) uf.union(idx, idx - w);
    }
  }

  const remap = new Map<number, number>();
  const sizes = new Map<number, number>();
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const root = uf.find(i);
    let nid = remap.get(root);
    if (nid === undefined) {
      nid = count++;
      remap.set(root, nid);
    }
    labels[i] = nid;
    sizes.set(nid, (sizes.get(nid) ?? 0) + 1);
  }
  return { labels, sizes, count };
}

/* ---------------- 距离变换（两趟 EDT） ---------------- */

/**
 * Felzenszwalb 两趟距离变换。
 * 输入 mask（1=障碍/铜），输出每个像素到最近铜像素的距离（mm）。
 * 间隙检查 = 两个不同网络之间基材像素的最小距离×2。
 */
export function distanceToCopper(r: Raster): Float32Array {
  const { widthPx: w, heightPx: h, mask } = r;
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? 0 : Infinity;
  const d = new Float32Array(w * h);
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  // 沿列
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) d[y * w + x] = f[y * w + x]!;
    edt1d(d, w, x, h, v, z);
    for (let y = 0; y < h; y++) f[y * w + x] = d[y * w + x]!;
  }
  // 沿行
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) d[y * w + x] = f[y * w + x]!;
    edt1d(d, 1, y * w, w, v, z);
    for (let x = 0; x < w; x++) f[y * w + x] = d[y * w + x]!;
  }
  for (let i = 0; i < f.length; i++) f[i] = Math.sqrt(f[i]!) * r.resolutionMm;
  return f;
}

function edt1d(d: Float32Array, stride: number, offset: number, n: number, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  const get = (i: number): number => d[offset + i * stride]!;
  const set = (i: number, val: number): void => {
    d[offset + i * stride] = val;
  };
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const vk = v[k]!;
      s = (get(q) + q * q - (get(vk) + vk * vk)) / (2 * q - 2 * vk);
      if (s <= z[k]!) k--;
      else break;
    } while (k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const vk = v[k]!;
    set(q, (q - vk) * (q - vk) + get(vk));
  }
}

/* ---------------- 图元 → 像素反查（违规定位用） ---------------- */

/** 找包含某板坐标的网络 id；不在铜上返回 -1 */
export function netAt(nets: NetResult, r: Raster, x: number, y: number): number {
  const { px, py } = rasterPoint(r, x, y);
  return nets.labels[py * r.widthPx + px] ?? -1;
}

/** 收集某网络对应的图元（通过采样点反查，用于整网高亮） */
export function graphicsOfNet(
  gerber: GerberFile,
  r: Raster,
  nets: NetResult,
  targetNet: number,
  sampleStepMm = 0.05,
): Set<Graphic> {
  const out = new Set<Graphic>();
  for (const g of gerber.graphics) {
    if (g.pol === 'clear') continue;
    if (graphicTouchesNet(g, r, nets, targetNet, sampleStepMm)) out.add(g);
  }
  return out;
}

function graphicTouchesNet(g: Graphic, r: Raster, nets: NetResult, target: number, step: number): boolean {
  const sample = (x: number, y: number): boolean => {
    const { px, py } = rasterPoint(r, x, y);
    return nets.labels[py * r.widthPx + px] === target;
  };
  if (g.kind === 'flash') return sample(g.x, g.y);
  if (g.kind === 'line') {
    const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    const n = Math.max(2, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      if (sample(g.x1 + ((g.x2 - g.x1) * i) / n, g.y1 + ((g.y2 - g.y1) * i) / n)) return true;
    }
    return false;
  }
  if (g.kind === 'region') {
    for (const c of g.contours) {
      if (sample(c.sx, c.sy)) return true;
      for (const s of c.segs) if (sample(s.x, s.y)) return true;
    }
    return false;
  }
  return sample(g.x1, g.y1) || sample(g.x2, g.y2);
}
