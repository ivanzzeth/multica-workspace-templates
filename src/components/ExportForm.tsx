import { useState } from 'react';
import type { useApi, Workspace, TemplateDetail } from '../hooks/useApi.js';

interface Props {
  api: ReturnType<typeof useApi>;
}

export function ExportForm({ api }: Props) {
  const [workspaceList] = useState<Workspace[]>(api.workspaces);
  const [selectedWs, setSelectedWs] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doPreview = async (ws: Workspace) => {
    setSelectedWs(ws);
    setLoading(true);
    setError(null);
    try {
      const t = await api.exportPreview(ws.id);
      setPreview(t);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const doExport = async () => {
    if (!selectedWs || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const path = await api.exportApply(selectedWs.id, name.trim());
      setSavedTo(path);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="card">
      <h2>Export Workspace to Template</h2>
      <p className="hint">Export a workspace's configuration as a reusable template (env vars are automatically sanitized).</p>

      {error && <div className="error-banner">{error}</div>}
      {savedTo && (
        <div className="success-banner">
          Template saved to: <code>{savedTo}</code>
        </div>
      )}

      {!selectedWs && (
        <div className="ws-list">
          {workspaceList.map((w) => (
            <button key={w.id} className="ws-card" onClick={() => doPreview(w)}>
              <strong>{w.name}</strong>
              <code className="ws-id">{w.id}</code>
            </button>
          ))}
        </div>
      )}

      {loading && <div className="spinner" />}

      {preview && !savedTo && (
        <div className="export-form">
          <h3>Preview</h3>
          <div className="badges">
            <span>{preview.agents.length} agents</span>
            <span>{preview.projects.length} projects</span>
            <span>{preview.labels.length} labels</span>
            <span>{preview.autopilots.length} autopilots</span>
          </div>

          <div className="form-field">
            <label>Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MyTemplate"
            />
          </div>

          <div className="btn-row">
            <button className="btn" onClick={() => { setSelectedWs(null); setPreview(null); }}>
              Back
            </button>
            <button className="btn btn-primary" onClick={doExport} disabled={loading || !name.trim()}>
              {loading ? 'Exporting...' : 'Export'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
