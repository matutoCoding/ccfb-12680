import { useState } from 'react';
import { runDrc } from '../core/drc/engine';
import { RULE_LABELS, RULE_PRESETS } from '../core/drc/rules';
import { fmtMm } from '../core/units';
import { useStore } from '../state/store';
import type { DrcRuleId } from '../core/types';

const RULE_ORDER: DrcRuleId[] = ['minTraceWidth', 'minClearance', 'minDrillSize', 'minAnnularRing', 'minSilkSpacing'];

export function DrcPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const ruleSet = useStore((s) => s.ruleSet);
  const setRulePreset = useStore((s) => s.setRulePreset);
  const updateRules = useStore((s) => s.updateRules);
  const violations = useStore((s) => s.violations);
  const setViolations = useStore((s) => s.setViolations);
  const running = useStore((s) => s.drcRunning);
  const setRunning = useStore((s) => s.setDrcRunning);
  const jumpTo = useStore((s) => s.jumpTo);
  const setPage = useStore((s) => s.setPage);
  const [progress, setProgress] = useState('');

  if (!project) return <div className="empty-state">请先打开工单</div>;

  const run = async () => {
    setRunning(true);
    setViolations([]);
    try {
      const result = await runDrc(project.layers, ruleSet, (p) => setProgress(`${p.phase} ${p.percent}%`));
      setViolations(result);
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const errors = violations.filter((v) => v.severity === 'error').length;
  const warns = violations.filter((v) => v.severity === 'warning').length;

  return (
    <div className="page">
      <div className="card">
        <h2>工艺检查规则档</h2>
        <div className="pill-row">
          {RULE_PRESETS.map((r) => (
            <button key={r.id} className={ruleSet.id === r.id ? 'primary' : ''} onClick={() => setRulePreset(r.id)}>
              {r.name}
            </button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          {ruleSet.note}
        </p>
        <table style={{ maxWidth: 640, marginTop: 12 }}>
          <thead>
            <tr>
              <th>检查项</th>
              <th>要求（mm）</th>
              <th>等效 mil</th>
            </tr>
          </thead>
          <tbody>
            {RULE_ORDER.map((id) => (
              <tr key={id}>
                <td>{RULE_LABELS[id]}</td>
                <td>
                  <input
                    type="number"
                    step={0.005}
                    value={ruleSet.rules[id]}
                    onChange={(e) => updateRules({ [id]: Number(e.target.value) })}
                  />
                </td>
                <td className="muted">{(ruleSet.rules[id] / 25.4) * 1000 >= 1 ? ((ruleSet.rules[id] / 25.4) * 1000).toFixed(1) : '—'} mil</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 16 }} className="row-actions">
          <button className="primary" disabled={running} onClick={() => void run()}>
            {running ? '检查中…' : '开始逐项检查'}
          </button>
          {progress && <span className="muted">{progress}</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>
          违规清单
          {violations.length > 0 && (
            <span style={{ marginLeft: 10, fontSize: 13 }}>
              <span className="badge error">{errors} 错误</span> <span className="badge warning">{warns} 警告</span>
            </span>
          )}
        </h2>
        {violations.length === 0 ? (
          <div className="empty-state">{running ? '正在检查…' : '尚未运行检查，或当前规则下没有违规'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>级别</th>
                <th>项目</th>
                <th>说明</th>
                <th>实测</th>
                <th>要求</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v) => (
                <tr
                  key={v.id}
                  className="clickable"
                  onClick={() => {
                    jumpTo(v.x, v.y);
                    setPage('viewer');
                  }}
                >
                  <td>
                    <span className={`badge ${v.severity}`}>{v.severity === 'error' ? '错误' : '警告'}</span>
                  </td>
                  <td>{RULE_LABELS[v.rule]}</td>
                  <td>{v.message}</td>
                  <td>{v.measured !== undefined ? fmtMm(v.measured) : '—'}</td>
                  <td>{v.required !== undefined ? fmtMm(v.required) : '—'}</td>
                  <td>
                    <button>跳到图上</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
