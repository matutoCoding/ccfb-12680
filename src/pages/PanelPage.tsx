import { useMemo } from 'react';
import { buildPanel } from '../core/panel/panelize';
import { useStore } from '../state/store';
import { fmtMm } from '../core/units';

export function PanelPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const opt = useStore((s) => s.panelOptions);
  const setOpt = useStore((s) => s.setPanelOptions);

  const layout = useMemo(() => (project ? buildPanel(project.layers, opt) : null), [project, opt]);

  if (!project) return <div className="empty-state">请先打开工单</div>;

  return (
    <div className="page">
      <div className="grid-2">
        <div className="card">
          <h2>拼版参数</h2>
          <div className="form-row">
            <label>列数 × 行数</label>
            <span>
              <input type="number" min={1} max={20} value={opt.cols} style={{ width: 70 }} onChange={(e) => setOpt({ cols: clampInt(e.target.value, 1, 20) })} />
              {' × '}
              <input type="number" min={1} max={20} value={opt.rows} style={{ width: 70 }} onChange={(e) => setOpt({ rows: clampInt(e.target.value, 1, 20) })} />
            </span>
          </div>
          <div className="form-row">
            <label>分离方式</label>
            <span>
              <label style={{ marginRight: 12 }}>
                <input type="radio" checked={opt.separation === 'vcut'} onChange={() => setOpt({ separation: 'vcut' })} /> V-Cut
              </label>
              <label>
                <input type="radio" checked={opt.separation === 'stamp'} onChange={() => setOpt({ separation: 'stamp' })} /> 邮票孔
              </label>
            </span>
          </div>
          <NumRow label="铣刀直径（板间距）mm" value={opt.cutterDiameterMm} step={0.1} onChange={(v) => setOpt({ cutterDiameterMm: v })} disabled={opt.separation !== 'stamp'} />
          <NumRow label="工艺边宽度 mm" value={opt.railWidthMm} step={0.5} onChange={(v) => setOpt({ railWidthMm: v })} />
          <NumRow label="邮票孔直径 mm" value={opt.stampHoleDiameterMm} step={0.1} onChange={(v) => setOpt({ stampHoleDiameterMm: v })} disabled={opt.separation !== 'stamp'} />
          <NumRow label="邮票孔间距 mm" value={opt.stampHolePitchMm} step={0.1} onChange={(v) => setOpt({ stampHolePitchMm: v })} disabled={opt.separation !== 'stamp'} />
          <NumRow label="定位孔直径 mm" value={opt.toolingHoleDiameterMm} step={0.1} onChange={(v) => setOpt({ toolingHoleDiameterMm: v })} />
          <NumRow label="定位孔距边 mm" value={opt.toolingHoleInsetMm} step={0.1} onChange={(v) => setOpt({ toolingHoleInsetMm: v })} />
        </div>

        <div className="card">
          <h2>拼版预览</h2>
          {layout && (
            <>
              <PanelSvg layout={layout} />
              <table style={{ marginTop: 12 }}>
                <tbody>
                  <tr><td>单板尺寸</td><td>{fmtMm(layout.boardW)} × {fmtMm(layout.boardH)}</td></tr>
                  <tr><td>板间距（X/Y）</td><td>{fmtMm(layout.gapX)} / {fmtMm(layout.gapY)}</td></tr>
                  <tr><td>工艺边</td><td>{fmtMm(layout.rail)}（四边）</td></tr>
                  <tr><td>整拼尺寸</td><td>{fmtMm(layout.panelW)} × {fmtMm(layout.panelH)}</td></tr>
                  <tr><td>单板数量</td><td>{layout.cells.length} pcs</td></tr>
                  <tr><td>邮票孔数量</td><td>{layout.stampHoles.length}</td></tr>
                  <tr><td>V-Cut 线</td><td>{layout.vcutLines.length} 条</td></tr>
                  <tr><td>定位孔</td><td>{layout.toolingHoles.length} 个（四角）</td></tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NumRow(props: { label: string; value: number; step: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="form-row">
      <label>{props.label}</label>
      <input type="number" step={props.step} value={props.value} disabled={props.disabled} style={{ width: 110 }} onChange={(e) => props.onChange(Number(e.target.value))} />
    </div>
  );
}

function clampInt(s: string, lo: number, hi: number): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function PanelSvg({ layout }: { layout: NonNullable<ReturnType<typeof buildPanel>> }) {
  const pad = 20;
  const scale = 600 / Math.max(layout.panelW, layout.panelH);
  const w = layout.panelW * scale + pad * 2;
  const h = layout.panelH * scale + pad * 2;
  const X = (x: number) => pad + x * scale;
  const Y = (y: number) => pad + y * scale;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', background: '#0a0e13', borderRadius: 8 }}>
      <rect x={X(0)} y={Y(0)} width={layout.panelW * scale} height={layout.panelH * scale} fill="none" stroke="#ffd166" strokeWidth={1.5} />
      {layout.cells.map((c) => (
        <rect key={`${c.col}-${c.row}`} x={X(c.x + layout.boardBBox.minX)} y={Y(c.y + layout.boardBBox.minY)} width={layout.boardW * scale} height={layout.boardH * scale} fill="rgba(77,163,255,0.15)" stroke="#4da3ff" strokeWidth={1} />
      ))}
      {layout.vcutLines.map((v, i) =>
        v.axis === 'x' ? (
          <line key={i} x1={X(v.value)} y1={Y(0)} x2={X(v.value)} y2={Y(layout.panelH)} stroke="#ff5d5d" strokeDasharray="6 4" strokeWidth={1} />
        ) : (
          <line key={i} x1={X(0)} y1={Y(v.value)} x2={X(layout.panelW)} y2={Y(v.value)} stroke="#ff5d5d" strokeDasharray="6 4" strokeWidth={1} />
        ),
      )}
      {layout.stampHoles.map((s, i) => <circle key={i} cx={X(s.x)} cy={Y(s.y)} r={Math.max(1.2, (s.diameter / 2) * scale)} fill="none" stroke="#c084fc" strokeWidth={1} />)}
      {layout.toolingHoles.map((t, i) => <circle key={i} cx={X(t.x)} cy={Y(t.y)} r={(t.diameter / 2) * scale} fill="#3ddc97" />)}
    </svg>
  );
}
