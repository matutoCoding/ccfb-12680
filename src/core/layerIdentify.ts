import type { LayerRole, LayerSide } from './types';

export interface LayerGuess {
  role: LayerRole;
  side: LayerSide;
  copperIndex: number;
  isDrill: boolean;
  confidence: number;
}

export const DRILL_EXT = /\.(drl|nc|xln|txt|exc|tap|cnc|drr)$/i;
const GERBER_EXT = /\.(gbr|ger|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gko|gm\d+|g\d+|cmp|sol|plc|pls|art\d*|top|bot|inner\d*|pho)$/i;

const ROLE_PATTERNS: Array<{ re: RegExp; role: LayerRole; side: LayerSide; copperIndex: number; weight: number }> = [
  // 阻焊（放在铜层判断之前，权重最高）
  { re: /(solder[\s_.-]?mask|[\b_.-]mask\b|smk|(^|[\b_.-])sm($|[\b_.-])|solderm|resist|stopmask|tsm|bsm|gts|gbs|f[_-]?mask|b[_-]?mask)/i, role: 'soldermask', side: 'none', copperIndex: -1, weight: 12 },
  // 丝印
  { re: /(silk|screen|legend|(^|[\b_.-])ss($|[\b_.-])|slk|gto|gbo|tto|tbo|f[_-]?silk|b[_-]?silk|f[_-]?fab|b[_-]?fab)/i, role: 'silkscreen', side: 'none', copperIndex: -1, weight: 12 },
  // 钢网
  { re: /(paste|stencil|crc|crs|gtp|gbp|tsp|bsp|f[_-]?paste|b[_-]?paste)/i, role: 'solderpaste', side: 'none', copperIndex: -1, weight: 12 },
  // 外形
  { re: /(outline|profile|board[\s_.-]?outline|edge[\s_.-]?cuts|gko|gml|gm1|mech[\s_.-]?1|mechanical[\s_.-]?1|dxf|cut)/i, role: 'outline', side: 'none', copperIndex: -1, weight: 11 },
  // 机械层
  { re: /(mechanical|mech|gm\d+|me\d+)/i, role: 'mechanical', side: 'none', copperIndex: -1, weight: 6 },
  // 钻孔
  { re: /(drill|drl|plated|nonplated|non-plated|npth|pth|xln|\.nc|\.tap|\.cnc|slot)/i, role: 'drill', side: 'none', copperIndex: -1, weight: 10 },
  // 文档
  { re: /(document|doc|notes|fab(?!\w)|assembly|assemble|pick|coord|bom)/i, role: 'document', side: 'none', copperIndex: -1, weight: 5 },
  // 铜
  { re: /(copper|(^|[\b_.-])cu($|[\b_.-])|signal|art\d*|\.gtl|\.gbl|\.cmp|\.sol|inner|internal|plane|gnd|power)/i, role: 'copper', side: 'none', copperIndex: 0, weight: 7 },
];

const SIDE_PATTERNS: Array<{ re: RegExp; side: LayerSide; weight: number }> = [
  { re: /(inner|internal|[-_]in\d+|plane|gnd|power|layer[-_]?[2-9]\d*|[-_]l[2-9]\d*|art\d+)/i, side: 'inner', weight: 6 },
  { re: /(\btop\b|(^|[-_])t([-_]|$)|top[-_.]|cmp|component|\.gt|\.gto|\.gts|\.gtp|layer[-_]?1\b|[-_]l1\b)/i, side: 'top', weight: 4 },
  { re: /(\bbot(tom)?\b|(^|[-_])b([-_]|$)|bottom|sol|solder[-_.]?side|\.gb|\.gbo|\.gbs|\.gbp)/i, side: 'bottom', weight: 4 },
];

export function guessLayer(fileName: string): LayerGuess {
  const lower = fileName.toLowerCase();
  const base = lower.split(/[\\/]/).pop() ?? lower;
  const isDrillExt = DRILL_EXT.test(base);

  let best: { role: LayerRole; side: LayerSide; copperIndex: number; weight: number } | null = null;
  for (const p of ROLE_PATTERNS) {
    if (p.re.test(base) || p.re.test(lower)) {
      if (!best || p.weight > best.weight) best = { role: p.role, side: p.side, copperIndex: p.copperIndex, weight: p.weight };
    }
  }

  let side: LayerSide = 'none';
  let sideWeight = 0;
  for (const s of SIDE_PATTERNS) {
    if (s.re.test(base) && s.weight > sideWeight) {
      side = s.side;
      sideWeight = s.weight;
    }
  }

  // 内层序号：inner2 / in2 / layer3 / l4 / art5
  const innerMatch = base.match(/(?:inner|internal|in|layer|art|l)[-_]?(\d+)/i);
  let copperIndex = -1;
  const isDrill = isDrillExt || best?.role === 'drill';

  if (!best) {
    // 兜底：扩展名像 Gerber 就按铜层
    if (isDrill) {
      best = { role: 'drill', side: 'none', copperIndex: -1, weight: 1 };
    } else if (GERBER_EXT.test(base)) {
      best = { role: 'copper', side: side === 'none' ? 'inner' : side, copperIndex: 0, weight: 1 };
    } else {
      best = { role: 'unknown', side: 'none', copperIndex: -1, weight: 0 };
    }
  }

  if (best.role === 'copper') {
    if (side === 'top') copperIndex = 0;
    else if (side === 'bottom') copperIndex = 99;
    else if (innerMatch) copperIndex = Number(innerMatch[1]);
    else copperIndex = 50;
  }

  // 给阻焊丝印补上 top/bottom
  if ((best.role === 'soldermask' || best.role === 'silkscreen' || best.role === 'solderpaste') && side !== 'none') {
    return { role: best.role, side, copperIndex: -1, isDrill, confidence: best.weight / 10 };
  }
  if ((best.role === 'soldermask' || best.role === 'silkscreen' || best.role === 'solderpaste') && side === 'none') {
    // 从 .gts/.gto 这类扩展名已在 role 正则命中，再试 t/b 前缀
    side = /(^t|[._-]t[._-]|top|\.gt)/i.test(base) ? 'top' : /(^b|[._-]b[._-]|bot|\.gb)/i.test(base) ? 'bottom' : 'none';
  }

  return { role: best.role, side, copperIndex, isDrill, confidence: best.weight / 10 };
}

/** 常见板厂 Gerber 扩展名 → 兜底角色 */
export function isGerberName(fileName: string): boolean {
  const base = fileName.toLowerCase().split(/[\\/]/).pop() ?? '';
  return GERBER_EXT.test(base) || /\.(gbr|ger)$/i.test(base);
}
