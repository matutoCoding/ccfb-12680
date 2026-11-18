/**
 * 全局数据模型。解析器输出、渲染、DRC、网络提取等模块共用。
 * 所有解析后的坐标统一换算为毫米（mm），绝对坐标。
 */

export type Unit = 'mm' | 'in';
export type Polarity = 'dark' | 'clear';

/** 层的工艺角色 */
export type LayerRole =
  | 'copper'
  | 'soldermask'
  | 'silkscreen'
  | 'solderpaste'
  | 'outline'
  | 'mechanical'
  | 'drill'
  | 'document'
  | 'unknown';

export type LayerSide = 'top' | 'bottom' | 'inner' | 'none';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Vec {
  x: number;
  y: number;
}

export interface ParseWarning {
  code: string;
  message: string;
  line?: number;
}

/* ---------------- 光圈（Aperture） ---------------- */

export interface CircleShape {
  kind: 'circle';
  diameter: number;
  holeDiameter?: number;
}
export interface RectShape {
  kind: 'rect';
  width: number;
  height: number;
  holeDiameter?: number;
}
export interface ObroundShape {
  kind: 'obround';
  width: number;
  height: number;
  holeDiameter?: number;
}
export interface PolyShape {
  kind: 'poly';
  diameter: number;
  vertices: number;
  rotationDeg: number;
  holeDiameter?: number;
}
export type ApertureShape = CircleShape | RectShape | ObroundShape | PolyShape;

/** 宏光圈求值后，在光圈局部坐标系（mm，原点在闪光中心）中的图形 */
export type MacroShape =
  | { kind: 'circle'; pol: Polarity; diameter: number; cx: number; cy: number; rotationDeg: number }
  | { kind: 'rect'; pol: Polarity; width: number; height: number; cx: number; cy: number; rotationDeg: number }
  | { kind: 'obround'; pol: Polarity; width: number; height: number; cx: number; cy: number; rotationDeg: number }
  | { kind: 'poly'; pol: Polarity; diameter: number; vertices: number; cx: number; cy: number; rotationDeg: number }
  | { kind: 'line'; pol: Polarity; x1: number; y1: number; x2: number; y2: number; width: number };

export interface Aperture {
  dcode: number;
  shape: ApertureShape | { kind: 'macro'; macroName: string };
  macro?: MacroShape[];
}

/* ---------------- Gerber 图元 ---------------- */

export interface LinePrim {
  kind: 'line';
  pol: Polarity;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  dcode: number;
}

export interface ArcPrim {
  kind: 'arc';
  pol: Polarity;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
  width: number;
  ccw: boolean;
  /** 整圆（G75 起终点重合） */
  full: boolean;
  dcode: number;
}

export interface FlashPrim {
  kind: 'flash';
  pol: Polarity;
  x: number;
  y: number;
  dcode: number;
  rotationDeg: number;
}

export type RegionSeg =
  | { type: 'line'; x: number; y: number }
  | { type: 'arc'; x: number; y: number; cx: number; cy: number; ccw: boolean };

export interface RegionContour {
  /** 轮廓起点（G02 移动落点） */
  sx: number;
  sy: number;
  /** 后续线段，末段隐式闭合回起点 */
  segs: RegionSeg[];
}

export interface RegionPrim {
  kind: 'region';
  pol: Polarity;
  contours: RegionContour[];
}

export type Graphic = LinePrim | ArcPrim | FlashPrim | RegionPrim;

export interface CoordFormat {
  integer: number;
  decimal: number;
  /** L=前导零省略（最常见） T=尾随零省略 D=显式小数点 */
  zeroSuppression: 'L' | 'T' | 'D';
}

export interface GerberFile {
  fileName: string;
  unit: Unit;
  format: CoordFormat;
  apertures: Map<number, Aperture>;
  graphics: Graphic[];
  bbox: BBox | null;
  /** 文件级初始极性（LP），正常都是 dark */
  initialPolarity: Polarity;
  warnings: ParseWarning[];
}

/* ---------------- Excellon 钻孔 ---------------- */

export interface DrillTool {
  tool: string;
  diameter: number;
  plated: boolean;
  /** 该刀是否用于路由槽（G85） */
  routed: boolean;
}

export interface DrillHit {
  x: number;
  y: number;
  tool: string;
  plated: boolean;
}

export interface RoutedSlot {
  tool: string;
  width: number;
  points: Vec[];
  plated: boolean;
}

export interface DrillFile {
  fileName: string;
  unit: Unit;
  format: CoordFormat;
  tools: Map<string, DrillTool>;
  hits: DrillHit[];
  slots: RoutedSlot[];
  bbox: BBox | null;
  warnings: ParseWarning[];
}

/* ---------------- 板 / 层 / 工单 ---------------- */

export interface BoardLayer {
  id: string;
  fileName: string;
  type: 'gerber' | 'drill';
  role: LayerRole;
  side: LayerSide;
  /** 铜层序号猜测：0=顶面，越大越靠底 */
  copperIndex: number;
  visible: boolean;
  opacity: number;
  color: string;
  gerber?: GerberFile;
  drill?: DrillFile;
  warnings: ParseWarning[];
  /** 人工指定过角色后不再被自动识别覆盖 */
  roleManual: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  boardThicknessMm: number;
  layers: BoardLayer[];
}

/* ---------------- DRC ---------------- */

export type DrcRuleId =
  | 'minTraceWidth'
  | 'minClearance'
  | 'minDrillSize'
  | 'minAnnularRing'
  | 'minSilkSpacing';

export interface DrcRuleSet {
  id: string;
  name: string;
  rules: Record<DrcRuleId, number>; // 全部 mm
  note?: string;
}

export type DrcSeverity = 'error' | 'warning';

export interface DrcViolation {
  id: string;
  rule: DrcRuleId;
  severity: DrcSeverity;
  message: string;
  /** 违规位置（板坐标 mm），点击跳转用 */
  x: number;
  y: number;
  /** 实测值 mm */
  measured?: number;
  /** 要求值 mm */
  required?: number;
  layerId?: string;
}

/* ---------------- 测量标注 ---------------- */

export interface Measurement {
  id: string;
  kind: 'distance' | 'lineWidth' | 'drillDiameter';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  valueMm: number;
  label: string;
  color: string;
}
