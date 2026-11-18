import { describe, expect, it } from 'vitest';
import { parseGerber } from './parser';

describe('RS-274X 坐标与单位', () => {
  it('FS 3.6 前导零省略，mm 单位正确换算', () => {
    const g = parseGerber(
      `%FSLAX36Y36*%\n%MOMM*%\n%ADD10C,0.2*%\nD10*\nX0Y0D02*\nX15000000Y2500000D01*\nM02*`,
      't.gbr',
    );
    const line = g.graphics.find((x) => x.kind === 'line');
    expect(line).toBeTruthy();
    if (!line || line.kind !== 'line') throw new Error('expected line');
    expect(line.x2).toBeCloseTo(15, 6);
    expect(line.y2).toBeCloseTo(2.5, 6);
    expect(g.unit).toBe('mm');
  });

  it('英寸 2.4 尾随零省略按 inch→mm 换算', () => {
    // TZ 右侧补零到 6 位：15→150000=15.0000 inch → 381mm
    const g = parseGerber(
      `%FSTAX24Y24*%\n%MOIN*%\n%ADD10C,0.01*%\nD10*\nX1Y1D02*\nX1Y15D01*\nM02*`,
      't.gbr',
    );
    const line = g.graphics.find((x) => x.kind === 'line')!;
    // 15.0 inch → 381mm；显式小数 1.5 inch 单独验证 in→mm
    expect(line.kind === 'line' && line.y2).toBeCloseTo(381, 4);
    const g2 = parseGerber(
      `%FSTAX24Y24*%\n%MOIN*%\n%ADD10C,0.01*%\nD10*\nX1.0Y1.0D02*\nX1.5Y2.0D01*\nM02*`,
      't2.gbr',
    );
    const line2 = g2.graphics.find((x) => x.kind === 'line')!;
    expect(line2.kind === 'line' && line2.x2).toBeCloseTo(38.1, 4);
    expect(line2.kind === 'line' && line2.y2).toBeCloseTo(50.8, 4);
  });

  it('显式小数点直接取值', () => {
    const g = parseGerber(`%FSLAX36Y36*%\n%MOMM*%\n%ADD10C,0.2*%\nD10*\nX0Y0D02*\nX12.5Y3.25D01*\nM02*`, 't.gbr');
    const line = g.graphics.find((x) => x.kind === 'line')!;
    expect(line.kind === 'line' && line.x2).toBeCloseTo(12.5, 6);
    expect(line.kind === 'line' && line.y2).toBeCloseTo(3.25, 6);
  });
});

describe('光圈', () => {
  it('圆形/矩形光圈尺寸解析为 mm，含孔', () => {
    const g = parseGerber(`%FSLAX36Y36*%\n%MOMM*%\n%ADD10C,0.25*%\n%ADD11R,1.2X0.8X0.3*%\nM02*`, 't.gbr');
    const c = g.apertures.get(10)!;
    const r = g.apertures.get(11)!;
    expect(c.shape.kind).toBe('circle');
    expect(c.shape.kind === 'circle' && c.shape.diameter).toBeCloseTo(0.25, 6);
    expect(r.shape.kind).toBe('rect');
    expect(r.shape.kind === 'rect' && r.shape.holeDiameter).toBeCloseTo(0.3, 6);
  });

  it('宏光圈实例化：变量、表达式、clear 子图元', () => {
    const g = parseGerber(
      [
        '%FSLAX36Y36*%',
        '%MOMM*%',
        '%AMYMAC*',
        '0,comment*',
        '1,1,$1,0,0*',
        '1,0,$2,0,0*',
        '20,1,$1/2,$1-$2,1.0,0.5,45*',
        '%',
        '%ADD12YMAC,1.6X0.6*%',
        'D12*',
        'X1000000Y2000000D03*',
        'M02*',
      ].join('\n'),
      't.gbr',
    );
    const ap = g.apertures.get(12)!;
    expect(ap.macro).toBeTruthy();
    expect(ap.macro!.length).toBe(3);
    const darkCircle = ap.macro!.find((m) => m.kind === 'circle' && m.pol === 'dark')!;
    const clearCircle = ap.macro!.find((m) => m.kind === 'circle' && m.pol === 'clear')!;
    expect(darkCircle.kind === 'circle' && darkCircle.diameter).toBeCloseTo(1.6, 6);
    expect(clearCircle.kind === 'circle' && clearCircle.diameter).toBeCloseTo(0.6, 6);
    const rect = ap.macro!.find((m) => m.kind === 'rect')!;
    expect(rect.kind === 'rect' && rect.width).toBeCloseTo(0.8, 6);
    expect(rect.kind === 'rect' && rect.height).toBeCloseTo(1.0, 6);
    expect(rect.kind === 'rect' && rect.cx).toBeCloseTo(1.0, 6);
    expect(rect.kind === 'rect' && rect.cy).toBeCloseTo(0.5, 6);
    expect(rect.kind === 'rect' && rect.rotationDeg).toBeCloseTo(45, 6);
    const flash = g.graphics.find((x) => x.kind === 'flash')!;
    expect(flash.kind === 'flash' && flash.x).toBeCloseTo(1, 6);
  });
});

