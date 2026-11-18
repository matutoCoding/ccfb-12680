import type { BBox, BoardLayer } from '../types';

/**
 * 出货拼版计算（纯几何，输出布局方案，渲染端按方案画）。
 * 单板间距 = 铣刀直径（走刀槽），工艺边宽度、定位孔、邮票孔/V-cut 二选一。
 */
export interface PanelOptions {
  cols: number;
  rows: number;
  /** 铣刀直径 mm，决定板间距 */
  cutterDiameterMm: number;
  railWidthMm: number;
  /** 'vcut' | 'stamp' */
  separation: 'vcut' | 'stamp';
  /** 邮票孔参数 */
  stampHoleDiameterMm: number;
  stampHolePitchMm: number;
  /** 定位孔直径与距边距离 */
  toolingHoleDiameterMm: number;
  toolingHoleInsetMm: number;
}

export interface PanelCell {
  col: number;
  row: number;
  x: number;
  y: number;
}

export interface StampHole {
  x: number;
  y: number;
  diameter: number;
}

export interface ToolingHole {
  x: number;
  y: number;
  diameter: number;
}

export interface PanelLayout {
  boardBBox: BBox;
  boardW: number;
  boardH: number;
  gapX: number;
  gapY: number;
  rail: number;
  panelW: number;
  panelH: number;
  cells: PanelCell[];
  stampHoles: StampHole[];
  toolingHoles: ToolingHole[];
  /** V-cut 直线（板坐标，竖线 x=... / 横线 y=...） */
  vcutLines: Array<{ axis: 'x' | 'y'; value: number }>;
}

export const DEFAULT_PANEL_OPTIONS: PanelOptions = {
  cols: 2,
  rows: 2,
  cutterDiameterMm: 2.0,
  railWidthMm: 5.0,
  separation: 'vcut',
  stampHoleDiameterMm: 0.6,
  stampHolePitchMm: 1.0,
  toolingHoleDiameterMm: 3.0,
  toolingHoleInsetMm: 2.5,
};

export function buildPanel(layers: ReadonlyArray<BoardLayer>, opt: PanelOptions): PanelLayout | null {
  const bbox = layers
    .map((l) => (l.type === 'gerber' ? l.gerber?.bbox : l.drill?.bbox) ?? null)
    .reduce<BBox | null>((acc, b) => {
      if (!acc) return b;
      if (!b) return acc;
      return {
        minX: Math.min(acc.minX, b.minX),
        minY: Math.min(acc.minY, b.minY),
        maxX: Math.max(acc.maxX, b.maxX),
        maxY: Math.max(acc.maxY, b.maxY),
      };
    }, null);
  if (!bbox) return null;

  const boardW = bbox.maxX - bbox.minX;
  const boardH = bbox.maxY - bbox.minY;
  // 板间距按铣刀直径，V-cut 时间距可更小，取 0 让线贴着走（保留 0.1mm 安全缝）
  const gap = opt.separation === 'stamp' ? opt.cutterDiameterMm : 0.1;
  const rail = opt.railWidthMm;

  const innerW = opt.cols * boardW + (opt.cols - 1) * gap;
  const innerH = opt.rows * boardH + (opt.rows - 1) * gap;
  const panelW = innerW + rail * 2;
  const panelH = innerH + rail * 2;

  const cells: PanelCell[] = [];
  for (let row = 0; row < opt.rows; row++) {
    for (let col = 0; col < opt.cols; col++) {
      cells.push({
        col,
        row,
        x: rail + col * (boardW + gap) - bbox.minX,
        y: rail + row * (boardH + gap) - bbox.minY,
      });
    }
  }

  const stampHoles: StampHole[] = [];
  const vcutLines: PanelLayout['vcutLines'] = [];
  if (opt.separation === 'stamp') {
    // 板间连接桥中点打邮票孔：沿每条分隔线的板边各布一串
    for (let c = 1; c < opt.cols; c++) {
      const lineX = rail + c * boardW + (c - 0.5) * gap;
      for (let row = 0; row < opt.rows; row++) {
        const y0 = rail + row * (boardH + gap);
        for (let y = y0 + 2; y < y0 + boardH - 2; y += opt.stampHolePitchMm * 2) {
          stampHoles.push({ x: lineX, y, diameter: opt.stampHoleDiameterMm });
        }
      }
    }
    for (let r = 1; r < opt.rows; r++) {
      const lineY = rail + r * boardH + (r - 0.5) * gap;
      for (let col = 0; col < opt.cols; col++) {
        const x0 = rail + col * (boardW + gap);
        for (let x = x0 + 2; x < x0 + boardW - 2; x += opt.stampHolePitchMm * 2) {
          stampHoles.push({ x, y: lineY, diameter: opt.stampHoleDiameterMm });
        }
      }
    }
  } else {
    for (let c = 1; c < opt.cols; c++) vcutLines.push({ axis: 'x', value: rail + c * boardW + (c - 0.5) * gap });
    for (let r = 1; r < opt.rows; r++) vcutLines.push({ axis: 'y', value: rail + r * boardH + (r - 0.5) * gap });
  }

  // 工艺边四角定位孔
  const inset = opt.toolingHoleInsetMm;
  const toolingHoles: ToolingHole[] = [
    { x: inset, y: inset, diameter: opt.toolingHoleDiameterMm },
    { x: panelW - inset, y: inset, diameter: opt.toolingHoleDiameterMm },
    { x: inset, y: panelH - inset, diameter: opt.toolingHoleDiameterMm },
    { x: panelW - inset, y: panelH - inset, diameter: opt.toolingHoleDiameterMm },
  ];

  return {
    boardBBox: bbox,
    boardW,
    boardH,
    gapX: gap,
    gapY: gap,
    rail,
    panelW,
    panelH,
    cells,
    stampHoles,
    toolingHoles,
    vcutLines,
  };
}
