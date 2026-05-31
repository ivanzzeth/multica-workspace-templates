import { useState, useCallback, useRef } from 'react';
import type { useApi, TemplateSummary, TemplateDetail } from '../hooks/useApi.js';

interface Props {
  api: ReturnType<typeof useApi>;
}

export function TemplatesView({ api }: Props) {
  const [templates] = useState<TemplateSummary[]>(api.templates);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiRef = useRef(api);
  apiRef.current = api;

  const openDetail = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      const t = await apiRef.current.fetchTemplate(name);
      setDetail(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  if (detail) {
    return <TemplateDetailView template={detail} api={api} onBack={() => { setDetail(null); setError(null); }} />;
  }

  if (error) return <div className="error-banner">{error}</div>;

  if (templates.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <h2>No Templates</h2>
        <p className="hint">Export a workspace first, or place .yaml files in ~/.multica-templates/</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Templates</h2>
      <p className="hint">{templates.length} template{templates.length > 1 ? 's' : ''} available. Click to view details.</p>
      {templates.map((t) => (
        <button key={t.name} className="template-card" onClick={() => openDetail(t.name)}>
          <strong>{t.name} <span className="version-badge">v{t.version}</span> {t.mode && <span className="version-badge" style={{ background: t.mode === 'mixed' ? '#a855f7' : t.mode === 'reference' ? '#3b82f6' : '#6b7280' }}>{t.mode}</span>} <span className="source-badge">{t.source === 'user' ? 'local' : 'built-in'}</span></strong>
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
      {loading && <div className="spinner" style={{ marginTop: 16 }} />}
    </div>
  );
}

function TemplateDetailView({ template, api, onBack }: { template: TemplateDetail; api: ReturnType<typeof useApi>; onBack: () => void }) {
  const [extracting, setExtracting] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [extractMsg, setExtractMsg] = useState<string | null>(null);

  const doExtract = useCallback(async (type: 'agent' | 'skill' | 'autopilot', name: string) => {
    setExtractMsg(null);
    const key = `${type}-${name}`;
    setExtracting((prev) => ({ ...prev, [key]: 'loading' }));
    try {
      const payload: any = { agents: [], skills: [], autopilots: [] };
      if (type === 'agent') payload.agents = [name];
      else if (type === 'skill') payload.skills = [name];
      else payload.autopilots = [name];
      const result = await api.extractEntities(template.name, payload.agents, payload.skills, payload.autopilots);
      setExtracting((prev) => ({ ...prev, [key]: 'done' }));
      setExtractMsg(`✅ Extracted: ${result.extracted.join(', ')}`);
      setTimeout(() => setExtractMsg(null), 4000);
    } catch (e: any) {
      setExtracting((prev) => ({ ...prev, [key]: 'error' }));
      setExtractMsg(`❌ ${e.message}`);
      setTimeout(() => setExtractMsg(null), 4000);
    }
  }, [template.name, api]);

  const extractAll = useCallback(async () => {
    setExtractMsg(null);
    const agentNames = template.agents.map((a) => a.name);
    const skillNames = (template.skills || []).map((s) => s.name);
    const apNames = template.autopilots.map((a) => a.title);
    if (agentNames.length === 0 && skillNames.length === 0 && apNames.length === 0) return;

    const loading: Record<string, 'loading'> = {};
    agentNames.forEach((n) => { loading[`agent-${n}`] = 'loading'; });
    skillNames.forEach((n) => { loading[`skill-${n}`] = 'loading'; });
    apNames.forEach((n) => { loading[`autopilot-${n}`] = 'loading'; });
    setExtracting(loading);

    try {
      const result = await api.extractEntities(template.name, agentNames, skillNames, apNames);
      const done: Record<string, 'done'> = {};
      agentNames.forEach((n) => { done[`agent-${n}`] = 'done'; });
      skillNames.forEach((n) => { done[`skill-${n}`] = 'done'; });
      apNames.forEach((n) => { done[`autopilot-${n}`] = 'done'; });
      setExtracting(done);
      setExtractMsg(`✅ Extracted ${result.extracted.length} entities`);
      setTimeout(() => setExtractMsg(null), 4000);
    } catch (e: any) {
      setExtractMsg(`❌ ${e.message}`);
      setTimeout(() => setExtractMsg(null), 4000);
    }
  }, [template, api]);

  const extractBtn = (type: 'agent' | 'skill' | 'autopilot', name: string) => {
    const key = `${type}-${name}`;
    const state = extracting[key] || 'idle';
    if (state === 'loading') return <span className="badge" style={{ background: '#eab308' }}>⏳</span>;
    if (state === 'done') return <span className="badge" style={{ background: '#22c55e' }}>✅</span>;
    if (state === 'error') return <span className="badge" style={{ background: '#ef4444' }}>❌</span>;
    return (
      <button className="btn btn-small" onClick={(e) => { e.stopPropagation(); doExtract(type, name); }}
              style={{ fontSize: 11, padding: '2px 8px' }}>
        Extract
      </button>
    );
  };

  const entityRefs = template.includes?.entities || [];

  return (
    <div>
      <button className="btn btn-back" onClick={onBack}>← Back to list</button>

      {/* Overview */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>{template.name} <span className="version-badge">v{template.version}</span></h2>
        <p className="hint">{template.description}</p>
        {extractMsg && <div className="success-banner" style={{ margin: '8px 0', fontSize: 13 }}>{extractMsg}</div>}
        {(template.agents.length > 0 || (template.skills?.length ?? 0) > 0 || template.autopilots.length > 0) && (
          <button className="btn btn-small" onClick={extractAll} style={{ marginTop: 8, fontSize: 12 }}>
            🔄 Extract all as entities
          </button>
        )}
        <div className="result-summary" style={{ marginTop: 12 }}>
          <div className="result-stat ok"><span className="stat-num">{template.agents.length}</span><span className="stat-label">Agents</span></div>
          <div className="result-stat ok"><span className="stat-num">{template.skills?.length || 0}</span><span className="stat-label">Skills</span></div>
          <div className="result-stat ok"><span className="stat-num">{entityRefs.length}</span><span className="stat-label">Entity Refs</span></div>
          <div className="result-stat ok"><span className="stat-num">{template.projects.length}</span><span className="stat-label">Projects</span></div>
          <div className="result-stat ok"><span className="stat-num">{template.labels.length}</span><span className="stat-label">Labels</span></div>
          <div className="result-stat ok"><span className="stat-num">{template.autopilots.length}</span><span className="stat-label">Autopilots</span></div>
        </div>
      </div>

      {/* Entity References section (tables of all entities with source column) */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Agents</h2>
        <p className="hint">{template.agents.length} entities</p>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Model</th>
              <th>Runtime</th>
              <th>Skills</th>
              <th>Env</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {template.agents.map((a) => (
              <AgentRow key={a.name} agent={a} extractBtn={extractBtn('agent', a.name)} source={'inline'} />
            ))}
          </tbody>
        </table>
        {entityRefs.filter((e: any) => e.ref.startsWith('agent/')).length > 0 && (
          <>
            <p className="hint" style={{ marginTop: 12 }}>Entity references (resolved at import):</p>
            {entityRefs.filter((e: any) => e.ref.startsWith('agent/')).map((e: any, idx: number) => (
              <div key={`ref-agent-${idx}`} className="dry-item" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 4, fontSize: 12 }}>
                <span className="version-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: 10 }}>REF</span>
                <code>{e.ref}</code>
                {e.overrides && <span className="version-badge" style={{ fontSize: 10 }}>overrides</span>}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Skills */}
      {(template.skills?.length || 0) > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Skills</h2>
          <p className="hint">{template.skills!.length} inline skills</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {template.skills!.map((s) => (
              <SkillCard key={s.name} skill={s} extractBtn={extractBtn('skill', s.name)} source="inline" />
            ))}
          </div>
        </div>
      )}
      {entityRefs.filter((e: any) => e.ref.startsWith('skill/')).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Skills (from entity refs)</h2>
          <p className="hint">Resolved at import.</p>
          {entityRefs.filter((e: any) => e.ref.startsWith('skill/')).map((e: any, idx: number) => (
            <div key={`ref-skill-${idx}`} className="dry-item" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 4, fontSize: 12 }}>
              <span className="version-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: 10 }}>REF</span>
              <code>{e.ref}</code>
            </div>
          ))}
        </div>
      )}

      {/* Autopilots */}
      {template.autopilots.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Autopilots</h2>
          {template.autopilots.map((ap) => (
            <div key={ap.title} className="dry-item" style={{ display: 'block', padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{ap.title} <span className="version-badge" style={{ fontSize: 10 }}>inline</span></strong>
                {extractBtn('autopilot', ap.title)}
              </div>
              <span className="reason" style={{ fontSize: 11 }}>→ {ap.agent_ref} · {ap.mode}</span>
              {ap.triggers && ap.triggers.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {ap.triggers.map((t, i) => (
                    <span key={i} className="dry-item" style={{ fontSize: 10, padding: '2px 6px', background: 'transparent', border: 'none' }}>
                      ⏱ {t.cron} ({t.timezone}){t.label ? ` — ${t.label}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {entityRefs.filter((e: any) => e.ref.startsWith('autopilot/')).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Autopilots (from entity refs)</h2>
          {entityRefs.filter((e: any) => e.ref.startsWith('autopilot/')).map((e: any, idx: number) => (
            <div key={`ref-ap-${idx}`} className="dry-item" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 4, fontSize: 12 }}>
              <span className="version-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: 10 }}>REF</span>
              <code>{e.ref}</code>
            </div>
          ))}
        </div>
      )}

      {/* Projects */}
      {template.projects.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Projects</h2>
          {template.projects.map((p) => (
            <div key={p.title} className="skill-card" style={{ marginBottom: 8 }}>
              <strong>{p.title}</strong>
              <span className="badge" style={{ marginLeft: 8, fontSize: 10 }}>{p.status}</span>
              {p.description && <span className="reason" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>{p.description}</span>}
              {p.resources && p.resources.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Resources</div>
                  <div className="dry-run-items">
                    {p.resources.map((r: any, i: number) => (
                      <span key={i} className="dry-item" style={{ fontSize: 11, borderLeftColor: 'var(--accent)', borderLeftWidth: 2 }}>
                        {r.resource_type === 'github_repo' ? '🔗' : '📎'} {r.resource_ref.url || r.resource_type}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Labels */}
      {template.labels.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Labels</h2>
          <div className="dry-run-items">
            {template.labels.map((l) => (
              <span key={l.name} className="dry-item" style={{ borderLeftColor: l.color, borderLeftWidth: 3 }}>
                {l.name}
                <span className="reason">{l.color}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <button className="btn btn-back" onClick={onBack}>← Back to list</button>
    </div>
  );
}

function SkillCard({ skill, extractBtn, source }: { skill: NonNullable<TemplateDetail['skills']>[number]; extractBtn: React.ReactNode; source?: string }) {
  const [showFiles, setShowFiles] = useState(false);
  const hasFiles = skill.files && skill.files.length > 0;
  const hasConfig = skill.config && Object.keys(skill.config).length > 0;

  return (
    <div className="skill-card">
      <div className="skill-card-header">
        <div>
          <strong>{skill.name}</strong>
          {source === 'inline' && <span className="version-badge" style={{ marginLeft: 6 }}>inline</span>}
          <span className="reason" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>{skill.description}</span>
        </div>
        <div>{extractBtn}</div>
      </div>
      {hasConfig && (
        <div style={{ marginTop: 8 }}>
          <code className="config-code">{JSON.stringify(skill.config, null, 2)}</code>
        </div>
      )}
      {hasFiles && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-small" onClick={() => setShowFiles(!showFiles)}>
            {showFiles ? 'Hide' : 'Show'} {skill.files!.length} file{skill.files!.length > 1 ? 's' : ''}
          </button>
          {showFiles && (
            <div style={{ marginTop: 6 }}>
              {skill.files!.map((f) => (
                <div key={f.path} className="file-block">
                  <div className="file-path">{f.path}</div>
                  <pre className="file-content">{f.content.slice(0, 500)}{f.content.length > 500 ? '...' : ''}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent, extractBtn, source }: { agent: TemplateDetail['agents'][number]; extractBtn: React.ReactNode; source?: string }) {
  const [expanded, setExpanded] = useState(false);
  const envKeys = agent.custom_env_template ? Object.keys(agent.custom_env_template) : [];

  return (
    <>
      <tr className="agent-row" onClick={() => setExpanded(!expanded)}>
        <td><strong>{agent.name}</strong></td>
        <td><code>{agent.model || '—'}</code></td>
        <td><span className="badge-provider">{agent.runtime_provider}</span></td>
        <td>{agent.skills?.length ? <span className="badge">{agent.skills.length}</span> : '—'}</td>
        <td>{envKeys.length > 0 ? <span className="badge">{envKeys.length}</span> : '—'}</td>
        <td>{source === 'inline'
          ? <span className="version-badge" style={{ fontSize: 10 }}>inline</span>
          : <span className="version-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: 10 }}>REF</span>}</td>
        <td onClick={(e) => e.stopPropagation()}>{extractBtn}</td>
      </tr>
      {expanded && (
        <tr className="agent-detail-row">
          <td colSpan={7}>
            <div className="agent-detail">
              {agent.skills && agent.skills.length > 0 && (
                <div className="detail-section">
                  <h4>Skills</h4>
                  <div className="dry-run-items">
                    {agent.skills.map((s) => (
                      <span key={s} className="dry-item" style={{ fontSize: 11 }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {envKeys.length > 0 && (
                <div className="detail-section">
                  <h4>Environment Variables</h4>
                  <div className="dry-run-items">
                    {envKeys.map((k) => (
                      <span key={k} className="dry-item" style={{ fontSize: 11 }}>{k}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
