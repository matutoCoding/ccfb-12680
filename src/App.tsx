import { useStore, type PageId } from './state/store';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { ViewerPage } from './pages/ViewerPage';
import { DrcPage } from './pages/DrcPage';
import { PanelPage } from './pages/PanelPage';
import { DrillPage } from './pages/DrillPage';
import { DiffPage } from './pages/DiffPage';
import { SettingsPage } from './pages/SettingsPage';

const NAV: Array<{ id: PageId; label: string }> = [
  { id: 'workorders', label: '工单' },
  { id: 'viewer', label: '层叠看图' },
  { id: 'drc', label: '工艺检查' },
  { id: 'panel', label: '拼版' },
  { id: 'drill', label: '钻孔表' },
  { id: 'diff', label: '改版对比' },
  { id: 'settings', label: '设置' },
];

export function App() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const active = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">GerberCraft</span>
        {NAV.map((n) => (
          <button key={n.id} className={`nav ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            {n.label}
          </button>
        ))}
        <span className="spacer" />
        {active && <span className="project-name">当前工单：{active.name}</span>}
      </header>
      {page === 'workorders' && <WorkOrdersPage />}
      {page === 'viewer' && <ViewerPage />}
      {page === 'drc' && <DrcPage />}
      {page === 'panel' && <PanelPage />}
      {page === 'drill' && <DrillPage />}
      {page === 'diff' && <DiffPage />}
      {page === 'settings' && <SettingsPage />}
    </div>
  );
}
