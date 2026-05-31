import { useState, useEffect, useCallback, useRef } from 'react';
import type { useApi, Workspace, TemplateDetail, TemplateAutopilot } from '../hooks/useApi.js';

interface Props {
  api: ReturnType<typeof useApi>;
}

type Step = 'workspace' | 'mode' | 'preview';

export function ExportForm({ api }: Props) {
  const [step, setStep] = useState<Step>('workspace');
  const [selectedWs, setSelectedWs] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [entitiesSaved, setEntitiesSaved] = useState(0);
  const [exportedVersion, setExportedVersion] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<'inline' | 'reference' | 'mixed'>('inline');
  const [agentModes, setAgentModes] = useState<Record<string, 'inline' | 'entity'>>({});
  const [skillModes, setSkillModes] = useState<Record<string, 'inline' | 'entity'>>({});
  const [apModes, setApModes] = useState<Record<string, 'inline' | 'entity'>>({});
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState({
    agents: true, autopilots: true, skills: true, projects: false, labels: false,
  });

  const apiRef = useRef(api);
  apiRef.current = api;

  const toggleOption = (key: keyof typeof options) => {
    setOptions((o) => ({ ...o, [key]: !o[key] }));
  };

  const doPreview = useCallback(async (ws: Workspace) => {
    setSelectedWs(ws);
    setLoading(true);
    setError(null);
    try {
      const opts: any = { ...options, mode: exportMode };
      if (exportMode === 'mixed') {
        opts.agent_mode = agentModes;
        opts.skill_mode = skillModes;
        opts.autopilot_mode = apModes;
      }
      const t = await apiRef.current.exportPreview(ws.id, opts);
      setPreview(t);
      setName(ws.name);
      setStep('preview');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [options, exportMode, agentModes, skillModes, apModes]);

  const doExport = useCallback(async () => {
    if (!selectedWs || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const opts: any = { ...options, mode: exportMode };
      if (exportMode === 'mixed') {
        opts.agent_mode = agentModes;
        opts.skill_mode = skillModes;
        opts.autopilot_mode = apModes;
      }
      const result = await apiRef.current.exportApply(selectedWs.id, name.trim(), opts);
      setSavedTo(result.saved_to);
      setExportedVersion(result.version);
      setEntitiesSaved(result.entities_saved || 0);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [selectedWs, name, options, exportMode, agentModes, skillModes, apModes]);

  const reset = useCallback(() => {
    setStep('workspace'); setSelectedWs(null); setPreview(null); setSavedTo(null);
    setEntitiesSaved(0); setError(null); setExportMode('inline');
    setAgentModes({}); setSkillModes({}); setApModes({});
  }, []);

  const hasOverwrite = preview && api.templates.find((t) => t.name === name.trim());
  const existingVersion = hasOverwrite?.version;

  return (
    <div className="wizard">
      <div className="steps">
        <div className={`step ${step === 'workspace' ? 'active' : 'done'}`}><span className="step-num">1</span><span className="step-label">Workspace</span></div>
        <div className={`step ${step === 'mode' ? 'active' : step === 'preview' ? 'done' : ''}`}><span className="step-num">2</span><span className="step-label">Mode</span></div>
        <div className={`step ${step === 'preview' ? 'active' : ''}`}><span className="step-num">3</span><span className="step-label">Preview & Export</span></div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {savedTo && (
        <div className="success-banner">
          Template v{exportedVersion} saved to: <code>{savedTo}</code>
          {entitiesSaved > 0 && <div style={{ marginTop: 4 }}>{entitiesSaved} entities extracted to registry.</div>}
        </div>
      )}

      {step === 'workspace' && (
        <div className="card">
          <h2>Select Workspace</h2>
          <p className="hint">Choose a workspace to export its configuration. Env vars will be sanitized.</p>
          <WorkspaceList api={api} onSelect={(ws: Workspace) => { setSelectedWs(ws); setStep('mode'); }} />
        </div>
      )}

      {step === 'mode' && (
        <div className="card">
          <h2>Export Mode</h2>
          <p className="hint">Choose how agents/skills/autopilots are exported.</p>

          <div className="mode-select">
            {([
              { mode: 'inline' as const, label: 'Inline only (v1 compatible)', desc: 'Everything stays in one YAML file. No entity files created.' },
              { mode: 'reference' as const, label: 'Entity references only', desc: 'All agents/skills/autopilots extracted as entities. Template is pure refs (~50 lines).' },
              { mode: 'mixed' as const, label: 'Mixed — choose per entity', desc: 'Pick which entities stay inline vs become refs. Best for gradual migration.' },
            ]).map((m) => (
              <label key={m.mode} className={`mode-option ${exportMode === m.mode ? 'selected' : ''}`}>
                <input type="radio" name="mode" checked={exportMode === m.mode} onChange={() => setExportMode(m.mode)} />
                <div><strong>{m.label}</strong><span className="desc">{m.desc}</span></div>
              </label>
            ))}
          </div>

          <div className="btn-row">
            <button className="btn" onClick={() => setStep('workspace')}>Back</button>
            <button className="btn btn-primary" onClick={() => selectedWs && doPreview(selectedWs)} disabled={loading}>
              {loading ? 'Loading...' : 'Continue to Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="card">
          <h2>Preview Export</h2>

          <p className="hint" style={{ marginBottom: 16 }}>
            Mode: <strong>{exportMode}</strong>
            {exportMode === 'reference' && ' — agents and skills will be extracted as entities.'}
            {exportMode === 'mixed' && ' — customize per entity below.'}
          </p>

          <div className="badges" style={{ marginBottom: 16 }}>
            <span>{preview.agents.length} agents</span>
            <span>{preview.projects.length} projects</span>
            <span>{preview.labels.length} labels</span>
            <span>{preview.autopilots.length} autopilots</span>
            {preview.skills && <span>{preview.skills.length} skills</span>}
          </div>

          {/* Include checkboxes */}
          <h3>Sections to Include</h3>
          <div className="checkbox-grid">
            {([
              ['agents', 'Agents'],
              ['autopilots', 'Autopilots'],
              ['skills', 'Skills'],
              ['projects', 'Projects'],
              ['labels', 'Labels'],
            ] as [keyof typeof options, string][]).map(([key, label]) => (
              <label key={key} className={`checkbox-option ${options[key] ? 'checked' : ''}`}>
                <input type="checkbox" checked={options[key]} onChange={() => toggleOption(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {exportMode === 'mixed' && preview.agents.length > 0 && (
            <div style={{ margin: '16px 0' }}>
              <h3>Agent Export Mode</h3>
              {preview.agents.map((a) => (
                <label key={a.name} className="checkbox-option" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={(agentModes[a.name] || 'inline') === 'entity'}
                    onChange={() => setAgentModes((prev) => ({ ...prev, [a.name]: prev[a.name] === 'entity' ? 'inline' : 'entity' }))} />
                  <span><strong>{a.name}</strong> — {agentModes[a.name] === 'entity' ? '🔵 Extract as entity' : '📄 Keep inline'}</span>
                </label>
              ))}
            </div>
          )}

          {exportMode === 'mixed' && preview.skills && preview.skills.length > 0 && (
            <div style={{ margin: '16px 0' }}>
              <h3>Skill Export Mode</h3>
              {preview.skills.map((s) => (
                <label key={s.name} className="checkbox-option" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={(skillModes[s.name] || 'inline') === 'entity'}
                    onChange={() => setSkillModes((prev) => ({ ...prev, [s.name]: prev[s.name] === 'entity' ? 'inline' : 'entity' }))} />
                  <span><strong>{s.name}</strong> — {skillModes[s.name] === 'entity' ? '🔵 Extract as entity' : '📄 Keep inline'}</span>
                </label>
              ))}
            </div>
          )}

          <button className="btn-small" style={{ margin: '8px 0' }} onClick={() => selectedWs && doPreview(selectedWs)} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh Preview'}
          </button>

          {/* Agents preview */}
          <h3>Agents</h3>
          <AgentList agents={preview.agents} />

          {/* Autopilots preview */}
          {preview.autopilots.length > 0 && (
            <><h3>Autopilots</h3><AutopilotList autopilots={preview.autopilots} /></>
          )}

          {/* Projects preview */}
          {preview.projects.length > 0 && (
            <><h3>Projects</h3>{preview.projects.map((p) => (
              <div key={p.title} className="dry-item" style={{ display: 'block', padding: '8px 12px', marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>{p.title}</strong>
                <span className="reason" style={{ fontSize: 11 }}>{p.status}</span>
              </div>
            ))}</>
          )}

          {/* Labels preview */}
          {preview.labels.length > 0 && (
            <><h3>Labels</h3><ProjectLabelList items={preview.labels.map((l) => ({ name: l.name, detail: l.color }))} /></>
          )}

          {/* Name input */}
          <div className="form-field" style={{ marginTop: 16 }}>
            <label>Template Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="MyTemplate" />
          </div>

          {hasOverwrite && (
            <div className="warning-banner">A template named "{name}" already exists (v{existingVersion}). Exporting will create the next version.</div>
          )}

          <div className="btn-row">
            <button className="btn" onClick={() => setStep('mode')}>Back</button>
            <button className="btn btn-primary" onClick={doExport} disabled={loading || !name.trim()}>
              {loading ? 'Exporting...' : 'Export Template'}
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
  const [list, setList] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    apiRef.current.fetchWorkspaces().then(setList).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (loading) return <div className="spinner" />;
  if (list.length === 0) return <div className="empty-state"><p>No workspaces found.</p></div>;

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

function AgentList({ agents }: { agents: any[] }) {
  return <div className="dry-run-items" style={{ marginBottom: 12 }}>
    {agents.map((a) => (
      <span key={a.name} className="dry-item" style={{ borderColor: '#6366f1' }}>
        {a.name}<span className="reason" style={{ fontSize: 10 }}>{a.runtime_provider}{a.model ? ` · ${a.model}` : ''}{a.skills?.length ? ` · ${a.skills.length} skills` : ''}</span>
      </span>
    ))}
  </div>;
}

function AutopilotList({ autopilots }: { autopilots: TemplateAutopilot[] }) {
  return <div style={{ marginBottom: 12 }}>
    {autopilots.map((ap) => (
      <div key={ap.title} className="dry-item" style={{ display: 'block', padding: '8px 12px', marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>{ap.title}</strong>
        <span className="reason" style={{ fontSize: 11 }}>→ {ap.agent_ref} · {ap.mode}</span>
        {ap.triggers && ap.triggers.length > 0 && <div style={{ marginTop: 4 }}>
          {ap.triggers.map((t, i) => (
            <span key={i} className="dry-item" style={{ fontSize: 10, padding: '2px 6px', background: 'transparent' }}>
              ⏱ {t.cron} ({t.timezone}){t.label ? ` — ${t.label}` : ''}
            </span>
          ))}
        </div>}
      </div>
    ))}
  </div>;
}

function ProjectLabelList({ items }: { items: { name: string; detail: string }[] }) {
  return <div className="dry-run-items" style={{ marginBottom: 12 }}>
    {items.map((item) => (
      <span key={item.name} className="dry-item">{item.name}<span className="reason">{item.detail}</span></span>
    ))}
  </div>;
}
