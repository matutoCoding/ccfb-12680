import type { BBox, Vec } from './types';

/**
 * 板坐标（mm，原点在板左下，Y 向上）↔ 屏幕像素（Y 向下）变换。
 * screen = board * scale + offset
 */
export interface Camera {
  /** 屏幕中心对应的板坐标 */
  cx: number;
  cy: number;
  /** 每毫米像素数 */
  scale: number;
  width: number;
  height: number;
  /** 底层镜像查看：true 时水平翻转（从板底看） */
  mirrorX: boolean;
}

export function createCamera(width: number, height: number, board: BBox): Camera {
  const bw = Math.max(board.maxX - board.minX, 1e-6);
  const bh = Math.max(board.maxY - board.minY, 1e-6);
  const scale = Math.min(width / bw, height / bh) * 0.92;
  return {
    cx: (board.minX + board.maxX) / 2,
    cy: (board.minY + board.maxY) / 2,
    scale,
    width,
    height,
    mirrorX: false,
  };
}

export function resizeCamera(cam: Camera, width: number, height: number): Camera {
  return { ...cam, width, height };
}

export function boardToScreen(cam: Camera, x: number, y: number): Vec {
  const sx = cam.width / 2 + (x - cam.cx) * cam.scale * (cam.mirrorX ? -1 : 1);
  const sy = cam.height / 2 - (y - cam.cy) * cam.scale;
  return { x: sx, y: sy };
}

export function screenToBoard(cam: Camera, sx: number, sy: number): Vec {
  const x = cam.cx + (sx - cam.width / 2) / cam.scale * (cam.mirrorX ? -1 : 1);
  const y = cam.cy - (sy - cam.height / 2) / cam.scale;
  return { x, y };
}

export function viewportBBox(cam: Camera, pad = 0): BBox {
  const halfW = cam.width / 2 / cam.scale + pad;
  const halfH = cam.height / 2 / cam.scale + pad;
  return {
    minX: cam.cx - halfW,
    minY: cam.cy - halfH,
    maxX: cam.cx + halfW,
    maxY: cam.cy + halfH,
  };
}

export function zoomAt(cam: Camera, screenX: number, screenY: number, factor: number): Camera {
  const before = screenToBoard(cam, screenX, screenY);
  const scale = clamp(cam.scale * factor, 0.2, 400);
  // 让鼠标下的板点保持不动
  const sx = cam.width / 2 + (before.x - cam.cx) * cam.scale * (cam.mirrorX ? -1 : 1);
  const sy = cam.height / 2 - (before.y - cam.cy) * cam.scale;
  const after = screenToBoard({ ...cam, scale }, sx, sy);
  return { ...cam, scale, cx: cam.cx + (before.x - after.x), cy: cam.cy + (before.y - after.y) };
}

export function panCamera(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return {
    ...cam,
    cx: cam.cx - (dxScreen / cam.scale) * (cam.mirrorX ? -1 : 1),
    cy: cam.cy + dyScreen / cam.scale,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
