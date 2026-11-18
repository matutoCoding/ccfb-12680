import { rasterizeGerber, type Raster } from '../raster';
import type { BBox, GerberFile } from '../types';

/**
 * 改版前后叠图对比。
 * 两份 Gerber 同分辨率栅格化后逐像素比对：
 * - added：新版有铜、旧版基材
 * - removed：旧版有铜、新版基材
 * 再把差异像素聚成簇，每簇给中心坐标和面积，供差异清单逐条跳转。
 */
export type DiffKind = 'added' | 'removed';

export interface DiffCluster {
  id: string;
  kind: DiffKind;
  x: number;
  y: number;
  areaMm2: number;
  bbox: BBox;
  pixels: number;
}

export interface GerberDiff {
  resolutionMm: number;
  bbox: BBox;
  addedMask: Uint8Array;
  removedMask: Uint8Array;
  clusters: DiffCluster[];
  addedCount: number;
  removedCount: number;
}

export async function diffGerbers(
  oldG: GerberFile,
  newG: GerberFile,
  resolutionMm = 0.02,
  onProgress?: (percent: number) => void,
): Promise<GerberDiff> {
  const bbox: BBox = unionBBox4(oldG.bbox, newG.bbox);
  onProgress?.(20);
  await tick();
  const oldR = rasterizeGerber(oldG, bbox, { resolutionMm });
  onProgress?.(50);
  const newR = rasterizeGerber(newG, bbox, { resolutionMm });
  onProgress?.(70);

  const n = oldR.mask.length;
  const addedMask = new Uint8Array(n);
  const removedMask = new Uint8Array(n);
  let addedCount = 0;
  let removedCount = 0;
  for (let i = 0; i < n; i++) {
    const o = oldR.mask[i]!;
    const nv = newR.mask[i]!;
    if (nv && !o) {
      addedMask[i] = 1;
      addedCount++;
    } else if (o && !nv) {
      removedMask[i] = 1;
      removedCount++;
    }
  }
  onProgress?.(85);
  const clusters = [...clusterMask(addedMask, 'added', newR), ...clusterMask(removedMask, 'removed', newR)];
  onProgress?.(100);
  return { resolutionMm, bbox, addedMask, removedMask, clusters, addedCount, removedCount };
}

function unionBBox4(a: BBox | null, b: BBox | null): BBox {
  const fallback = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  if (!a && !b) return fallback;
  if (!a) return b!;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** 把差异像素按 8 邻接聚成簇（迭代式洪水填充，避免递归爆栈） */
function clusterMask(mask: Uint8Array, kind: DiffKind, r: Raster): DiffCluster[] {
  const { widthPx: w, heightPx: h, resolutionMm } = r;
  const visited = new Uint8Array(mask.length);
  const clusters: DiffCluster[] = [];
  let seq = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    let pixels = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;

    while (stack.length) {
      const idx = stack.pop()!;
      const py = Math.floor(idx / w);
      const px = idx - py * w;
      pixels++;
      sumX += px;
      sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }

    const cx = sumX / pixels;
    const cy = sumY / pixels;
    clusters.push({
      id: `${kind}-${seq++}`,
      kind,
      x: r.bbox.minX + (cx + 0.5) * resolutionMm,
      y: r.bbox.maxY - (cy + 0.5) * resolutionMm,
      areaMm2: pixels * resolutionMm * resolutionMm,
      pixels,
      bbox: {
        minX: r.bbox.minX + minX * resolutionMm,
        maxX: r.bbox.minX + (maxX + 1) * resolutionMm,
        maxY: r.bbox.maxY - minY * resolutionMm,
        minY: r.bbox.maxY - (maxY + 1) * resolutionMm,
      },
    });
  }
  clusters.sort((a, b) => b.pixels - a.pixels);
  return clusters;
}
