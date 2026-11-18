import type { BBox } from '../types';
import type { Camera } from '../camera';
import { boardToScreen } from '../camera';
import { drawGerber, type DrawOptions } from './draw';
import type { GerberFile } from '../types';

/**
 * 离屏分层瓦片缓存。
 * - 每个可见层一组瓦片，瓦片按板坐标固定切分（TILE_MM 毫米）
 * - 缓存 key = 层级缩放档（log2 scale 取整）+ 瓦片行列
 * - 相机移动只贴瓦片；跨越缩放档才重画受影响瓦片
 * - clear 极性在层离屏内用 destination-out 合成，层间再按透明度叠加
 */
const TILE_MM = 20; // 每瓦片覆盖 20mm 板尺寸
const MAX_TILES = 400; // 内存保护，超出 LRU 丢弃

interface Tile {
  canvas: HTMLCanvasElement;
  scaleLevel: number;
  lastUsed: number;
}

export class LayerTileCache {
  private tiles = new Map<string, Tile>();
  private clock = 0;
  readonly color: string;

  constructor(
    private gerber: GerberFile,
    color: string,
    private dpr: number,
  ) {
    this.color = color;
  }

  private scaleLevel(cam: Camera): number {
    return Math.floor(Math.log2(cam.scale));
  }

  /** 把该层可见瓦片绘制到主 ctx；opacity 为层透明度，blit 时施加 */
  render(ctx: CanvasRenderingContext2D, cam: Camera, view: BBox, opt: DrawOptions = {}, opacity = 1): void {
    const level = this.scaleLevel(cam);
    const c0 = Math.floor(view.minX / TILE_MM);
    const c1 = Math.floor(view.maxX / TILE_MM);
    const r0 = Math.floor(view.minY / TILE_MM);
    const r1 = Math.floor(view.maxY / TILE_MM);

    for (let ix = c0; ix <= c1; ix++) {
      for (let iy = r0; iy <= r1; iy++) {
        const key = `${level}:${ix}:${iy}`;
        let tile = this.tiles.get(key);
        if (!tile || tile.scaleLevel !== level) {
          tile = this.buildTile(level, ix, iy, cam, opt);
          this.tiles.set(key, tile);
          this.evictIfNeeded();
        }
        tile.lastUsed = ++this.clock;
        this.blit(ctx, tile.canvas, ix, iy, cam, opacity);
      }
    }
  }

  private buildTile(level: number, ix: number, iy: number, _cam: Camera, opt: DrawOptions): Tile {
    const tileScale = 2 ** level;
    const pxW = Math.ceil(TILE_MM * tileScale * this.dpr);
    const pxH = pxW;
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const tctx = canvas.getContext('2d')!;
    // 瓦片局部像素系：板 mm 直接缩放平移，Y 翻转交给 blit 时的主相机变换
    tctx.scale(tileScale * this.dpr, tileScale * this.dpr);
    tctx.translate(-ix * TILE_MM, -iy * TILE_MM);
    drawGerber(tctx, this.gerber, this.color, opt);
    return { canvas, scaleLevel: level, lastUsed: ++this.clock };
  }

  private blit(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, ix: number, iy: number, cam: Camera, opacity: number): void {
    // 瓦片像素按"板 Y 向上"存储（原点在板左下），屏幕 Y 向下，故贴时垂直翻转。
    // 取瓦片板矩形的屏幕包围盒，用负高度 drawImage 实现翻转。
    const x0 = ix * TILE_MM;
    const y0 = iy * TILE_MM;
    const pLow = boardToScreen(cam, x0, y0); // 板左下角 → 屏幕
    const pHigh = boardToScreen(cam, x0 + TILE_MM, y0 + TILE_MM); // 板右上角 → 屏幕
    const dx = Math.min(pLow.x, pHigh.x);
    const dy = Math.min(pLow.y, pHigh.y);
    const dw = Math.abs(pHigh.x - pLow.x);
    const dh = Math.abs(pHigh.y - pLow.y);
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = cam.scale < 8;
    // 源瓦片整张取出，目标矩形顶部 dy，负 dh 向上绘制即垂直翻转
    ctx.translate(0, dy + dh);
    ctx.scale(1, -1);
    ctx.drawImage(tile, dx, 0, dw, dh);
    ctx.restore();
  }

  private evictIfNeeded(): void {
    if (this.tiles.size <= MAX_TILES) return;
    const entries = [...this.tiles.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const drop = this.tiles.size - MAX_TILES;
    for (let i = 0; i < drop; i++) this.tiles.delete(entries[i]![0]);
  }

  invalidate(): void {
    this.tiles.clear();
  }
}
