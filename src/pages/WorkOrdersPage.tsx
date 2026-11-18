import { useRef, useState } from 'react';
import { extractArchive, importFiles, toRawFile, type RawFile } from '../core/io/importArchive';
import { buildDemoLayers } from '../core/demoData';
import { useStore } from '../state/store';
import type { ParseWarning } from '../core/types';

export function WorkOrdersPage() {
  const projects = useStore((s) => s.projects);
  const createProject = useStore((s) => s.createProject);
  const removeProject = useStore((s) => s.removeProject);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const setPage = useStore((s) => s.setPage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState<{ name: string; files: RawFile[] } | null>(null);
  const [warnings, setWarnings] = useState<ParseWarning[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ingest = async (fileList: FileList | File[]) => {
    setError(null);
    const raws: RawFile[] = [];
    for (const file of Array.from(fileList)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (/\.zip$/i.test(file.name)) {
        try {
          raws.push(...extractArchive(buf));
        } catch (e) {
          setError((e as Error).message);
          return;
        }
      } else {
        raws.push(toRawFile(file.name, buf));
      }
    }
    if (raws.length === 0) {
      setError('压缩包里没有找到文件');
      return;
    }
    const name = (fileList[0]?.name ?? '工单').replace(/\.(zip|rar|7z)$/i, '');
    setPending({ name, files: raws });
    const result = importFiles(raws);
    setWarnings(result.warnings);
    setSkipped(result.skipped);
    // 解析结果暂存到 ref 风格变量：确认时建单
    parsedLayersRef.current = result.layers;
  };

  const parsedLayersRef = useRef<ReturnType<typeof importFiles>['layers']>([]);

  const confirmCreate = () => {
    if (!pending || parsedLayersRef.current.length === 0) return;
    createProject(pending.name, parsedLayersRef.current);
    setPending(null);
    setWarnings([]);
    setSkipped([]);
  };

  return (
    <div className="page">
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void ingest(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div className="big">把板厂 Gerber 压缩包拖到这里</div>
        <div className="muted">支持 ZIP（内含 .gbr/.drl 等），也可直接多选单个 Gerber/钻孔文件。全部在浏览器本地解析，原始文件不上传、不落盘。</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".zip,.gbr,.ger,.drl,.nc,.xln,.txt,.gts,.gbs,.gtl,.gbl,.gko,.tap"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && void ingest(e.target.files)}
        />
      </div>

      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button
          onClick={() => {
            createProject('演示工单（内置）', buildDemoLayers());
          }}
        >
          没有文件？载入内置演示板（覆盖宏光圈/圆弧/负片/槽孔）
        </button>
      </div>

      {error && <p className="danger-text" style={{ marginTop: 12 }}>{error}</p>}

      {pending && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>解析预览：{pending.name}</h3>
          <p className="muted">
            识别到 {parsedLayersRef.current.length} 个层/文件
            {skipped.length > 0 && `，跳过 ${skipped.length} 个非图纸文件：${skipped.join(', ')}`}
          </p>
          {warnings.length > 0 && (
            <details>
              <summary className="warn-text">解析警告（{warnings.length}）——不影响建单，但建议老师傅复核</summary>
              <ul style={{ maxHeight: 200, overflow: 'auto' }}>
                {warnings.map((w, i) => (
                  <li key={i} className="warn-text">
                    [{w.code}] {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="primary" onClick={confirmCreate}>
              建立工单并进入看图
            </button>
            <button onClick={() => setPending(null)}>取消</button>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 28 }}>工单列表</h2>
      {projects.length === 0 ? (
        <div className="empty-state">还没有工单，拖一个压缩包开始</div>
      ) : (
        <div className="grid-2">
          {projects.map((p) => (
            <div key={p.id} className="card workorder-card">
              <div>
                <strong>{p.name}</strong>
                <div className="meta">
                  {p.layers.length} 层 · 板厚 {p.boardThicknessMm} mm · 更新于 {new Date(p.updatedAt).toLocaleString()}
                </div>
                <div className="meta">
                  {p.layers.filter((l) => l.role === 'copper').length} 铜层 / {p.layers.filter((l) => l.role === 'drill').length} 钻孔层
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="primary"
                  onClick={() => {
                    setActiveProject(p.id);
                    setPage('viewer');
                  }}
                >
                  打开
                </button>
                <button
                  onClick={() => {
                    removeProject(p.id);
                  }}
                  className="danger"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
