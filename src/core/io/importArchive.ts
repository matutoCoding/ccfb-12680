import { unzipSync, strFromU8 } from 'fflate';
import { parseExcellon } from '../excellon/parser';
import { parseGerber } from '../gerber/parser';
import { guessLayer, isGerberName } from '../layerIdentify';
import { DRILL_EXT } from '../layerIdentify';
import type { BoardLayer, LayerRole, LayerSide, ParseWarning } from '../types';

export interface RawFile {
  name: string;
  bytes: Uint8Array;
  text: string;
}

export interface ImportResult {
  layers: BoardLayer[];
  warnings: ParseWarning[];
  skipped: string[];
}

const TEXT_EXT = /\.(gbr|ger|g\d+|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gko|gm\d+|drl|nc|xln|txt|exc|tap|cnc|cmp|sol|plc|pls|art\d*|top|bot|inner\d*|pho|drr)$/i;
const SKIP_EXT = /\.(zip|rar|7z|pdf|png|jpg|jpeg|bmp|gif|svg|exe|dll|bin|hex|sch|brd|pcbdoc|schdoc|kicad_pcb|json|csv|xlsx?|md)$/i;

/** 解开板厂压缩包（zip），也支持直接喂单个/多个文件 */
export function extractArchive(data: Uint8Array): RawFile[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new Error('压缩包解析失败：请确认是标准 ZIP（板厂常见 .zip/.rar 中仅 zip 可在浏览器本地解开）');
  }
  const out: RawFile[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    out.push({ name: name.split('/').pop() || name, bytes, text: decodeBytes(bytes) });
  }
  return out;
}

export function toRawFile(name: string, bytes: Uint8Array): RawFile {
  return { name, bytes, text: decodeBytes(bytes) };
}

function decodeBytes(bytes: Uint8Array): string {
  // 板厂文件基本都是 ASCII/UTF-8；GBK 注释乱码不影响坐标解析
  try {
    return strFromU8(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

let layerSeq = 0;

/** 逐个文件解析并识别层角色；认不出的层标记 unknown 等待人工修正 */
export function importFiles(files: RawFile[]): ImportResult {
  const warnings: ParseWarning[] = [];
  const skipped: string[] = [];
  const layers: BoardLayer[] = [];

  for (const f of files) {
    const base = f.name.toLowerCase();
    if (SKIP_EXT.test(base) && !TEXT_EXT.test(base)) {
      skipped.push(f.name);
      continue;
    }
    if (!TEXT_EXT.test(base) && !looksLikeGerber(f.text) && !looksLikeExcellon(f.text)) {
      skipped.push(f.name);
      continue;
    }

    const guess = guessLayer(f.name);
    const isDrill = guess.isDrill || DRILL_EXT.test(base) || looksLikeExcellon(f.text);

    if (isDrill && !looksLikeGerber(f.text)) {
      const drill = parseExcellon(f.text, f.name);
      warnings.push(...drill.warnings.map((w) => ({ ...w, message: `[${f.name}] ${w.message}` })));
      layers.push({
        id: `layer-${++layerSeq}`,
        fileName: f.name,
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
      });
      continue;
    }

    if (isGerberName(f.name) || looksLikeGerber(f.text)) {
      const gerber = parseGerber(f.text, f.name);
      warnings.push(...gerber.warnings.map((w) => ({ ...w, message: `[${f.name}] ${w.message}` })));
      layers.push({
        id: `layer-${++layerSeq}`,
        fileName: f.name,
        type: 'gerber',
        role: guess.role === 'unknown' ? 'copper' : guess.role,
        side: guess.side,
        copperIndex: guess.copperIndex,
        visible: true,
        opacity: defaultOpacity(guess.role),
        color: defaultColor(guess.role, guess.side),
        gerber,
        warnings: gerber.warnings,
        roleManual: false,
      });
    } else {
      skipped.push(f.name);
    }
  }

  // 铜层按 copperIndex 排序，顶/底校正
  sortCopperLayers(layers);
  return { layers, warnings, skipped };
}

function looksLikeGerber(text: string): boolean {
  return /%FS|%MO|G04|%AD|D0[123]/.test(text.slice(0, 4000));
}

function looksLikeExcellon(text: string): boolean {
  return /M48|T\d+C|G8[125]|^T\d+\s*$/m.test(text.slice(0, 4000));
}

function defaultOpacity(role: LayerRole): number {
  if (role === 'soldermask') return 0.45;
  if (role === 'silkscreen') return 0.9;
  if (role === 'solderpaste') return 0.6;
  if (role === 'outline') return 1;
  return 0.85;
}

function defaultColor(role: LayerRole, side: LayerSide): string {
  switch (role) {
    case 'copper':
      return side === 'bottom' ? '#42b883' : '#d98e04';
    case 'soldermask':
      return side === 'bottom' ? '#2f6fb0' : '#1f9d55';
    case 'silkscreen':
      return '#f5f5f5';
    case 'solderpaste':
      return '#c084fc';
    case 'outline':
      return '#ffd166';
    default:
      return '#9aa5b1';
  }
}

function sortCopperLayers(layers: BoardLayer[]): void {
  const coppers = layers.filter((l) => l.role === 'copper');
  coppers.sort((a, b) => a.copperIndex - b.copperIndex);
  if (coppers.length > 0) {
    coppers[0]!.side = 'top';
    coppers[coppers.length - 1]!.side = 'bottom';
    if (coppers.length > 1) {
      for (let i = 1; i < coppers.length - 1; i++) coppers[i]!.side = 'inner';
    }
  }
}
