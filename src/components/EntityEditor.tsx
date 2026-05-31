import { useState } from 'react';

interface Props {
  entity: any;
  onSave: (updated: any) => Promise<void>;
  onCancel: () => void;
}

type EditorTab = 'general' | 'instructions' | 'files';

export function EntityEditor({ entity, onSave, onCancel }: Props) {
  const [form, setForm] = useState<any>(() => JSON.parse(JSON.stringify(entity)));
  const [tab, setTab] = useState<EditorTab>('general');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const skillEntries = form.skills ? Object.entries(form.skills) as [string, string][] : [];
  const envEntries = form.custom_env_template ? Object.entries(form.custom_env_template) as [string, string][] : [];
  const argList: string[] = form.custom_args || [];
  const fileList: any[] = form.files || [];
  const triggerList: any[] = form.triggers || [];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="nav-btn" onClick={onCancel}>{'◀'} Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save as new version'}
          </button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <h2 style={{ marginBottom: 4 }}>
        {entity.entity === 'agent' ? '🤖' : entity.entity === 'skill' ? '🛠️' : '⏰'} {entity.name}
        <span className="version-badge" style={{ marginLeft: 8 }}>v{entity.version}</span>
      </h2>
      <p className="hint" style={{ marginBottom: 20 }}>Editing will create a new version. The original remains unchanged.</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        {(['general', ...(entity.entity === 'agent' ? ['instructions' as const] : []), ...(entity.entity !== 'autopilot' ? ['files' as const] : [])] as EditorTab[]).map((t) => (
          <button key={t} className={`nav-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralTab entity={entity} form={form} update={update}
        skillEntries={skillEntries} envEntries={envEntries} argList={argList}
        fileList={fileList} triggerList={triggerList} />}

      {tab === 'instructions' && entity.entity === 'agent' && (
        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 6, fontWeight: 600 }}>Instructions</label>
          <textarea value={form.instructions || ''}
            onChange={(e) => update('instructions', e.target.value)}
            style={{ width: '100%', minHeight: 400, fontFamily: 'monospace', fontSize: 13,
              background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 16, lineHeight: 1.6, resize: 'vertical' }} />
        </div>
      )}

      {tab === 'files' && (entity.entity !== 'autopilot') && (
        <FilesEditor files={form.files || []} onFilesChange={(files: any[]) => update('files', files)} />
      )}
    </div>
  );
}

// ── General Tab ──

function GeneralTab({ entity, form, update, skillEntries, envEntries, argList, fileList, triggerList }: any) {
  return (
    <div>
      {/* Common fields */}
      <Field label="Description">
        <textarea value={form.description || ''} onChange={(e) => update('description', e.target.value)}
          style={{ width: '100%', minHeight: 60, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }} />
      </Field>

      {entity.entity === 'agent' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <Field label="Model">
              <select value={form.model || 'auto'} onChange={(e) => update('model', e.target.value)}
                className="form-select">
                {['auto', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-4o', 'gpt-4o-mini'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Runtime Provider">
              <select value={form.runtime_provider || 'claude'} onChange={(e) => update('runtime_provider', e.target.value)}
                className="form-select">
                {['claude', 'cursor', 'codex', 'opencode', 'openclaw', 'hermes'].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Visibility">
              <select value={form.visibility || 'private'} onChange={(e) => update('visibility', e.target.value)}
                className="form-select">
                <option value="private">private</option>
                <option value="workspace">workspace</option>
                <option value="public">public</option>
              </select>
            </Field>
            <Field label="Max Concurrent Tasks">
              <input type="number" min={1} max={100} value={form.max_concurrent_tasks ?? 6}
                onChange={(e) => update('max_concurrent_tasks', parseInt(e.target.value, 10) || 6)}
                className="form-input" />
            </Field>
          </div>

          {/* Skills */}
          <Section title={`Skills (${skillEntries.length})`}>
            {skillEntries.length === 0 && <p className="hint">No skills configured.</p>}
            {skillEntries.map(([name, constraint]: [string, string]) => (
              <TagRow key={name} label={name} value={constraint} onRemove={() => {
                const { [name]: _, ...rest } = form.skills;
                update('skills', rest);
              }} />
            ))}
            <AddRowButton label="Add skill" onClick={() => {
              const name = prompt('Skill name:');
              if (name) update('skills', { ...(form.skills || {}), [name.trim()]: '^1.0.0' });
            }} />
          </Section>

          {/* Environment Variables */}
          <Section title={`Environment Variables (${envEntries.length})`}>
            {envEntries.length === 0 && <p className="hint">No env vars configured.</p>}
            {envEntries.map(([key, val]: [string, string]) => (
              <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input value={key} onChange={(e) => {
                  const { [key]: _, ...rest } = form.custom_env_template;
                  update('custom_env_template', { ...rest, [e.target.value]: val });
                }} className="form-input" style={{ width: 200, fontFamily: 'monospace', fontSize: 12 }} />
                <span style={{ color: 'var(--text2)' }}>=</span>
                <input value={val} onChange={(e) => update('custom_env_template', { ...form.custom_env_template, [key]: e.target.value })}
                  className="form-input" style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                <button className="btn-small" onClick={() => {
                  const { [key]: _, ...rest } = form.custom_env_template;
                  update('custom_env_template', rest);
                }} style={{ color: 'var(--red)' }}>✕</button>
              </div>
            ))}
            <AddRowButton label="Add env var" onClick={() => {
              const key = prompt('Variable name:');
              if (key) update('custom_env_template', { ...(form.custom_env_template || {}), [key.trim()]: `\${${key.trim()}}` });
            }} />
          </Section>

          {/* Custom Args */}
          <Section title={`Custom Args (${argList.length})`}>
            {argList.length === 0 && <p className="hint">No custom args.</p>}
            {argList.map((arg: string, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input value={arg} onChange={(e) => {
                  const next = [...argList];
                  next[i] = e.target.value;
                  update('custom_args', next);
                }} className="form-input" style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                <button className="btn-small" onClick={() => update('custom_args', argList.filter((_: any, j: number) => j !== i))}
                  style={{ color: 'var(--red)' }}>✕</button>
              </div>
            ))}
            <AddRowButton label="Add arg" onClick={() => update('custom_args', [...argList, '--new-arg'])} />
          </Section>
        </>
      )}

      {entity.entity === 'skill' && (
        <Field label="Config">
          <textarea value={form.config ? JSON.stringify(form.config, null, 2) : ''}
            onChange={(e) => {
              try { update('config', JSON.parse(e.target.value)); } catch { update('config', e.target.value); }
            }}
            style={{ width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: 12,
              background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, resize: 'vertical' }} />
        </Field>
      )}

      {entity.entity === 'autopilot' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <Field label="Title">
            <input value={form.title || ''} onChange={(e) => update('title', e.target.value)} className="form-input" />
          </Field>
          <Field label="Mode">
            <select value={form.mode || 'run_only'} onChange={(e) => update('mode', e.target.value)} className="form-select">
              <option value="run_only">run_only</option>
              <option value="create_issue">create_issue</option>
            </select>
          </Field>
          <Field label="Agent Reference">
            <input value={form.agent_ref || ''} onChange={(e) => update('agent_ref', e.target.value)}
              className="form-input" style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Field>
        </div>
      )}

      {/* Triggers (autopilot) */}
      {entity.entity === 'autopilot' && (
        <Section title={`Triggers (${triggerList.length})`}>
          {triggerList.length === 0 && <p className="hint">No triggers configured.</p>}
          {triggerList.map((t: any, i: number) => (
            <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 2 }}>Cron</label>
                  <input value={t.cron || ''} onChange={(e) => {
                    const next = [...triggerList];
                    next[i] = { ...next[i], cron: e.target.value };
                    update('triggers', next);
                  }} className="form-input" style={{ fontFamily: 'monospace', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 2 }}>Timezone</label>
                  <input value={t.timezone || ''} onChange={(e) => {
                    const next = [...triggerList];
                    next[i] = { ...next[i], timezone: e.target.value };
                    update('triggers', next);
                  }} className="form-input" style={{ fontSize: 12 }} />
                </div>
                <button className="btn-small" onClick={() => update('triggers', triggerList.filter((_: any, j: number) => j !== i))}
                  style={{ color: 'var(--red)', marginTop: 16 }}>✕</button>
              </div>
              <div style={{ marginTop: 6 }}>
                <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 2 }}>Label (optional)</label>
                <input value={t.label || ''} onChange={(e) => {
                  const next = [...triggerList];
                  next[i] = { ...next[i], label: e.target.value };
                  update('triggers', next);
                }} className="form-input" style={{ fontSize: 12 }} />
              </div>
            </div>
          ))}
          <AddRowButton label="Add trigger" onClick={() => update('triggers', [...triggerList, { cron: '0 9 * * 1-5', timezone: 'Asia/Shanghai' }])} />
        </Section>
      )}
    </div>
  );
}

// ── Files Editor ──

function FilesEditor({ files, onFilesChange }: { files: any[]; onFilesChange: (f: any[]) => void }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const updateFile = (i: number, field: string, value: any) => {
    const next = [...files];
    next[i] = { ...next[i], [field]: value };
    onFilesChange(next);
  };

  return (
    <div>
      <h3 style={{ fontSize: 13, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>
        Files ({files.length})
      </h3>
      {files.length === 0 && <p className="hint">No files.</p>}
      {files.map((f, i) => (
        <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: expanded[i] ? '1px solid var(--border)' : 'none' }}>
            <input value={f.path || ''} onChange={(e) => updateFile(i, 'path', e.target.value)}
              className="form-input" style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
            <button className="btn-small" onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}>
              {expanded[i] ? 'Collapse' : 'Edit'}
            </button>
            <button className="btn-small" onClick={() => onFilesChange(files.filter((_, j) => j !== i))}
              style={{ color: 'var(--red)' }}>✕</button>
          </div>
          {expanded[i] && (
            <textarea value={f.content || ''} onChange={(e) => updateFile(i, 'content', e.target.value)}
              style={{ width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 12,
                background: 'var(--bg)', color: 'var(--text)', border: 'none', padding: 12,
                lineHeight: 1.5, resize: 'vertical' }} />
          )}
        </div>
      ))}
      <button className="btn btn-small" onClick={() => onFilesChange([...files, { path: 'SKILL.md', content: '# New skill\n\n' }])}
        style={{ marginTop: 4 }}>+ Add file</button>
    </div>
  );
}

// ── Reusable UI Primitives ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 5, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20, paddingTop: 4 }}>
      <h3 style={{ fontSize: 13, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{title}</h3>
      {children}
    </div>
  );
}

function TagRow({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', marginRight: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span className="version-badge">{value}</span>
      <button className="btn-small" onClick={onRemove} style={{ color: 'var(--red)', padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>✕</button>
    </div>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn btn-small" onClick={onClick} style={{ marginTop: 4 }}>
      + {label}
    </button>
  );
}
