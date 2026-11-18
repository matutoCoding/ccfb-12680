import { describe, expect, it } from 'vitest';
import { parseExcellon } from './parser';
import { buildDrillTable } from '../drill/drillTable';

describe('Excellon 钻孔解析', () => {
  it('公制刀表与孔坐标，零抑制识别', () => {
    const d = parseExcellon(
      ['M48', 'METRIC,TZ', 'T1C0.300', 'T2C0.800', '%', 'T1', 'G81', 'X8.0Y8.0', 'X25.0Y25.0', 'T2', 'X30.0Y10.0', 'M30'].join('\n'),
      'demo.drl',
    );
    expect(d.tools.size).toBe(2);
    expect(d.tools.get('T1')!.diameter).toBeCloseTo(0.3, 6);
    expect(d.hits.length).toBe(3);
    expect(d.hits[0]!.x).toBeCloseTo(8, 6);
    expect(d.hits[0]!.y).toBeCloseTo(8, 6);
    expect(d.hits[2]!.tool).toBe('T2');
  });

  it('G85/M15/M16 路由槽识别为 slot', () => {
    const d = parseExcellon(
      ['M48', 'METRIC,TZ', 'T1C0.500', '%', 'T1', 'G85', 'X12.0Y18.0', 'G05X18.0Y18.0', 'M15', 'X18.0Y22.0', 'M16', 'M30'].join('\n'),
      'slot.drl',
    );
    expect(d.slots.length).toBe(1);
    expect(d.slots[0]!.points.length).toBeGreaterThanOrEqual(2);
    expect(d.slots[0]!.width).toBeCloseTo(0.5, 6);
  });

  it('钻孔表按刀号统计并发现未声明刀', () => {
    const d = parseExcellon(['M48', 'METRIC,TZ', 'T1C0.3', '%', 'T1', 'X1Y1', 'X2Y2', 'T9', 'X3Y3', 'M30'].join('\n'), 'x.drl');
    const stats = buildDrillTable(d);
    expect(stats.totalHits).toBe(3);
    expect(stats.unknownTools).toContain('T9');
    const row = stats.rows.find((r) => r.tool === 'T1')!;
    expect(row.hitCount).toBe(2);
  });

  it('英寸文件孔径换算 mm', () => {
    const d = parseExcellon(['M48', 'INCH', 'T1C0.012', '%', 'T1', 'X1Y1', 'M30'].join('\n'), 'x.drl');
    expect(d.tools.get('T1')!.diameter).toBeCloseTo(0.3048, 4);
  });
});
