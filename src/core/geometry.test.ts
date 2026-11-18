import { describe, expect, it } from 'vitest';
import { tessellateArc, pointInPolygonEvenOdd, dist, unionBBox } from './geometry';

describe('圆弧细分', () => {
  it('整圆返回闭合折线且半径恒定', () => {
    const pts = tessellateArc(5, 0, 5, 0, 0, 0, { multiQuadrant: true, full: true });
    expect(pts.length).toBeGreaterThan(16);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y - 0)).toBeCloseTo(5, 4);
    }
    // 整圆不重复闭合点
    expect(pts[0]!).not.toEqual(pts[pts.length - 1]!);
  });

  it('90° 逆时针弧终点准确', () => {
    const pts = tessellateArc(5, 0, 0, 5, 0, 0, { multiQuadrant: true, ccw: true });
    const last = pts[pts.length - 1]!;
    expect(last.x).toBeCloseTo(0, 4);
    expect(last.y).toBeCloseTo(5, 4);
  });

  it('G74 单象限弧扫角不超过 90°', () => {
    // 起点 (5,0)，圆心 (0,0)，终点 (0,5)
    const pts = tessellateArc(5, 0, 0, 5, 0, 0, { multiQuadrant: false });
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const a1 = Math.atan2(first.y, first.x);
    const a2 = Math.atan2(last.y, last.x);
    expect(Math.abs(a2 - a1)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
  });
});

describe('奇偶规则点在多边形内', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('内部 true 外部 false', () => {
    expect(pointInPolygonEvenOdd(5, 5, square)).toBe(true);
    expect(pointInPolygonEvenOdd(15, 5, square)).toBe(false);
  });
  it('带洞轮廓（evenodd）洞里为 false', () => {
    // 外环 0..20，内洞 6..14。evenodd 填充按"外环在内 XOR 洞在内"
    const outer = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const hole = [
      { x: 6, y: 6 },
      { x: 6, y: 14 },
      { x: 14, y: 14 },
      { x: 14, y: 6 },
    ];
    const filled = (x: number, y: number): boolean => pointInPolygonEvenOdd(x, y, outer) !== pointInPolygonEvenOdd(x, y, hole);
    // 洞中心：外在内也在 → 不填充；外环内洞外：只在外 → 填充
    expect(filled(10, 10)).toBe(false);
    expect(filled(3, 10)).toBe(true);
    expect(filled(25, 10)).toBe(false);
  });
});

describe('包围盒合并', () => {
  it('union 取极值', () => {
    const u = unionBBox({ minX: 0, minY: 0, maxX: 5, maxY: 5 }, { minX: 3, minY: -2, maxX: 9, maxY: 4 })!;
    expect(u).toEqual({ minX: 0, minY: -2, maxX: 9, maxY: 5 });
  });
});

describe('距离工具', () => {
  it('点到线段距离含端点情形', () => {
    expect(dist(0, 0, 3, 4)).toBeCloseTo(5, 6);
  });
});
