import { milToMm, umToMm } from '../units';
import type { DrcRuleSet, DrcRuleId, DrcViolation } from '../types';

/**
 * 板厂能力档位。数值单位 mm，按国内常见打样厂工艺能力整理，
 * 可在设置页基于"自定义"档修改。
 */
export const RULE_PRESETS: DrcRuleSet[] = [
  {
    id: 'standard',
    name: '常规工艺（6/6mil 档）',
    note: '大多数打样厂不加价的默认能力',
    rules: {
      minTraceWidth: milToMm(6),
      minClearance: milToMm(6),
      minDrillSize: milToMm(12),
      minAnnularRing: milToMm(5),
      minSilkSpacing: 0.15,
    },
  },
  {
    id: 'fine',
    name: '精细工艺（4/4mil 档）',
    note: '需选支持精细线宽线距的板厂，通常有加价',
    rules: {
      minTraceWidth: milToMm(4),
      minClearance: milToMm(4),
      minDrillSize: milToMm(10),
      minAnnularRing: milToMm(4),
      minSilkSpacing: 0.12,
    },
  },
  {
    id: 'hdi',
    name: 'HDI 档（3/3mil）',
    note: '激光盲孔/LDI 工艺，板厂能力确认后再用',
    rules: {
      minTraceWidth: milToMm(3),
      minClearance: milToMm(3),
      minDrillSize: umToMm(100),
      minAnnularRing: milToMm(3),
      minSilkSpacing: 0.1,
    },
  },
];

export const RULE_LABELS: Record<DrcRuleId, string> = {
  minTraceWidth: '最小线宽',
  minClearance: '最小线距（间隙）',
  minDrillSize: '最小钻孔孔径',
  minAnnularRing: '最小孔环（环宽）',
  minSilkSpacing: '丝印最小间距',
};

export function customRuleSet(base: DrcRuleSet, overrides: Partial<Record<DrcRuleId, number>>): DrcRuleSet {
  return { id: 'custom', name: '自定义', rules: { ...base.rules, ...overrides } };
}

let violationSeq = 0;
export function makeViolation(v: Omit<DrcViolation, 'id'>): DrcViolation {
  return { ...v, id: `v${++violationSeq}` };
}
