import { parseGerber } from './gerber/parser';
import { parseExcellon } from './excellon/parser';
import type { BoardLayer } from './types';

/**
 * 内置演示图纸：用 RS-274X 文本手工拼一块 50×30mm 的小板，
 * 含宏光圈、G75 圆弧、区域填充、clear 负片、G85 槽孔，
 * 专门覆盖解析器里最容易出错的语法，方便无真实文件时验证。
 */

const TOP_COPPER = `G04 Demo top copper*
%FSLAX36Y36*%
%MOMM*%
%LPD*%
%ADD10C,0.200*%
%ADD11R,1.200X0.800*%
%ADD12C,0.600*%
%AMTHERMAL*
0,热焊盘演示宏*
1,1,1.6,0,0*
1,0,0.7,0,0*
20,1,0.3,0.3,0,-0.6,0*
%
%ADD13THERMAL,0*%
D10*
G01*
X5000000Y5000000D02*
X20000000Y5000000D01*
X20000000Y15000000D01*
G75*
G03*
X20000000Y20000000I0J2500000D01*
G01*
X5000000Y20000000D01*
X5000000Y5000000D01*
D11*
X8000000Y8000000D03*
X25000000Y25000000D03*
D13*
X30000000Y10000000D03*
G36*
X10000000Y22000000D02*
G01*
X18000000Y22000000D01*
X18000000Y28000000D01*
X10000000Y28000000D01*
X10000000Y22000000D01*
G37*
%LPC*%
D12*
X14000000Y25000000D03*
%LPD*%
M02*
`;

const OUTLINE = `G04 Demo outline*
%FSLAX36Y36*%
%MOMM*%
%LPD*%
%ADD20C,0.100*%
D20*
G01*
X0Y0D02*
X50000000Y0D01*
X50000000Y30000000D01*
X0Y30000000D01*
X0Y0D01*
M02*
`;

const SILK = `G04 Demo silkscreen*
%FSLAX36Y36*%
%MOMM*%
%LPD*%
%ADD21C,0.150*%
D21*
G01*
X3000000Y3000000D02*
X47000000Y3000000D01*
X47000000Y27000000D01*
X3000000Y27000000D01*
X3000000Y3000000D01*
M02*
`;

const DRILL = `M48
; demo drill
METRIC,TZ
T1C0.300
T2C0.800
%
T1
G81
X8.0Y8.0
X25.0Y25.0
X30.0Y10.0
T2
G85
X12.0Y18.0
X18.0Y18.0
M15
X18.0Y18.0
X18.0Y22.0
M16
T00
M30
`;

let seq = 0;

export function buildDemoLayers(): BoardLayer[] {
  const top = parseGerber(TOP_COPPER, 'demo-top.gtl');
  const outline = parseGerber(OUTLINE, 'demo-outline.gko');
  const silk = parseGerber(SILK, 'demo-silk.gto');
  const drill = parseExcellon(DRILL, 'demo.drl');

  return [
    {
      id: `demo-${++seq}`,
      fileName: 'demo-top.gtl',
      type: 'gerber',
      role: 'copper',
      side: 'top',
      copperIndex: 0,
      visible: true,
      opacity: 0.9,
      color: '#d98e04',
      gerber: top,
      warnings: top.warnings,
      roleManual: false,
    },
    {
      id: `demo-${++seq}`,
      fileName: 'demo-outline.gko',
      type: 'gerber',
      role: 'outline',
      side: 'none',
      copperIndex: -1,
      visible: true,
      opacity: 1,
      color: '#ffd166',
      gerber: outline,
      warnings: outline.warnings,
      roleManual: false,
    },
    {
      id: `demo-${++seq}`,
      fileName: 'demo-silk.gto',
      type: 'gerber',
      role: 'silkscreen',
      side: 'top',
      copperIndex: -1,
      visible: true,
      opacity: 0.9,
      color: '#f5f5f5',
      gerber: silk,
      warnings: silk.warnings,
      roleManual: false,
    },
    {
      id: `demo-${++seq}`,
      fileName: 'demo.drl',
      type: 'drill',
      role: 'drill',
      side: 'none',
      copperIndex: -1,
      visible: true,
      opacity: 0.9,
      color: '#ff5d5d',
      drill,
      warnings: drill.warnings,
      roleManual: false,
    },
  ];
}
