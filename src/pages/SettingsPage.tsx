import { useStore } from '../state/store';
import { RULE_PRESETS } from '../core/drc/rules';
import { mmToMil } from '../core/units';

export function SettingsPage() {
  const projects = useStore((s) => s.projects);
  const updateProject = useStore((s) => s.updateProject);
  const activeId = useStore((s) => s.activeProjectId);
  const active = projects.find((p) => p.id === activeId);

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 720 }}>
        <h2>隐私与本地处理</h2>
        <p className="muted">
          本工具所有 Gerber/钻孔解析、栅格分析、DRC、拼版计算均在当前浏览器内完成，不发起任何网络请求，不写入原始图纸。
          工单仅保存层配置等元数据到浏览器 IndexedDB；清空浏览器站点数据即可彻底删除。
        </p>
        <button
          className="danger"
          onClick={() => {
            if (confirm('确认清空本站在 IndexedDB 中的全部工单元数据？解析缓存随刷新释放。')) {
              indexedDB.deleteDatabase('gerbercraft');
              location.reload();
            }
          }}
        >
          清空全部本地工单数据
        </button>
      </div>

      <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2>工单参数</h2>
        {active ? (
          <>
            <div className="form-row">
              <label>工单名称</label>
              <input value={active.name} onChange={(e) => updateProject(active.id, { name: e.target.value })} style={{ width: 260 }} />
            </div>
            <div className="form-row">
              <label>板厚 mm</label>
              <input
                type="number"
                step={0.1}
                value={active.boardThicknessMm}
                onChange={(e) => updateProject(active.id, { boardThicknessMm: Number(e.target.value) })}
                style={{ width: 120 }}
              />
            </div>
          </>
        ) : (
          <div className="muted">没有打开的工单</div>
        )}
      </div>

      <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2>板厂能力档参考</h2>
        <table>
          <thead>
            <tr><th>档位</th><th>线宽/线距</th><th>最小孔</th><th>孔环</th><th>丝印间距</th></tr>
          </thead>
          <tbody>
            {RULE_PRESETS.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{mmToMil(r.rules.minTraceWidth).toFixed(0)} / {mmToMil(r.rules.minClearance).toFixed(0)} mil</td>
                <td>{mmToMil(r.rules.minDrillSize).toFixed(0)} mil</td>
                <td>{mmToMil(r.rules.minAnnularRing).toFixed(0)} mil</td>
                <td>{r.rules.minSilkSpacing.toFixed(2)} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 8 }}>
          数值按国内常见打样厂公开能力整理，下单前请以实际板厂工艺能力为准，在工艺检查页可改成自定义数值。
        </p>
      </div>

      <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2>渲染性能说明</h2>
        <ul className="muted">
          <li>图元按 20mm 瓦片做离屏缓存，平移只贴瓦片，跨越缩放档才重画受影响瓦片（LRU 上限 400 块/层）。</li>
          <li>视口外图元不参与绘制；栅格分析最长边限制 4096px，自动降低分辨率防内存溢出。</li>
          <li>圆弧细分弦高 5µm，区域填充走 evenodd 奇偶规则，负片 clear 极性用 destination-out 擦除。</li>
        </ul>
      </div>
    </div>
  );
}
