import type { DrillFile } from '../types';

/**
 * 钻孔层渲染：孔按镀覆区分颜色，路由槽画成槽形。
 * 在与 Gerber 相同的板→屏变换下调用（Y 已由外层 scale(1,-1) 处理，故这里用正 y）。
 */
export function drawDrill(
  ctx: CanvasRenderingContext2D,
  drill: DrillFile,
  platedColor = '#ff5d5d',
  unplatedColor = '#ffb020',
): void {
  for (const h of drill.hits) {
    const tool = drill.tools.get(h.tool);
    const d = tool?.diameter ?? 0.3;
    ctx.beginPath();
    ctx.arc(h.x, h.y, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = h.plated ? platedColor : unplatedColor;
    ctx.fill();
  }
  for (const slot of drill.slots) {
    ctx.strokeStyle = slot.plated ? platedColor : unplatedColor;
    ctx.lineWidth = slot.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const p0 = slot.points[0]!;
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < slot.points.length; i++) ctx.lineTo(slot.points[i]!.x, slot.points[i]!.y);
    ctx.stroke();
    // 两端封头
    for (const ep of [slot.points[0]!, slot.points[slot.points.length - 1]!]) {
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, slot.width / 2, 0, Math.PI * 2);
      ctx.fillStyle = slot.plated ? platedColor : unplatedColor;
      ctx.fill();
    }
  }
}