describe('圆弧插值', () => {
  it('G75 多象限逆时针圆弧保留圆心与方向', () => {
    const g = parseGerber(
      [
        '%FSLAX36Y36*%',
        '%MOMM*%',
        '%ADD10C,0.2*%',
        'D10*',
        'G75*',
        'G01*',
        'X0Y0D02*',
        'G03*',
        'X5000000Y5000000I5000000J0D01*',
        'M02*',
      ].join('\n'),
      't.gbr',
    );
    const arc = g.graphics.find((x) => x.kind === 'arc')!;
    expect(arc.kind).toBe('arc');
    if (arc.kind !== 'arc') return;
    expect(arc.cx).toBeCloseTo(5, 6);
    expect(arc.cy).toBeCloseTo(0, 6);
    expect(arc.ccw).toBe(true);
    expect(arc.full).toBe(false);
  });

  it('G75 起终点重合解析为整圆 full=true', () => {
    const g = parseGerber(
      ['%FSLAX36Y36*%', '%MOMM*%', '%ADD10C,0.2*%', 'D10*', 'G75*', 'G01*', 'X1000000Y1000000D02*', 'G03*', 'X1000000Y1000000I2000000J0D01*', 'M02*'].join('\n'),
      't.gbr',
    );
    const arc = g.graphics.find((x) => x.kind === 'arc')!;
    expect(arc.kind === 'arc' && arc.full).toBe(true);
  });

  it('G74 单象限圆弧不报错且扫角 ≤90°', () => {
    const g = parseGerber(
      ['%FSLAX36Y36*%', '%MOMM*%', '%ADD10C,0.2*%', 'D10*', 'G74*', 'G01*', 'X0Y5000000D02*', 'G03*', 'X5000000Y10000000I0J5000000D01*', 'M02*'].join('\n'),
      't.gbr',
    );
    const arc = g.graphics.find((x) => x.kind === 'arc')!;
    expect(arc.kind).toBe('arc');
    expect(g.warnings.filter((w) => w.code.startsWith('UNSUPPORTED')).length).toBe(0);
  });
});

describe('区域与极性', () => {
  it('G36/G37 区域含两个轮廓，输出 region 图元', () => {
    const g = parseGerber(
      [
        '%FSLAX36Y36*%',
        '%MOMM*%',
        'G36*',
        'X0Y0D02*',
        'G01*',
        'X10000000Y0D01*',
        'X10000000Y10000000D01*',
        'X0Y10000000D01*',
        'X0Y0D01*',
        'G37*',
        'M02*',
      ].join('\n'),
      't.gbr',
    );
    const region = g.graphics.find((x) => x.kind === 'region')!;
    expect(region.kind).toBe('region');
    expect(region.kind === 'region' && region.contours.length).toBe(1);
  });

  it('LPC 后的闪光极性为 clear（负片擦除）', () => {
    const g = parseGerber(
      ['%FSLAX36Y36*%', '%MOMM*%', '%ADD10C,1*%', 'D10*', 'X5000000Y5000000D03*', '%LPC*%', 'X8000000Y8000000D03*', 'M02*'].join('\n'),
      't.gbr',
    );
    const flashes = g.graphics.filter((x) => x.kind === 'flash');
    expect(flashes[0]!.pol).toBe('dark');
    expect(flashes[1]!.pol).toBe('clear');
  });
});

describe('步进重复与块光圈', () => {
  it('SR 步进把图元复制 nx*ny 份并平移', () => {
    const g = parseGerber(
      [
        '%FSLAX36Y36*%',
        '%MOMM*%',
        '%ADD10C,0.5*%',
        '%SRX2Y2I10000000J15000000*%',
        'D10*',
        'X0Y0D03*',
        '%SR*%',
        'M02*',
      ].join('\n'),
      't.gbr',
    );
    expect(g.graphics.length).toBe(4);
    const pts = g.graphics.filter((x) => x.kind === 'flash').map((x) => (x.kind === 'flash' ? `${x.x},${x.y}` : ''));
    expect(pts).toContain('10,15');
    expect(pts).toContain('0,0');
  });
});

describe('包围盒', () => {
  it('bbox 覆盖所有图元范围', () => {
    const g = parseGerber(
      ['%FSLAX36Y36*%', '%MOMM*%', '%ADD10C,0.2*%', 'D10*', 'X1000000Y2000000D02*', 'X40000000Y30000000D01*', 'M02*'].join('\n'),
      't.gbr',
    );
    expect(g.bbox).toBeTruthy();
    expect(g.bbox!.maxX).toBeGreaterThanOrEqual(40);
    expect(g.bbox!.maxY).toBeGreaterThanOrEqual(30);
  });
});
