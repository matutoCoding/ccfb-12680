import { degToRad } from '../units';
import { tessellateArc, tessellateContour } from '../geometry';
import type { Aperture, FlashPrim, GerberFile, Graphic, MacroShape } from '../types';

/**
 * 把单个 Gerber 文件绘制到一个与目标 ctx 同变换的上下文里。
 * 极性合成：clear 图元用 destination-out 擦除当前层已画内容（负片语义）。
 * 调用方负责：按层透明度分层离屏、再整体合成到主画布。
 */
export interface DrawOptions {
  highlightDcodes?: Set<number>;
  highlightColor?: string;
  /** 只绘制这些图元（网络高亮/差异叠加用）；不传绘制全部 */
  onlyGraphics?: Set<Graphic>;
}

export function drawGerber(ctx: CanvasRenderingContext2D, gerber: GerberFile, color: string, opt: DrawOptions = {}): void {
  const prevFill = ctx.fillStyle;
  const prevStroke = ctx.strokeStyle;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const g of gerber.graphics) {
    if (opt.onlyGraphics && !opt.onlyGraphics.has(g)) continue;
    const isHi = opt.highlightDcodes && g.kind !== 'region' && opt.highlightDcodes.has(g.dcode);
    if (isHi && opt.highlightColor) {
      ctx.fillStyle = opt.highlightColor;
      ctx.strokeStyle = opt.highlightColor;
    } else {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
    }

    ctx.save();
    if (g.pol === 'clear') ctx.globalCompositeOperation = 'destination-out';
    drawGraphic(ctx, g, gerber.apertures);
    ctx.restore();
  }

  ctx.fillStyle = prevFill;
  ctx.strokeStyle = prevStroke;
}

function drawGraphic(ctx: CanvasRenderingContext2D, g: Graphic, apertures: Map<number, Aperture>): void {
  // 坐标约定：ctx 已由调用方施加"板→屏"变换（含 Y 翻转），这里直接用板坐标
  switch (g.kind) {
    case 'line':
      ctx.lineWidth = Math.max(g.width, 0.02);
      ctx.beginPath();
      ctx.moveTo(g.x1, g.y1);
      ctx.lineTo(g.x2, g.y2);
      ctx.stroke();
      break;
    case 'arc': {
      ctx.lineWidth = Math.max(g.width, 0.02);
      const pts = tessellateArc(g.x1, g.y1, g.x2, g.y2, g.cx, g.cy, {
        multiQuadrant: true,
        ccw: g.ccw,
        full: g.full,
      });
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      ctx.stroke();
      break;
    }
    case 'flash':
      drawFlash(ctx, g, apertures.get(g.dcode));
      break;
    case 'region': {
      // 奇偶规则：所有轮廓进同一个 path，evenodd 自动处理岛/洞
      ctx.beginPath();
      for (const c of g.contours) {
        const ring = tessellateContour(c.sx, c.sy, c.segs);
        ctx.moveTo(ring[0]!.x, ring[0]!.y);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]!.x, ring[i]!.y);
        ctx.closePath();
      }
      ctx.fill('evenodd');
      break;
    }
  }
}

function drawFlash(ctx: CanvasRenderingContext2D, g: FlashPrim, ap: Aperture | undefined): void {
  if (!ap) return;
  ctx.translate(g.x, g.y);
  if (g.rotationDeg) ctx.rotate(degToRad(g.rotationDeg));

  if (ap.macro && ap.macro.length > 0) {
    for (const m of ap.macro) {
      ctx.save();
      if (m.pol === 'clear') ctx.globalCompositeOperation = 'destination-out';
      drawMacroShape(ctx, m);
      ctx.restore();
    }
    return;
  }

  const s = ap.shape;
  switch (s.kind) {
    case 'circle':
      circle(ctx, s.diameter);
      if (s.holeDiameter) eraseCircle(ctx, s.holeDiameter);
      break;
    case 'rect':
      rect(ctx, s.width, s.height);
      if (s.holeDiameter) eraseCircle(ctx, s.holeDiameter);
      break;
    case 'obround':
      obround(ctx, s.width, s.height);
      if (s.holeDiameter) eraseCircle(ctx, s.holeDiameter);
      break;
    case 'poly':
      polygon(ctx, s.diameter, s.vertices, s.rotationDeg);
      if (s.holeDiameter) eraseCircle(ctx, s.holeDiameter);
      break;
    case 'macro':
      // 宏定义缺失时画占位十字，避免静默丢图
      ctx.strokeRect(-0.2, -0.2, 0.4, 0.4);
      break;
  }
}

function drawMacroShape(ctx: CanvasRenderingContext2D, m: MacroShape): void {
  if (m.kind !== 'line') {
    ctx.translate(m.cx, m.cy);
    if (m.rotationDeg) ctx.rotate(degToRad(m.rotationDeg));
  }
  switch (m.kind) {
    case 'circle':
      circle(ctx, m.diameter);
      break;
    case 'rect':
      rect(ctx, m.width, m.height);
      break;
    case 'obround':
      obround(ctx, m.width, m.height);
      break;
    case 'poly':
      polygon(ctx, m.diameter, m.vertices, m.rotationDeg);
      break;
    case 'line': {
      ctx.lineWidth = Math.max(m.width, 0.02);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
      break;
    }
  }
}

function circle(ctx: CanvasRenderingContext2D, d: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, d / 2, 0, Math.PI * 2);
  ctx.fill();
}

function eraseCircle(ctx: CanvasRenderingContext2D, d: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  circle(ctx, d);
  ctx.restore();
}

function rect(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillRect(-w / 2, -h / 2, w, h);
}

function obround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = Math.min(w, h) / 2;
  ctx.beginPath();
  if (w >= h) {
    roundedRectPath(ctx, -w / 2, -h / 2, w, h, r);
  } else {
    roundedRectPath(ctx, -w / 2, -h / 2, w, h, r);
  }
  ctx.fill();
}

function polygon(ctx: CanvasRenderingContext2D, diameter: number, vertices: number, rotationDeg: number): void {
  const r = diameter / 2;
  ctx.beginPath();
  for (let i = 0; i < vertices; i++) {
    const a = degToRad(rotationDeg) + (i * 2 * Math.PI) / vertices - Math.PI / 2;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
