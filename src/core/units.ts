import type { Unit } from './types';

export const MM_PER_IN = 25.4;
export const MIL_PER_IN = 1000;
export const UM_PER_MM = 1000;

export function inToMm(v: number): number {
  return v * MM_PER_IN;
}

export function mmToMil(mm: number): number {
  return (mm / MM_PER_IN) * MIL_PER_IN;
}

export function milToMm(mil: number): number {
  return (mil / MIL_PER_IN) * MM_PER_IN;
}

export function umToMm(um: number): number {
  return um / UM_PER_MM;
}

export function convertToMm(value: number, unit: Unit): number {
  return unit === 'in' ? inToMm(value) : value;
}

/** 工程显示：毫米保留 3 位（1µm），并附 mil */
export function fmtMm(mm: number, withMil = false): string {
  const s = `${mm.toFixed(3)} mm`;
  return withMil ? `${s} (${mmToMil(mm).toFixed(1)} mil)` : s;
}

export function fmtNum(mm: number): string {
  return mm.toFixed(3);
}

/** 角度归一化到 [0, 360) */
export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
