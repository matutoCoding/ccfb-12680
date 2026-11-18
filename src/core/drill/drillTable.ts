import type { DrillFile, DrillTool } from '../types';

export interface DrillStatRow {
  tool: string;
  diameterMm: number;
  plated: boolean;
  hitCount: number;
  /** 该刀参与的槽孔数 */
  slotCount: number;
  routed: boolean;
}

export interface DrillTableStats {
  rows: DrillStatRow[];
  totalHits: number;
  totalSlots: number;
  platedHits: number;
  unplatedHits: number;
  /** 钻孔图里出现但刀表未声明的刀（对不上报警） */
  unknownTools: string[];
  /** 刀表声明但从未使用的刀 */
  unusedTools: string[];
}

/** 按孔径分组统计；槽孔/异形孔单列；与钻孔图交叉校验 */
export function buildDrillTable(df: DrillFile): DrillTableStats {
  const counts = new Map<string, number>();
  const slotCounts = new Map<string, number>();
  for (const h of df.hits) counts.set(h.tool, (counts.get(h.tool) ?? 0) + 1);
  for (const s of df.slots) slotCounts.set(s.tool, (slotCounts.get(s.tool) ?? 0) + 1);

  const rows: DrillStatRow[] = [];
  const usedTools = new Set<string>([...counts.keys(), ...slotCounts.keys()]);

  for (const [id, tool] of df.tools) {
    rows.push({
      tool: id,
      diameterMm: tool.diameter,
      plated: tool.plated,
      hitCount: counts.get(id) ?? 0,
      slotCount: slotCounts.get(id) ?? 0,
      routed: tool.routed || (slotCounts.get(id) ?? 0) > 0,
    });
  }
  rows.sort((a, b) => a.diameterMm - b.diameterMm);

  const unknownTools = [...usedTools].filter((t) => !df.tools.has(t));
  const unusedTools = [...df.tools.keys()].filter((t) => !usedTools.has(t));

  const totalHits = df.hits.length;
  const totalSlots = df.slots.length;
  const platedHits = df.hits.filter((h) => h.plated).length;

  return {
    rows,
    totalHits,
    totalSlots,
    platedHits,
    unplatedHits: totalHits - platedHits,
    unknownTools,
    unusedTools,
  };
}

/** 槽孔是否异形（非直线路由：含 ≥2 段折点） */
export function isIrregularSlot(tool: DrillTool, pointCount: number): boolean {
  return tool.routed && pointCount > 2;
}
