import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  BoardLayer,
  DrcRuleSet,
  DrcViolation,
  LayerRole,
  LayerSide,
  Measurement,
  Project,
} from '../core/types';
import { RULE_PRESETS, customRuleSet } from '../core/drc/rules';
import type { PanelOptions } from '../core/panel/panelize';
import { DEFAULT_PANEL_OPTIONS } from '../core/panel/panelize';

export type PageId = 'workorders' | 'viewer' | 'drc' | 'panel' | 'drill' | 'diff' | 'settings';

interface AppState {
  page: PageId;
  projects: Project[];
  activeProjectId: string | null;
  activeLayerIds: string[];
  ruleSet: DrcRuleSet;
  panelOptions: PanelOptions;
  violations: DrcViolation[];
  drcRunning: boolean;
  measurements: Measurement[];
  highlightedNetGraphics: Set<unknown> | null;
  highlightLayerId: string | null;
  diffOldProjectId: string | null;
  diffNewProjectId: string | null;
  viewerTool: 'pan' | 'measure' | 'select';
  jumpTarget: { x: number; y: number; nonce: number } | null;

  setPage: (p: PageId) => void;
  createProject: (name: string, layers: BoardLayer[], thicknessMm?: number) => string;
  removeProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  setActiveProject: (id: string | null) => void;
  updateLayer: (projectId: string, layerId: string, patch: Partial<BoardLayer>) => void;
  reorderLayers: (projectId: string, orderedIds: string[]) => void;
  setRulePreset: (id: string) => void;
  updateRules: (overrides: Partial<Record<keyof DrcRuleSet['rules'], number>>) => void;
  setPanelOptions: (patch: Partial<PanelOptions>) => void;
  setViolations: (v: DrcViolation[]) => void;
  setDrcRunning: (b: boolean) => void;
  addMeasurement: (m: Omit<Measurement, 'id'>) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
  setHighlight: (layerId: string | null, graphics: Set<unknown> | null) => void;
  setDiffProjects: (oldId: string | null, newId: string | null) => void;
  setViewerTool: (t: AppState['viewerTool']) => void;
  jumpTo: (x: number, y: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  page: 'workorders',
  projects: [],
  activeProjectId: null,
  activeLayerIds: [],
  ruleSet: RULE_PRESETS[0]!,
  panelOptions: { ...DEFAULT_PANEL_OPTIONS },
  violations: [],
  drcRunning: false,
  measurements: [],
  highlightedNetGraphics: null,
  highlightLayerId: null,
  diffOldProjectId: null,
  diffNewProjectId: null,
  viewerTool: 'pan',
  jumpTarget: null,

  setPage: (page) => set({ page }),

  createProject: (name, layers, thicknessMm = 1.6) => {
    const id = nanoid(10);
    const now = Date.now();
    const project: Project = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      boardThicknessMm: thicknessMm,
      layers,
    };
    set((s) => ({
      projects: [...s.projects, project],
      activeProjectId: id,
      activeLayerIds: layers.filter((l) => l.visible).map((l) => l.id),
      page: 'viewer',
    }));
    return id;
  },

  removeProject: (id) =>
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    })),

  updateProject: (id, patch) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
    })),

  setActiveProject: (id) => {
    const proj = get().projects.find((p) => p.id === id) ?? null;
    set({
      activeProjectId: id,
      activeLayerIds: proj ? proj.layers.filter((l) => l.visible).map((l) => l.id) : [],
      violations: [],
      measurements: [],
      highlightedNetGraphics: null,
      jumpTarget: null,
    });
  },

  updateLayer: (projectId, layerId, patch) =>
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              layers: p.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
              updatedAt: Date.now(),
            }
          : p,
      ),
    })),

  reorderLayers: (projectId, orderedIds) =>
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p;
        const map = new Map(p.layers.map((l) => [l.id, l]));
        const reordered = orderedIds.map((id) => map.get(id)!).filter(Boolean);
        return { ...p, layers: reordered, updatedAt: Date.now() };
      }),
    })),

  setRulePreset: (id) => {
    const preset = RULE_PRESETS.find((r) => r.id === id) ?? RULE_PRESETS[0]!;
    set({ ruleSet: preset });
  },

  updateRules: (overrides) => {
    const cur = get().ruleSet;
    set({ ruleSet: customRuleSet(cur, overrides) });
  },

  setPanelOptions: (patch) => set((s) => ({ panelOptions: { ...s.panelOptions, ...patch } })),
  setViolations: (violations) => set({ violations }),
  setDrcRunning: (drcRunning) => set({ drcRunning }),

  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, { ...m, id: nanoid(8) }] })),
  removeMeasurement: (id) => set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) })),
  clearMeasurements: () => set({ measurements: [] }),

  setHighlight: (highlightLayerId, highlightedNetGraphics) => set({ highlightLayerId, highlightedNetGraphics }),
  setDiffProjects: (diffOldProjectId, diffNewProjectId) => set({ diffOldProjectId, diffNewProjectId }),
  setViewerTool: (viewerTool) => set({ viewerTool }),
  jumpTo: (x, y) => set({ jumpTarget: { x, y, nonce: Date.now() } }),
}));

export function selectActiveProject(s: AppState): Project | null {
  return s.projects.find((p) => p.id === s.activeProjectId) ?? null;
}

export function roleLabel(role: LayerRole): string {
  const map: Record<LayerRole, string> = {
    copper: '线路铜层',
    soldermask: '阻焊层',
    silkscreen: '丝印层',
    solderpaste: '钢网层',
    outline: '外形层',
    mechanical: '机械层',
    drill: '钻孔层',
    document: '文档层',
    unknown: '未识别',
  };
  return map[role];
}

export function sideLabel(side: LayerSide): string {
  return side === 'top' ? '顶面' : side === 'bottom' ? '底面' : side === 'inner' ? '内层' : '—';
}
