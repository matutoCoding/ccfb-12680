import { useEffect, useMemo, useRef, useState } from 'react';
import { diffGerbers, type GerberDiff } from '../core/diff/compare';
import { useStore } from '../state/store';
import { fmtMm } from '../core/units';
import type { GerberFile } from '../core/types';

export function DiffPage() {
  const projects = useStore((s) => s.projects);
  const oldId = useStore((s) => s.diffOldProjectId);
  const newId = useStore((s) => s.diffNewProjectId);
  const setIds = useStore((s) => s.setDiffProjects);
  const jumpTo = useStore((s) => s.jumpTo);
  const setPage = useStore((s) => s.setPage);
  const [diff, setDiff] = useState<GerberDiff | null>(null);
  const [running, setRunning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const oldCopper = useMemo(() => pickCopper(projects.find((p) => p.id === oldId)), [projects, oldId]);
  const newCopper = useMemo(() => pickCopper(projects.find((p) => p.id === newId)), [projects, newId]);

  const run = async () => {
    if (!oldCopper || !newCopper) return;
    setRunning(true);
    try {
      const d = await diffGerbers(oldCopper, newCopper, 0.02);
      setDiff(d);
    } finally {
      setRunning(false);
    }
  };

  // 渲染差异掩膜
  useEffect(() => {
    if (!diff) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.min(900, diff.addedMask.length ** 0.5);
    const scale = canvas.width / diff.bbox.maxX;
    canvas.width = Math.max(2, Math.ceil((diff.bbox.maxX - diff.bbox.minX) * 40));
    canvas.height = Math.max(2, Math.ceil((diff.bbox.maxY - diff.bbox.minY) * 40));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / (diff.bbox.maxX - diff.bbox.minX);
    const sy = canvas.height / (diff.bbox.maxY - diff.bbox.minY);
    void scale;
    void w;
    for (let i = 0; i < diff.addedMask.length; i++) {
      if (!diff.addedMask[i] && !diff.removedMask[i]) continue;
      const py = Math.floor(i / diff.addedMask.length ** 0.5);
      const px = i - py * diff.addedMask.length ** 0.5;
      ctx.fillStyle = diff.addedMask[i] ? '#3ddc97' : '#ff5d5d';
      const x = (px * diff.resolutionMm) * sx;
      const y = (py * diff.resolutionMm) * sy;
      ctx.fillRect(x, y, Math.ceil(diff.resolutionMm * sx), Math.ceil(diff.resolutionMm * sy));
    }
  }, [diff]);

  if (projects.length < 2) return <div className="empty-state">改版对比需要先导入两份 Gerber 工单（新版、旧版各一个）</div>;

  return (
    <div className="page">
      <div className="card">
        <h2>改版前后叠图对比</h2>
        <div className="form-row">
          <label>旧版工单（基准）</label>
          <select value={oldId ?? ''} onChange={(e) => setIds(e.target.value || null, newId)}>
            <option value="">请选择</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>新版工单</label>
          <select value={newId ?? ''} onChange={(e) => setIds(oldId, e.target.value || null)}>
            <option value="">请选择</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <button className="primary" disabled={!oldCopper || !newCopper || running} onClick={() => void run()}>
          {running ? '栅格比对中…' : '开始叠图对比'}
        </button>
        {(!oldCopper || !newCopper) && <span className="muted" style={{ marginLeft: 10 }}>两个工单都需要含铜层 Gerber</span>}
      </div>

      {diff && (
        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="card">
            <h3>差异分布图</h3>
            <canvas ref={canvasRef} className="diff-canvas" style={{ width: '100%' }} />
            <div style={{ marginTop: 8 }}>
              <span className="legend-dot" style={{ background: '#3ddc97' }} />新增铜皮
              <span className="legend-dot" style={{ background: '#ff5d5d', marginLeft: 16 }} />减少铜皮
            </div>
          </div>
          <div className="card scroll-box">
            <h3>
              差异清单（{diff.clusters.length} 处）
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                新增 {diff.addedCount} px / 减少 {diff.removedCount} px
              </span>
            </h3>
            <table>
              <thead>
                <tr><th>类型</th><th>面积 mm²</th><th>位置</th><th></th></tr>
              </thead>
              <tbody>
                {diff.clusters.slice(0, 200).map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => { jumpTo(c.x, c.y); setPage('viewer'); }}>
                    <td><span className={`badge ${c.kind === 'added' ? 'ok' : 'error'}`}>{c.kind === 'added' ? '新增' : '减少'}</span></td>
                    <td>{c.areaMm2.toFixed(3)}</td>
                    <td className="muted">{fmtMm(c.x)}, {fmtMm(c.y)}</td>
                    <td><button>定位</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {diff.clusters.length > 200 && <div className="muted">仅展示前 200 处，按面积降序</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function pickCopper(project: { layers: Array<{ role: string; gerber?: GerberFile }> } | undefined): GerberFile | null {
  if (!project) return null;
  return project.layers.find((l) => l.role === 'copper' && l.gerber)?.gerber ?? null;
}
