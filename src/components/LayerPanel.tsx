import { useState } from 'react';
import { roleLabel, sideLabel, useStore } from '../state/store';
import type { BoardLayer, LayerRole, LayerSide, Project } from '../core/types';

const ROLES: LayerRole[] = ['copper', 'soldermask', 'silkscreen', 'solderpaste', 'outline', 'mechanical', 'drill', 'document', 'unknown'];
const SIDES: LayerSide[] = ['top', 'bottom', 'inner', 'none'];

interface Props {
  project: Project;
}

export function LayerPanel({ project }: Props) {
  const updateLayer = useStore((s) => s.updateLayer);
  const reorderLayers = useStore((s) => s.reorderLayers);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = project.layers.map((l) => l.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    reorderLayers(project.id, ids);
    setDragId(null);
    setOverId(null);
  };

  const flipView = () => {
    // 顶底层一键镜像对齐：交换顶/底层顺序并提示画布镜像由查看工具栏控制
    const coppers = project.layers.filter((l) => l.role === 'copper');
    if (coppers.length < 2) return;
    const top = coppers[0]!;
    const bottom = coppers[coppers.length - 1]!;
    updateLayer(project.id, top.id, { side: 'bottom', copperIndex: 99 });
    updateLayer(project.id, bottom.id, { side: 'top', copperIndex: 0 });
  };

  return (
    <div className="layer-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong>层叠管理（{project.layers.length} 层）</strong>
        <button onClick={flipView} title="交换顶/底层角色，配合画布镜像从板底对齐查看">顶底镜像对齐</button>
      </div>
      {project.layers.map((layer) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          dragging={dragId === layer.id}
          dragOver={overId === layer.id}
          onDragStart={() => setDragId(layer.id)}
          onDragEnter={() => setOverId(layer.id)}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          onDrop={() => onDrop(layer.id)}
          onChange={(patch) => updateLayer(project.id, layer.id, patch)}
        />
      ))}
      {project.layers.length === 0 && <div className="empty-state">没有图层</div>}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        拖拽行可调整层叠顺序；认不出的层在这里手改角色。
      </div>
    </div>
  );
}

function LayerRow(props: {
  layer: BoardLayer;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onChange: (patch: Partial<BoardLayer>) => void;
}) {
  const { layer, onChange } = props;
  const count = layer.gerber?.graphics.length ?? layer.drill?.hits.length ?? 0;
  return (
    <div
      className="layer-row"
      draggable
      onDragStart={props.onDragStart}
      onDragEnter={props.onDragEnter}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop();
      }}
      style={{ opacity: props.dragging ? 0.5 : 1, outline: props.dragOver ? '1px solid var(--accent)' : undefined }}
    >
      <div className="name">
        <span className="swatch" style={{ background: layer.color }} />
        <span title={layer.fileName}>{layer.fileName}</span>
      </div>
      <div className="controls">
        <input type="checkbox" checked={layer.visible} onChange={(e) => onChange({ visible: e.target.checked })} />
        <select value={layer.role} onChange={(e) => onChange({ role: e.target.value as LayerRole, roleManual: true })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
        <select value={layer.side} onChange={(e) => onChange({ side: e.target.value as LayerSide })}>
          {SIDES.map((s) => (
            <option key={s} value={s}>
              {sideLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="controls">
        <span>透明</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={layer.opacity}
          style={{ flex: 1 }}
          onChange={(e) => onChange({ opacity: Number(e.target.value) })}
        />
        <span>{Math.round(layer.opacity * 100)}%</span>
      </div>
      <div className="controls">
        <span className="muted">{layer.type === 'drill' ? '钻孔' : `${count} 图元`}</span>
        {layer.roleManual && <span className="badge warning">手改</span>}
        {layer.warnings.length > 0 && <span className="badge error" title={layer.warnings.map((w) => w.message).join('\n')}>{layer.warnings.length} 警告</span>}
      </div>
    </div>
  );
}
