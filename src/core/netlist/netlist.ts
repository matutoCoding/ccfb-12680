import { labelConnectedNets, netAt, rasterizeGerber, rasterPoint, type Raster } from '../raster';
import type { BoardLayer, Graphic, Vec } from '../types';

export interface NetInfo {
  id: number;
  areaMm2: number;
  graphics: Set<Graphic>;
  /** 代表点（网络首个铜像素的板坐标） */
  anchor: Vec;
  /** 判定问题 */
  issue?: 'short' | 'dangling';
}

export interface NetlistResult {
  layerId: string;
  resolutionMm: number;
  nets: NetInfo[];
  /** 网络 id → 信息 */
  byId: Map<number, NetInfo>;
}

/**
 * 从铜皮图形提取网络。
 * 没有设计网表时，"一个连通铜域 = 一个网络"：
 * - 短路：两个本应独立的焊盘域被走线/毛刺连通，表现为一个网络里含 ≥2 个焊盘簇且面积异常大；
 *   这里用启发式：同一连通域内包含的闪光焊盘（不同 dcode 位置）数量 ≥3 且无区域灌铜时报疑似短路。
 * - 断头：面积/跨度极小且不含任何焊盘闪光的网络。
 */
export function extractNetlist(layer: BoardLayer, resolutionMm = 0.02): NetlistResult | null {
  const gf = layer.gerber;
  if (!gf?.bbox) return null;
  const r = rasterizeGerber(gf, gf.bbox, { resolutionMm });
  const labeled = labelConnectedNets(r);

  // 先把每个图元归到它落入的网络
  const netGraphics = new Map<number, Set<Graphic>>();
  const padCount = new Map<number, number>();
  for (const g of gf.graphics) {
    if (g.pol === 'clear') continue;
    const p = g.kind === 'flash' ? { x: g.x, y: g.y } : g.kind === 'region' ? { x: g.contours[0]!.sx, y: g.contours[0]!.sy } : { x: g.x1, y: g.y1 };
    const nid = netAt(labeled, r, p.x, p.y);
    if (nid < 0) continue;
    let set = netGraphics.get(nid);
    if (!set) {
      set = new Set();
      netGraphics.set(nid, set);
    }
    set.add(g);
    if (g.kind === 'flash') padCount.set(nid, (padCount.get(nid) ?? 0) + 1);
  }

  const nets: NetInfo[] = [];
  const byId = new Map<number, NetInfo>();
  const hasRegion = gf.graphics.some((g) => g.kind === 'region' && g.pol === 'dark');

  for (const [nid, size] of labeled.sizes) {
    const anchor = anchorOf(r, labeled.labels, nid);
    const area = size * r.resolutionMm * r.resolutionMm;
    const pads = padCount.get(nid) ?? 0;
    let issue: NetInfo['issue'];
    if (!hasRegion && pads >= 3) issue = 'short';
    else if (pads === 0 && area < 0.5) issue = 'dangling';

    const info: NetInfo = {
      id: nid,
      areaMm2: area,
      graphics: netGraphics.get(nid) ?? new Set(),
      anchor,
      issue,
    };
    nets.push(info);
    byId.set(nid, info);
  }

  return { layerId: layer.id, resolutionMm: r.resolutionMm, nets, byId };
}

function anchorOf(r: Raster, labels: Int32Array, nid: number): Vec {
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== nid) continue;
    const py = Math.floor(i / r.widthPx);
    const px = i - py * r.widthPx;
    return {
      x: r.bbox.minX + (px + 0.5) * r.resolutionMm,
      y: r.bbox.maxY - (py + 0.5) * r.resolutionMm,
    };
  }
  return { x: 0, y: 0 };
}

/** 点选查询：板坐标 → 网络（查看页点走线整网高亮） */
export function netAtPoint(layer: BoardLayer, x: number, y: number, netlist: NetlistResult): NetInfo | null {
  const gf = layer.gerber;
  if (!gf?.bbox) return null;
  const r = rasterizeGerber(gf, gf.bbox, { resolutionMm: netlist.resolutionMm });
  const labeled = labelConnectedNets(r);
  const nid = netAt(labeled, r, x, y);
  return nid < 0 ? null : netlist.byId.get(nid) ?? null;
}

/** 跨层孔位对齐检查：钻孔与各铜层焊盘中心偏差 */
export interface DrillMisalignment {
  x: number;
  y: number;
  layerId: string;
  offsetMm: number;
}

export function checkDrillAlignment(
  copper: ReadonlyArray<BoardLayer>,
  drillLayer: BoardLayer,
  toleranceMm = 0.05,
): DrillMisalignment[] {
  const df = drillLayer.drill;
  if (!df) return [];
  const out: DrillMisalignment[] = [];

  for (const layer of copper) {
    const gf = layer.gerber;
    if (!gf?.bbox) continue;
    const r = rasterizeGerber(gf, gf.bbox, { resolutionMm: toleranceMm / 2 });
    for (const hit of df.hits) {
      const { px, py } = rasterPoint(r, hit.x, hit.y);
      // 孔心处应当被焊盘铜覆盖；若落在基材里，向四周找最近铜像素估偏差
      if (r.mask[py * r.widthPx + px]) continue;
      let nearest = Infinity;
      const win = Math.ceil(2 / r.resolutionMm);
      for (let dy = -win; dy <= win && nearest === Infinity; dy++) {
        for (let dx = -win; dx <= win; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || y < 0 || x >= r.widthPx || y >= r.heightPx) continue;
          if (r.mask[y * r.widthPx + x]) {
            nearest = Math.hypot(dx, dy) * r.resolutionMm;
            break;
          }
        }
      }
      if (nearest > toleranceMm) {
        out.push({ x: hit.x, y: hit.y, layerId: layer.id, offsetMm: nearest === Infinity ? -1 : nearest });
      }
    }
  }
  return out;
}
