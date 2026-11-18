import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardToScreen, createCamera, panCamera, resizeCamera, screenToBoard, viewportBBox, zoomAt, type Camera } from '../core/camera';
import { drawGerber } from '../core/render/draw';
import { drawDrill } from '../core/render/drawDrill';
import { LayerTileCache } from '../core/render/tileCache';
import { snap } from '../core/snap';
import { findNetAt } from '../core/drc/engine';
import { fmtMm } from '../core/units';
import { useStore } from '../state/store';
import type { BoardLayer, BBox, GerberFile, Measurement } from '../core/types';

interface Props {
  layers: BoardLayer[];
  boardBBox: BBox | null;
  measurements: Measurement[];
  onMeasure: (m: Omit<Measurement, 'id'>) => void;
  className?: string;
  /** 差异叠加层（独立 gerber + 颜色），不参与左侧层开关 */
  overlays?: Array<{ gerber: GerberFile; color: string; opacity: number }>;
}

interface DragState {
  mode: 'pan' | 'measure';
  startX: number;
  startY: number;
  camStart: Camera;
  measureBoard?: { x: number; y: number };
}

export function CanvasView({ layers, boardBBox, measurements, onMeasure, overlays }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<Camera | null>(null);
  const cachesRef = useRef<Map<string, LayerTileCache>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const [hover, setHover] = useState<{ sx: number; sy: number; board: { x: number; y: number }; snapText: string | null } | null>(null);
  const [draftMeasure, setDraftMeasure] = useState<Omit<Measurement, 'id'> | null>(null);
  const rafRef = useRef(0);

  const viewerTool = useStore((s) => s.viewerTool);
  const setHighlight = useStore((s) => s.setHighlight);
  const highlighted = useStore((s) => s.highlightedNetGraphics);
  const highlightLayerId = useStore((s) => s.highlightLayerId);
  const jumpTarget = useStore((s) => s.jumpTarget);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const visibleLayers = useMemo(() => layers.filter((l) => l.visible), [layers]);
  const gerbers = useMemo(() => visibleLayers.filter((l) => l.gerber).map((l) => l.gerber!), [visibleLayers]);
  const drills = useMemo(() => visibleLayers.filter((l) => l.drill).map((l) => l.drill!), [visibleLayers]);

  // 初始化相机
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !boardBBox) return;
    const rect = wrap.getBoundingClientRect();
    camRef.current = createCamera(rect.width, rect.height, boardBBox);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardBBox?.minX, boardBBox?.minY, boardBBox?.maxX, boardBBox?.maxY]);

  // 尺寸变化
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      const cam = camRef.current;
      if (!canvas || !cam) return;
      const rect = wrap.getBoundingClientRect();
      camRef.current = resizeCamera(cam, rect.width, rect.height);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      scheduleDraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 层内容/可见性变化 → 瓦片缓存增删
  useEffect(() => {
    const caches = cachesRef.current;
    const alive = new Set(visibleLayers.map((l) => l.id));
    for (const key of [...caches.keys()]) if (!alive.has(key)) caches.delete(key);
    for (const l of visibleLayers) {
      if (l.gerber && !caches.has(l.id)) caches.set(l.id, new LayerTileCache(l.gerber, l.color, dpr));
    }
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLayers, dpr]);

  // 颜色变化时重建缓存
  useEffect(() => {
    for (const l of visibleLayers) {
      const cache = cachesRef.current.get(l.id);
      if (cache && l.gerber && cache.color !== l.color) {
        cachesRef.current.set(l.id, new LayerTileCache(l.gerber, l.color, dpr));
      }
    }
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLayers.map((l) => l.color).join('|')]);

  // 跳转到违规/差异位置
  useEffect(() => {
    if (!jumpTarget || !camRef.current || !boardBBox) return;
    const cam = camRef.current;
    camRef.current = { ...cam, cx: jumpTarget.x, cy: jumpTarget.y, scale: Math.max(cam.scale, 12) };
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.nonce]);

  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const cam = camRef.current;
    if (!canvas || !cam) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cam.width, cam.height);

    // 板→屏：先平移板原点到相机中心，X/Y 各缩放，Y 因屏幕向下而取负。
    // draw.ts 在"板 Y 向下"局部系用 (x,-y) 绘制，与这里的 Y 取负恰好抵消，
    // 最终板上 (x,y) 落在屏幕正确位置，且只翻转一次。
    ctx.save();
    ctx.translate(cam.width / 2, cam.height / 2);
    ctx.scale(cam.scale * (cam.mirrorX ? -1 : 1), -cam.scale);
    ctx.translate(-cam.cx, -cam.cy);

    const view = viewportBBox(cam, 1);
    for (const layer of visibleLayers) {
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.gerber) {
        const cache = cachesRef.current.get(layer.id);
        const onlyGraphics = highlightLayerId === layer.id && highlighted ? (highlighted as Set<never>) : undefined;
        if (cache && !onlyGraphics) {
          ctx.restore(); // 瓦片 blit 自管屏幕变换
          cache.render(ctx, cam, view, {}, layer.opacity);
          ctx.save();
          ctx.globalAlpha = layer.opacity;
        } else {
          drawGerber(ctx, layer.gerber, layer.color, onlyGraphics ? { onlyGraphics: onlyGraphics as never } : {});
        }
      } else if (layer.drill) {
        drawDrill(ctx, layer.drill);
      }
      ctx.restore();
    }

    // 差异叠加
    for (const ov of overlays ?? []) {
      ctx.save();
      ctx.globalAlpha = ov.opacity;
      drawGerber(ctx, ov.gerber, ov.color);
      ctx.restore();
    }

    // 测量标注（钉在图上）
    drawMeasurements(ctx, cam, [...measurements, ...(draftMeasure ? [draftMeasure] : [])]);
    ctx.restore();

    // 跳转十字标记（屏幕坐标）
    if (jumpTarget) {
      const p = boardToScreen(cam, jumpTarget.x, jumpTarget.y);
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 10, p.y);
      ctx.lineTo(p.x + 10, p.y);
      ctx.moveTo(p.x, p.y - 10);
      ctx.lineTo(p.x, p.y + 10);
      ctx.stroke();
    }
  }, [visibleLayers, measurements, draftMeasure, dpr, overlays, highlighted, highlightLayerId, jumpTarget]);

  useEffect(() => {
    scheduleDraw();
  }, [draw, scheduleDraw]);

  /* ---------------- 交互 ---------------- */

  const eventBoard = (e: React.PointerEvent): { sx: number; sy: number; board: { x: number; y: number } } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, board: screenToBoard(camRef.current!, sx, sy) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { sx, sy, board } = eventBoard(e);
    if (viewerTool === 'measure') {
      const snapped = snap(gerbers, drills, board, 1.2 / (camRef.current?.scale ?? 1) + 0.05);
      const pt = snapped?.point ?? board;
      dragRef.current = { mode: 'measure', startX: sx, startY: sy, camStart: camRef.current!, measureBoard: pt };
      setDraftMeasure({
        kind: 'distance',
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        valueMm: 0,
        label: '',
        color: '#4da3ff',
      });
    } else {
      dragRef.current = { mode: 'pan', startX: sx, startY: sy, camStart: camRef.current! };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy, board } = eventBoard(e);
    const cam = camRef.current!;
    const snapTarget = snap(gerbers, drills, board, 1.2 / cam.scale + 0.05);
    setHover({ sx, sy, board, snapText: snapTarget ? `${snapTarget.kind} ${fmtMm(snapTarget.distanceMm)}` : null });

    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'pan') {
      camRef.current = panCamera(drag.camStart, sx - drag.startX, sy - drag.startY);
      scheduleDraw();
    } else if (drag.mode === 'measure' && draftMeasure) {
      const pt = snapTarget?.point ?? board;
      const value = Math.hypot(pt.x - drag.measureBoard!.x, pt.y - drag.measureBoard!.y);
      setDraftMeasure({ ...draftMeasure, x2: pt.x, y2: pt.y, valueMm: value, label: fmtMm(value, true) });
      scheduleDraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.mode === 'measure' && draftMeasure && draftMeasure.valueMm > 0.001) {
      onMeasure(draftMeasure);
    }
    setDraftMeasure(null);
    scheduleDraw();

    // 选择工具：点选铜皮 → 整网高亮
    if (viewerTool === 'select' && !drag) return;
    if (viewerTool === 'select' && drag && Math.hypot(e.clientX, e.clientY) < 5) {
      const { board } = eventBoard(e);
      selectNet(board);
    }
  };

  const selectNet = (board: { x: number; y: number }) => {
    const copper = visibleLayers.find((l) => l.role === 'copper' && l.gerber);
    if (!copper) return;
    const result = findNetAt(copper, board.x, board.y);
    if (result) setHighlight(copper.id, result.graphics as unknown as Set<unknown>);
    else setHighlight(null, null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    camRef.current = zoomAt(camRef.current!, e.clientX - rect.left, e.clientY - rect.top, factor);
    scheduleDraw();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (viewerTool !== 'select') return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const board = screenToBoard(camRef.current!, e.clientX - rect.left, e.clientY - rect.top);
    selectNet(board);
  };

  const cursorClass = viewerTool === 'measure' ? 'measuring' : viewerTool === 'select' ? 'selecting' : '';

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={cursorClass}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      />
      {hover && camRef.current && (
        <div className="overlay-hud">
          板坐标 X {hover.board.x.toFixed(3)} / Y {hover.board.y.toFixed(3)} mm
          {hover.snapText ? `　吸附: ${hover.snapText}` : ''}
          {draftMeasure ? `　测量: ${fmtMm(draftMeasure.valueMm, true)}` : ''}
        </div>
      )}
    </div>
  );
}

function drawMeasurements(ctx: CanvasRenderingContext2D, cam: Camera, list: Array<Omit<Measurement, 'id'> | Measurement>): void {
  for (const m of list) {
    const p1 = boardToScreen(cam, m.x1, m.y1);
    const p2 = boardToScreen(cam, m.x2, m.y2);
    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.strokeStyle = m.color;
    ctx.fillStyle = m.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    for (const p of [p1, p2]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2 - 8;
    ctx.font = '12px monospace';
    const label = m.label || fmtMm(m.valueMm, true);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(15,20,27,0.85)';
    ctx.fillRect(mx - tw / 2 - 4, my - 13, tw + 8, 17);
    ctx.fillStyle = m.color;
    ctx.textAlign = 'center';
    ctx.fillText(label, mx, my);
    ctx.restore();
  }
}
