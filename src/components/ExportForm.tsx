import { useState, useCallback } from 'react';
import type { useApi, Workspace, TemplateDetail, TemplateAutopilot } from '../hooks/useApi.js';

interface Props {
  api: ReturnType<typeof useApi>;
}

type Step = 'workspace' | 'preview';

export function ExportForm({ api }: Props) {
  const [step, setStep] = useState<Step>('workspace');
  const [selectedWs, setSelectedWs] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [exportedVersion, setExportedVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doPreview = useCallback(async (ws: Workspace) => {
    setSelectedWs(ws);
    setLoading(true);
    setError(null);
    try {
      const t = await api.exportPreview(ws.id);
      setPreview(t);
      setName(ws.name);
      setStep('preview');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [api]);

  const doExport = useCallback(async () => {
    if (!selectedWs || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.exportApply(selectedWs.id, name.trim());
      setSavedTo(result.saved_to);
      setExportedVersion(result.version);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [selectedWs, name, api]);

  const reset = useCallback(() => {
    setStep('workspace');
    setSelectedWs(null);
    setPreview(null);
    setSavedTo(null);
    setError(null);
  }, []);

  const hasOverwrite = preview && api.templates.find((t) => t.name === name.trim());
  const existingVersion = hasOverwrite?.version;

  return (
    <div className="wizard">
      <div className="steps">
        <div className={`step ${step === 'workspace' ? 'active' : 'done'}`}>
          <span className="step-num">1</span>
          <span className="step-label">Workspace</span>
        </div>
        <div className={`step ${step === 'preview' ? 'active' : ''}`}>
          <span className="step-num">2</span>
          <span className="step-label">Preview & Export</span>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {savedTo && (
        <div className="success-banner">
          Template v{exportedVersion} saved to: <code>{savedTo}</code>
        </div>
      )}

      {step === 'workspace' && (
        <div className="card">
          <h2>Select Workspace</h2>
          <p className="hint">Choose a workspace to export its configuration as a reusable template. Env vars will be automatically sanitized.</p>
          <WorkspaceList api={api} onSelect={doPreview} />
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="card">
          <h2>Preview Export</h2>

          <div className="badges" style={{ marginBottom: 16 }}>
            <span>{preview.agents.length} agents</span>
            <span>{preview.projects.length} projects</span>
            <span>{preview.labels.length} labels</span>
            <span>{preview.autopilots.length} autopilots</span>
          </div>

          {/* Agents preview */}
          <h3>Agents</h3>
          <AgentList agents={preview.agents} />

          {/* Autopilots preview */}
          {preview.autopilots.length > 0 && (
            <>
              <h3>Autopilots</h3>
              <AutopilotList autopilots={preview.autopilots} />
            </>
          )}

          {/* Projects preview */}
          {preview.projects.length > 0 && (
            <>
              <h3>Projects</h3>
              <ProjectLabelList items={preview.projects.map((p) => ({ name: p.title, detail: p.status }))} />
            </>
          )}

          {/* Labels preview */}
          {preview.labels.length > 0 && (
            <>
              <h3>Labels</h3>
              <ProjectLabelList items={preview.labels.map((l) => ({ name: l.name, detail: l.color }))} />
            </>
          )}

          {/* Name input */}
          <div className="form-field">
            <label>Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MyTemplate"
            />
          </div>

          {hasOverwrite && (
            <div className="warning-banner">
              A template named "{name}" already exists (v{existingVersion}). Exporting will overwrite it with the next version.
            </div>
          )}

          <div className="btn-row">
            <button className="btn" onClick={() => { setStep('workspace'); setPreview(null); }}>
              Back
            </button>
            <button className="btn btn-primary" onClick={doExport} disabled={loading || !name.trim()}>
              {loading ? 'Exporting...' : hasOverwrite ? 'Overwrite Template' : 'Export Template'}
            </button>
          </div>

          {loading && <div className="spinner" style={{ marginTop: 16 }} />}
        </div>
      )}

      {savedTo && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button className="btn btn-primary" onClick={reset}>Export Another</button>
        </div>
      )}
    </div>
  );
}

function WorkspaceList({ api, onSelect }: { api: ReturnType<typeof useApi>; onSelect: (w: Workspace) => void }) {
  const [list, setList] = useState<Workspace[]>(api.workspaces);
  const [loading, setLoading] = useState(list.length === 0);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    api.fetchWorkspaces()
      .then(setList)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (loading) return <div className="spinner" />;

  if (list.length === 0) {
    return (
      <div className="empty-state">
        <p>No workspaces found.</p>
        <p className="hint">Create one in the Multica web UI first, then run <code>multica login</code> to connect.</p>
      </div>
    );
  }

  return (
    <div className="ws-list">
      {list.map((w) => (
        <button key={w.id} className="ws-card" onClick={() => onSelect(w)}>
          <strong>{w.name}</strong>
          {w.is_current && <span className="badge">current</span>}
          <code className="ws-id">{w.id}</code>
        </button>
      ))}
    </div>
  );
}

function AgentList({ agents }: { agents: TemplateDetail['agents'] }) {
  return (
    <div className="dry-run-items" style={{ marginBottom: 12 }}>
      {agents.map((a) => (
        <span key={a.name} className="dry-item" style={{ borderColor: '#6366f1' }}>
          {a.name}
          <span className="reason" style={{ fontSize: 10 }}>
            {a.runtime_provider}{a.model ? ` · ${a.model}` : ''}
          </span>
        </span>
      ))}
    </div>
  );
}

function AutopilotList({ autopilots }: { autopilots: TemplateAutopilot[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {autopilots.map((ap) => (
        <div key={ap.title} className="dry-item" style={{ display: 'block', padding: '8px 12px', marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>{ap.title}</strong>
          <span className="reason" style={{ fontSize: 11 }}>
            → {ap.agent_ref} · {ap.mode}
          </span>
          {ap.triggers && ap.triggers.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {ap.triggers.map((t, i) => (
                <span key={i} className="dry-item" style={{ fontSize: 10, padding: '2px 6px', background: 'transparent' }}>
                  ⏱ {t.cron} ({t.timezone}){t.label ? ` — ${t.label}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProjectLabelList({ items }: { items: { name: string; detail: string }[] }) {
  return (
    <div className="dry-run-items" style={{ marginBottom: 12 }}>
      {items.map((item) => (
        <span key={item.name} className="dry-item">
          {item.name}
          <span className="reason">{item.detail}</span>
        </span>
      ))}
    </div>
  );
}
