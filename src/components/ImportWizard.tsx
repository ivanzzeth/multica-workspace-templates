import { useState, useEffect, useCallback, useRef } from 'react';
import type { useApi, Workspace, TemplateSummary, TemplateDetail, RuntimeInfo, ServerProfile } from '../hooks/useApi.js';

interface Props {
  api: ReturnType<typeof useApi>;
  currentServer?: ServerProfile | null;
}

type Step = 'workspace' | 'template' | 'runtime' | 'result';

export function ImportWizard({ api, currentServer }: Props) {
  const [step, setStep] = useState<Step>('workspace');
  const [ws, setWs] = useState<Workspace | null>(null);
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [templateName, setTemplateName] = useState<string>('');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [runtimeMap, setRuntimeMap] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'skip-existing' | 'force-overwrite'>('skip-existing');
  const [loading, setLoading] = useState(false);
  const [dryRun, setDryRun] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { current: number; total: number; action: string; item: string }>>({});
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [envTemplate, setEnvTemplate] = useState<Record<string, string>>({});
  const [envSavedMsg, setEnvSavedMsg] = useState<string | null>(null);

  const apiRef = useRef(api);
  apiRef.current = api;

  // Step 1: select workspace
  const selectWorkspace = useCallback(
    (w: Workspace) => {
      setWs(w);
      setTemplates([]);
      setStep('template');
      apiRef.current.fetchTemplates().then(setTemplates);
    },
    [],
  );

  // Step 2: select template
  const selectTemplate = useCallback(
    async (name: string) => {
      setLoading(true);
      setTemplateName(name);
      setError(null);
      try {
        const t = await apiRef.current.fetchTemplate(name);
        setTemplate(t);
        setStep('runtime');
        if (ws) {
          const rs = await apiRef.current.fetchRuntimes(ws.id);
          setRuntimes(rs);
          // Pre-fill runtime map based on provider match
          const initialMap: Record<string, string> = {};
          for (const agent of t.agents) {
            const match = rs.find((r) => r.provider === agent.runtime_provider);
            initialMap[agent.name] = match?.id || '';
          }
          setRuntimeMap(initialMap);

          // Collect all env var templates from agents and auto-resolve from global secrets
          const allEnv: Record<string, string> = {};
          for (const agent of t.agents) {
            if (agent.custom_env_template) {
              Object.assign(allEnv, agent.custom_env_template);
            }
          }
          setEnvTemplate(allEnv);

          if (Object.keys(allEnv).length > 0) {
            try {
              const resolved = await apiRef.current.resolveSecrets(allEnv, currentServer?.id);
              // Merge: global secret values take priority
              const initial: Record<string, string> = { ...allEnv };
              for (const key of Object.keys(resolved)) {
                if (resolved[key]) initial[key] = resolved[key];
              }
              setEnvVars(initial);
            } catch {
              setEnvVars(allEnv);
            }
          }
        }
      } catch (e: any) {
        setError(e.message);
      }
      setLoading(false);
    },
    [ws],
  );

  // Step 3: backfill
  const doDryRun = useCallback(async () => {
    if (!ws || !templateName) return;
    setLoading(true);
    setError(null);
    try {
      const map = template!.agents.map((a) => ({
        agent_name: a.name,
        runtime_provider: a.runtime_provider,
        runtime_id: runtimeMap[a.name] || '',
        runtime_name: runtimes.find((r) => r.id === runtimeMap[a.name])?.name || '',
      }));
      const dr = await apiRef.current.dryRunImport({
        template_name: templateName,
        workspace_id: ws.id,
        runtime_map: map,
        mode,
        env_vars: envVars,
      });
      setDryRun(dr);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [ws, templateName, template, runtimeMap, mode, runtimes]);

  const doApply = useCallback(async () => {
    if (!ws || !templateName) return;
    setLoading(true);
    setError(null);
    setProgress({});
    try {
      const map = template!.agents.map((a) => ({
        agent_name: a.name,
        runtime_provider: a.runtime_provider,
        runtime_id: runtimeMap[a.name] || '',
        runtime_name: runtimes.find((r) => r.id === runtimeMap[a.name])?.name || '',
      }));
      const res = await apiRef.current.applyImport(
        { template_name: templateName, workspace_id: ws.id, runtime_map: map, mode, env_vars: envVars },
        (evt) => {
          setProgress((p) => ({
            ...p,
            [evt.phase]: { current: evt.current, total: evt.total, action: evt.action, item: evt.item },
          }));
        },
      );
      setResult(res);
      setStep('result');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [ws, templateName, template, runtimeMap, mode, runtimes]);

  const reset = useCallback(() => {
    setStep('workspace');
    setWs(null);
    setTemplate(null);
    setDryRun(null);
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="wizard">
      {/* Step indicator */}
      <div className="steps">
        {['workspace', 'template', 'runtime', 'result'].map((s, i) => (
          <div key={s} className={`step ${step === s ? 'active' : ''} ${['workspace','template','runtime','result'].indexOf(step) > i ? 'done' : ''}`}>
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{s === 'workspace' ? 'Workspace' : s === 'template' ? 'Template' : s === 'runtime' ? 'Configure' : 'Result'}</span>
          </div>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {step === 'workspace' && (
        <div className="card">
          <h2>Select Workspace</h2>
          <p className="hint">Choose a Multica workspace to import the template into.</p>
          <WorkspaceList api={api} onSelect={selectWorkspace} />
        </div>
      )}

      {step === 'template' && (
        <div className="card">
          <h2>Select Template</h2>
          <p className="hint">Choose a template to preview and import.</p>
          {templates.map((t) => (
            <button key={t.name} className="template-card" onClick={() => selectTemplate(t.name)}>
              <strong>{t.name} <span className="version-badge">v{t.version}</span></strong>
              <span className="desc">{t.description}</span>
              <span className="badges">
                <span>{t.agent_count} agents</span>
                <span>{t.project_count} projects</span>
                <span>{t.label_count} labels</span>
                <span>{t.autopilot_count} autopilots</span>
                {t.skill_count > 0 && <span>{t.skill_count} skills</span>}
              </span>
            </button>
          ))}
          <button className="btn btn-back" onClick={() => setStep('workspace')}>Back</button>
        </div>
      )}

      {step === 'runtime' && template && (
        <div className="card">
          <h2>Configure Import</h2>

          <h3>Runtime Mapping</h3>
          <p className="hint">Assign each agent to an available runtime.</p>
          <table className="runtime-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Suggested Provider</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {template.agents.map((a) => (
                <tr key={a.name}>
                  <td>{a.name}</td>
                  <td><code>{a.runtime_provider}</code></td>
                  <td>
                    <select
                      value={runtimeMap[a.name] || ''}
                      onChange={(e) => setRuntimeMap((m) => ({ ...m, [a.name]: e.target.value }))}
                    >
                      <option value="">-- select --</option>
                      {runtimes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.provider})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {Object.keys(envTemplate).length > 0 && (
            <>
              <h3>Environment Variables</h3>
              <p className="hint">
                {currentServer ? <>Resolved from <strong>{currentServer.name}</strong> server → global fallback.</> : 'Resolved from global secrets.'}
                {' '}Replace <code>{'${KEY}'}</code> placeholders with real values.
              </p>
              <table className="runtime-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Template Placeholder</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(envTemplate).map((key) => (
                    <tr key={key}>
                      <td><code>{key}</code></td>
                      <td><code style={{ fontSize: 11, color: 'var(--text2)' }}>{envTemplate[key]}</code></td>
                      <td>
                        <input
                          className="env-input"
                          type="text"
                          value={envVars[key] || ''}
                          onChange={(e) => setEnvVars((v) => ({ ...v, [key]: e.target.value }))}
                          placeholder={envTemplate[key]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {currentServer && (
                <>
                  <button
                    className="btn btn-small"
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      try {
                        const r = await apiRef.current.saveSecretsToServer(currentServer.id, envVars);
                        setEnvSavedMsg(`${r.saved} secret${r.saved !== 1 ? 's' : ''} saved to ${currentServer.name}`);
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    Save to {currentServer.name} Server Secrets
                  </button>
                  {envSavedMsg && <div className="success-banner" style={{ marginTop: 8 }}>{envSavedMsg}</div>}
                </>
              )}
            </>
          )}

          <h3>Import Mode</h3>
          <div className="mode-select">
            <label className={`mode-option ${mode === 'skip-existing' ? 'selected' : ''}`}>
              <input type="radio" name="mode" value="skip-existing" checked={mode === 'skip-existing'} onChange={() => setMode('skip-existing')} />
              <div>
                <strong>Skip Existing</strong>
                <span className="desc">Only create items that don't exist yet. Safe to re-run.</span>
              </div>
            </label>
            <label className={`mode-option ${mode === 'force-overwrite' ? 'selected' : ''}`}>
              <input type="radio" name="mode" value="force-overwrite" checked={mode === 'force-overwrite'} onChange={() => setMode('force-overwrite')} />
              <div>
                <strong>Force Overwrite</strong>
                <span className="desc">Update existing agents with template values. Projects/labels/autopilots won't be overwritten.</span>
              </div>
            </label>
          </div>

          <div className="btn-row">
            <button className="btn" onClick={() => setStep('template')}>Back</button>
            <button className="btn btn-primary" onClick={doDryRun} disabled={loading}>
              {loading ? 'Analyzing...' : 'Dry Run'}
            </button>
          </div>

          {dryRun && (
            <div className="dry-run-result">
              <h3>Dry Run Results</h3>
              {(['skills', 'agents', 'projects', 'labels', 'autopilots'] as const).map((cat) => (
                <div key={cat} className="dry-run-category">
                  <h4>{cat.charAt(0).toUpperCase() + cat.slice(1)}</h4>
                  <div className="dry-run-items">
                    {dryRun[cat].map((item: any) => (
                      <span key={item.name} className={`dry-item ${item.action}`}>
                        <span className="action-badge">{item.action}</span> {item.name}
                        {item.reason && <span className="reason">— {item.reason}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <button className="btn btn-primary" onClick={doApply} disabled={loading}>
                {loading ? 'Applying...' : 'Apply Import'}
              </button>

              {loading && Object.keys(progress).length > 0 && (
                <div className="progress-panel" style={{ marginTop: 16 }}>
                  <h3>Importing...</h3>
                  {(['skills', 'labels', 'projects', 'agents', 'autopilots'] as const).map((phase) => {
                    const p = progress[phase];
                    if (!p) return null;
                    const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 100;
                    return (
                      <div key={phase} className="progress-row">
                        <div className="progress-header">
                          <span className="progress-label">{phase.charAt(0).toUpperCase() + phase.slice(1)}</span>
                          <span className="progress-count">{p.current} / {p.total}</span>
                        </div>
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="progress-item">
                          <span className={`action-badge ${p.action}`}>{p.action}</span> {p.item}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'result' && result && (
        <div className="card">
          <h2>Import Complete</h2>
          <div className="result-summary">
            <div className="result-stat ok">
              <span className="stat-num">{result.created.agents + result.created.projects + result.created.labels + result.created.autopilots + result.created.triggers + result.created.skills}</span>
              <span className="stat-label">Created</span>
            </div>
            <div className="result-stat warn">
              <span className="stat-num">{result.updated.agents}</span>
              <span className="stat-label">Updated</span>
            </div>
            <div className="result-stat skip">
              <span className="stat-num">{result.skipped.agents + result.skipped.projects + result.skipped.labels + result.skipped.autopilots + result.skipped.triggers + result.skipped.skills}</span>
              <span className="stat-label">Skipped</span>
            </div>
            <div className="result-stat err-stat">
              <span className="stat-num">{result.errors.length}</span>
              <span className="stat-label">Errors</span>
            </div>
          </div>
          <div className="result-details">
            <p>Skills: {result.created.skills} created, {result.skipped.skills} skipped</p>
            <p>Agents: {result.created.agents} created, {result.updated.agents} updated, {result.skipped.agents} skipped</p>
            <p>Projects: {result.created.projects} created, {result.skipped.projects} skipped</p>
            <p>Labels: {result.created.labels} created, {result.skipped.labels} skipped</p>
            <p>Autopilots: {result.created.autopilots} created, {result.skipped.autopilots} skipped</p>
            <p>Triggers: {result.created.triggers} created, {result.skipped.triggers} skipped</p>
          </div>
          {result.errors.length > 0 && (
            <div className="error-list">
              <h4>Errors</h4>
              <ul>{result.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          <button className="btn btn-primary" onClick={reset}>Import Another</button>
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
    apiRef.current.fetchWorkspaces()
      .then(setList)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
