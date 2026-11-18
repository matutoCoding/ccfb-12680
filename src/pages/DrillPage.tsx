import { useMemo } from 'react';
import { buildDrillTable } from '../core/drill/drillTable';
import { fmtMm, mmToMil } from '../core/units';
import { useStore } from '../state/store';

export function DrillPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const drillLayers = useMemo(() => project?.layers.filter((l) => l.role === 'drill' && l.drill) ?? [], [project]);

  if (!project) return <div className="empty-state">请先打开工单</div>;
  if (drillLayers.length === 0) return <div className="empty-state">本工单没有钻孔文件</div>;

  return (
    <div className="page">
      {drillLayers.map((layer) => {
        const df = layer.drill!;
        const stats = buildDrillTable(df);
        return (
          <div className="card" key={layer.id} style={{ marginBottom: 16 }}>
            <h2>
              钻孔表 · {layer.fileName}
              <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 10 }}>
                单位 {df.unit === 'in' ? 'inch' : 'mm'} · 共 {stats.totalHits} 孔 / {stats.totalSlots} 槽
              </span>
            </h2>

            {(stats.unknownTools.length > 0 || stats.unusedTools.length > 0) && (
              <div style={{ marginBottom: 10 }}>
                {stats.unknownTools.map((t) => (
                  <div key={t} className="badge error" style={{ marginRight: 8 }}>
                    报警：钻孔图使用了刀表未声明的 {t}
                  </div>
                ))}
                {stats.unusedTools.map((t) => (
                  <div key={t} className="badge warning" style={{ marginRight: 8 }}>
                    注意：{t} 已声明但从未使用
                  </div>
                ))}
              </div>
            )}

            <table>
              <thead>
                <tr>
                  <th>刀号</th>
                  <th>孔径 mm</th>
                  <th>等效 mil</th>
                  <th>镀覆</th>
                  <th>孔数</th>
                  <th>槽数</th>
                  <th>类型</th>
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((row) => (
                  <tr key={row.tool}>
                    <td>{row.tool}</td>
                    <td>{fmtMm(row.diameterMm)}</td>
                    <td>{mmToMil(row.diameterMm).toFixed(1)}</td>
                    <td>
                      <span className={`badge ${row.plated ? 'ok' : 'warning'}`}>{row.plated ? 'PTH 镀覆' : 'NPTH 非镀'}</span>
                    </td>
                    <td>{row.hitCount}</td>
                    <td>{row.slotCount}</td>
                    <td>{row.routed ? '路由槽孔' : '圆孔'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="muted" style={{ marginTop: 10 }}>
              镀覆孔 {stats.platedHits} · 非镀孔 {stats.unplatedHits} · 槽孔按路由段识别，折点 ≥2 段判定为异形槽
            </div>
          </div>
        );
      })}
    </div>
  );
}
