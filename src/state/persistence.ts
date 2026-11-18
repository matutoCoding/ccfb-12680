import type { Project } from '../core/types';

/**
 * 工单持久化：解析结果（含 Map/图元）结构复杂，
 * 这里只存工单元数据与层配置；重新打开工单时提示重新导入原始 Gerber。
 * 原始文件不写入任何存储，保证"图纸不出本机"。
 */
const DB_NAME = 'gerbercraft';
const STORE = 'projects';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  boardThicknessMm: number;
  layerConfigs: Array<{
    id: string;
    fileName: string;
    type: Project['layers'][number]['type'];
    role: Project['layers'][number]['role'];
    side: Project['layers'][number]['side'];
    copperIndex: number;
    visible: boolean;
    opacity: number;
    color: string;
    roleManual: boolean;
  }>;
}

function toStored(p: Project): StoredProject {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    boardThicknessMm: p.boardThicknessMm,
    layerConfigs: p.layers.map((l) => ({
      id: l.id,
      fileName: l.fileName,
      type: l.type,
      role: l.role,
      side: l.side,
      copperIndex: l.copperIndex,
      visible: l.visible,
      opacity: l.opacity,
      color: l.color,
      roleManual: l.roleManual,
    })),
  };
}

export async function saveProjectMeta(p: Project): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(toStored(p));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadAllProjectMeta(): Promise<StoredProject[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as StoredProject[]) ?? []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function deleteProjectMeta(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export type { StoredProject };
