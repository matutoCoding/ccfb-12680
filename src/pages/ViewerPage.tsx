import { useMemo } from 'react';
import { CanvasView } from '../components/CanvasView';
import { LayerPanel } from '../components/LayerPanel';
import { useStore } from '../state/store';
import { fmtMm } from '../core/units';
import type { BBox } from '../core/types';

export function ViewerPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const viewerTool = useStore((s) => s.viewerTool);
  const setViewerTool = useStore((s) => s.setViewerTool);
  const measurements = useStore((s) => s.measurements);
  const addMeasurement = useStore((s) => s.addMeasurement);
  const removeMeasurement = useStore((s) => s.removeMeasurement);
  const clearMeasurements = useStore((s) => s.clearMeasurements);
  const setHighlight = useStore((s) => s.setHighlight);

  const boardBBox = useMemo<BBox | null>(() => {
    if (!project) return null;
    let b: BBox | null = null;
    for (const l of project.layers) {
      const lb = l.gerber?.bbox ?? l.drill?.bbox;
      if (!lb) continue;
      if (!b) b = { ...lb };
      else
        b = {
          minX: Math.min(b.minX, lb.minX),
          minY: Math.min(b.minY, lb.minY),
          maxX: Math.max(b.maxX, lb.maxX),
          maxY: Math.max(b.maxY, lb.maxY),
        };
    }
    return b;
  }, [project]);

  if (!project) return <div className="empty-state">请先在工单列表打开一个工单</div>;

  return (
    <div className="page no-pad viewer-layout">
      <LayerPanel project={project} />
      <div style={{ position: 'relative', minWidth: 0 }}>
        <div className="overlay-toolbar">
          <button className={viewerTool === 'pan' ? 'primary' : ''} onClick={() => setViewerTool('pan')}>
            平移
          </button>
          <button className={viewerTool === 'measure' ? 'primary' : ''} onClick={() => setViewerTool('measure')}>
            框选测量
          </button>
          <button className={viewerTool === 'select' ? 'primary' : ''} onClick={() => setViewerTool('select')}>
            点选网络
          </button>
          <button
            onClick={() => {
              setHighlight(null, null);
            }}
          >
            清除高亮
          </button>
          <button onClick={clearMeasurements} disabled={measurements.length === 0}>
            清空标注
          </button>
        </div>
        {measurements.length > 0 && (
          <div className="overlay-panel">
            <strong>测量标注（{measurements.length}）</strong>
            <table style={{ marginTop: 6 }}>
              <tbody>
                {measurements.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtMm(m.valueMm, true)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="danger" onClick={() => removeMeasurement(m.id)}>
                        删
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CanvasView
          layers={project.layers}
          boardBBox={boardBBox}
          measurements={measurements}
          onMeasure={(m) => addMeasurement(m)}
        />
      </div>
    </div>
  );
}
