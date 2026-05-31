import { useState, useCallback, useRef, useEffect } from 'react';
import type { useApi, EntitySummary } from '../hooks/useApi.js';
import { EntityEditor } from './EntityEditor.js';

interface Props {
  api: ReturnType<typeof useApi>;
}

type Tab = 'all' | 'skill' | 'agent' | 'autopilot';

const TAB_OPTIONS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'agent', label: 'Agents' },
  { key: 'skill', label: 'Skills' },
  { key: 'autopilot', label: 'Autopilots' },
];

const TYPE_ICONS: Record<string, string> = { skill: '\u{1F6E0}', agent: '\u{1F916}', autopilot: '\u{23F0}' };

export function EntityBrowser({ api }: Props) {
  const [tab, setTab] = useState<Tab>('all');
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ entity: any; type: string; name: string; version: string } | null>(null);
  const [search, setSearch] = useState('');

  const apiRef = useRef(api);
  apiRef.current = api;

  const loadEntities = useCallback(async (t?: Tab, q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const filter: Record<string, string> = {};
      if (t && t !== 'all') filter.type = t;
      if (q) filter.q = q;
      const ents = await apiRef.current.fetchEntities(filter);
      setEntities(ents);
      setLoaded(true);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    setDetail(null);
    loadEntities(t, search);
  }, [search, loadEntities]);

  const doSearch = useCallback((q: string) => {
    setSearch(q);
    loadEntities(tab === 'all' ? undefined : tab, q);
  }, [tab, loadEntities]);

  const openDetail = useCallback(async (type: string, name: string, version?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRef.current.fetchEntity(type, name, version);
      setDetail({ entity: data.entity, type, name, version: data.entity.version || version || '' });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { loadEntities(); }, []);

  if (detail) {
    return <EntityDetail
      api={api}
      entity={detail.entity}
      type={detail.type}
      name={detail.name}
      currentVersion={detail.version}
      allVersions={entities.filter((e) => e.type === detail.type && e.name === detail.name)}
      onBack={() => { setDetail(null); setError(null); }}
      onSwitchVersion={(v) => openDetail(detail.type, detail.name, v)}
    />;
  }

  // Group entities by (type, name) — one card per entity
  const grouped = new Map<string, { latest: EntitySummary; versionCount: number }>();
  for (const e of entities) {
    const key = `${e.type}/${e.name}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.versionCount++;
      if (semverGt(e.version, existing.latest.version)) existing.latest = e;
    } else {
      grouped.set(key, { latest: e, versionCount: 1 });
    }
  }
  const displayList = Array.from(grouped.values()).sort((a, b) => a.latest.name.localeCompare(b.latest.name));
  const filteredList = search
    ? displayList.filter((g) => g.latest.name.toLowerCase().includes(search.toLowerCase()))
    : displayList;

  return (
    <div className="wizard">
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Entity Browser</h2>
        <p className="hint">Browse and manage reusable entities (agents, skills, autopilots).</p>
        {error && <div className="error-banner">{error}</div>}

        <EntityImporter api={api} onImported={() => loadEntities(tab === 'all' ? undefined : tab, search)} />

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {TAB_OPTIONS.map((t) => (
            <button key={t.key} className={`nav-btn ${tab === t.key ? 'active' : ''}`} onClick={() => switchTab(t.key)}>
              {t.label} {displayList.length > 0 && `(${displayList.length})`}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <input className="input" placeholder="Search entities..." value={search}
            onChange={(e) => doSearch(e.target.value)} style={{ width: '100%' }} />
        </div>

        {loading && <div className="spinner" />}

        {!loading && filteredList.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <p className="hint">No entities found.</p>
          </div>
        )}

        {filteredList.map(({ latest: e, versionCount: n }) => (
          <button key={`${e.type}/${e.name}`} className="template-card"
            onClick={() => openDetail(e.type, e.name, e.version)}
            style={{ width: '100%', textAlign: 'left' }}>
            <strong>
              {TYPE_ICONS[e.type] || '\u{1F4E6}'} {e.name}
              <span className="version-badge" style={{ marginLeft: 6 }}>v{e.version}</span>
              {n > 1 && <span className="version-badge" style={{ background: 'var(--accent)', color: '#fff', marginLeft: 4 }}>{n} versions</span>}
              <span className="source-badge" style={{ marginLeft: 4 }}>{e.source === 'local' ? 'local' : 'remote'}</span>
            </strong>
            <span className="desc">{e.description || e.ref}</span>
            <span className="badges">
              <span className="tag">{e.type}</span>
              {e.deps_info && <span className="tag">{e.deps_info}</span>}
              {e.tags?.slice(0, 3).map((t: string) => <span key={t} className="tag dim">{t}</span>)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EntityDetail({ api, entity, type, name, currentVersion, allVersions, onBack, onSwitchVersion }: {
  api: ReturnType<typeof useApi>;
  entity: any;
  type: string;
  name: string;
  currentVersion: string;
  allVersions: EntitySummary[];
  onBack: () => void;
  onSwitchVersion: (v: string) => void;
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editResult, setEditResult] = useState<string | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  const doDelete = async () => {
    try { await api.deleteEntity(type, entity.name, entity.version, entity.namespace || 'multica'); onBack(); }
    catch (e: any) { alert(e.message); }
  };

  const startEdit = () => { setEditing(true); setEditResult(null); };

  const saveEdit = async (updated: any) => {
    setEditResult(null);
    try {
      const curRef = `${entity.entity}/${entity.name}@${entity.version}`;
      const forkResult = await api.forkEntity(curRef, 'patch');
      updated.version = forkResult.entry.ref.split('@').pop();
      const result = await api.importEntity(JSON.stringify(updated));
      if (result.ok) {
        setEditResult(`✅ Saved as new version: ${result.entry.ref}`);
        setTimeout(() => { setEditing(false); onBack(); }, 2000);
      }
    } catch (e: any) { setEditResult(`❌ ${e.message}`); }
  };

  if (editing) {
    return <EntityEditor entity={entity} onSave={saveEdit} onCancel={() => { setEditing(false); setEditResult(null); }} />;
  }

  // Collect versions sorted for the switcher
  const sortedVersions = [...allVersions].sort((a, b) => semverGt(a.version, b.version) ? -1 : 1);
  const versionNames = sortedVersions.map((v) => v.version);
  if (!versionNames.includes(currentVersion) && !sortedVersions.find((v) => v.version === currentVersion)) {
    versionNames.push(currentVersion);
  }

  return (
    <div className="card">
      <button className="nav-btn" onClick={onBack} style={{ marginBottom: 16 }}>{'◀'} Back to Entity Browser</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>{TYPE_ICONS[type] || ''} {name}</h2>
      </div>

      {/* Version switcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>Version:</span>
        <select value={currentVersion} onChange={(e) => onSwitchVersion(e.target.value)}
          disabled={loadingVersion}
          style={{ padding: '4px 8px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
          {versionNames.map((v) => (
            <option key={v} value={v}>
              v{v} {v === sortedVersions[0]?.version ? '(latest)' : ''}
            </option>
          ))}
        </select>
        {loadingVersion && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
      </div>

      <p className="hint" style={{ marginBottom: 16 }}>{entity.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
        {type === 'agent' && (
          <>
            <div><strong>Model:</strong> {entity.model}</div>
            <div><strong>Runtime:</strong> {entity.runtime_provider}</div>
            <div><strong>Visibility:</strong> {entity.visibility || 'private'}</div>
            {entity.max_concurrent_tasks && <div><strong>Max Tasks:</strong> {entity.max_concurrent_tasks}</div>}
          </>
        )}
        {type === 'autopilot' && (
          <>
            <div><strong>Mode:</strong> {entity.mode}</div>
            <div><strong>Agent:</strong> {entity.agent_ref}</div>
            {entity.triggers && <div><strong>Triggers:</strong> {entity.triggers.length}</div>}
          </>
        )}
        {entity.metadata?.tags && <div><strong>Tags:</strong> {entity.metadata.tags.join(', ')}</div>}
      </div>

      {type === 'agent' && entity.skills && Object.keys(entity.skills).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3>Skills ({Object.keys(entity.skills).length})</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(entity.skills).map(([sn, sv]: [string, any]) => (
              <span key={sn} className="tag" style={{ fontSize: 13 }}>{sn}@{sv}</span>
            ))}
          </div>
        </div>
      )}

      {(type === 'skill' || type === 'agent') && (
        <div style={{ marginBottom: 20 }}>
          <h3>Files</h3>
          {entity.files ? entity.files.map((f: any) => (
            <div key={f.path} className="card" style={{ marginTop: 8, padding: 12 }}>
              <strong>{f.path}</strong>
              <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, marginTop: 8, padding: 8, borderRadius: 4 }}>
                {(f.content || '').slice(0, 2000)}
                {(f.content || '').length > 2000 && '\n... (truncated)'}
              </pre>
            </div>
          )) : <p className="hint">No files</p>}
        </div>
      )}

      {type === 'agent' && entity.instructions && (
        <div style={{ marginBottom: 20 }}>
          <h3>Instructions</h3>
          <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: 12, padding: 12, borderRadius: 4, whiteSpace: 'pre-wrap' }}>
            {(entity.instructions || '').slice(0, 5000)}
            {(entity.instructions || '').length > 5000 && '\n... (truncated)'}
          </pre>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-small" onClick={startEdit}>Edit</button>
        {deleteConfirm ? (
          <>
            <span style={{ color: '#ef4444', fontSize: 14 }}>Delete this version?</span>
            <button className="nav-btn" onClick={doDelete} style={{ background: '#ef4444', color: '#fff' }}>Yes, delete</button>
            <button className="nav-btn" onClick={() => setDeleteConfirm(false)}>Cancel</button>
          </>
        ) : (
          <button className="nav-btn" onClick={() => setDeleteConfirm(true)} style={{ color: '#ef4444' }}>Delete</button>
        )}
      </div>
    </div>
  );
}

/** Simple semver comparison (a > b returns true). */
function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// ── Entity Importer (validate + import inline) ──

function EntityImporter({ api, onImported }: { api: ReturnType<typeof useApi>; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const doValidate = async () => {
    if (!yaml.trim()) return;
    setResult(null);
    try {
      const v = await api.validateEntity(yaml);
      if (v.valid) { setResult(`✅ Valid ${v.entity_type} entity — ready to import.`); }
      else { setResult('❌ Validation failed:\n' + v.issues.map((i) => `  ${i.severity === 'error' ? '🔴' : '🟡'} [${i.field}] ${i.message}`).join('\n')); }
    } catch (e: any) { setResult(`❌ ${e.message}`); }
  };

  const doImport = async () => {
    if (!yaml.trim()) return;
    setImporting(true); setResult(null);
    try {
      const r = await api.importEntity(yaml);
      if (r.ok) { setResult(`✅ Imported: ${r.entry.ref}`); setYaml(''); setTimeout(() => { setOpen(false); onImported(); }, 1500); }
    } catch (e: any) { setResult(`❌ ${e.message}`); }
    setImporting(false);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button className="btn btn-small" onClick={() => setOpen(!open)} style={{ marginBottom: open ? 8 : 0 }}>
        {open ? '− Close' : '+ Import Entity'}
      </button>
      {open && (
        <div className="card" style={{ padding: 16 }}>
          <p className="hint" style={{ marginBottom: 8 }}>Paste entity YAML. Validate first, then import.</p>
          <textarea value={yaml} onChange={(e) => setYaml(e.target.value)}
            placeholder="entity: skill&#10;schema_version: '1.0'&#10;name: my-skill&#10;version: 1.0.0"
            style={{ width: '100%', minHeight: 150, fontFamily: 'monospace', fontSize: 12, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-small" onClick={doValidate}>Validate</button>
            <button className="btn btn-small" onClick={doImport} disabled={importing || !yaml.trim()}>{importing ? 'Importing...' : 'Import'}</button>
          </div>
          {result && <pre style={{ marginTop: 8, fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{result}</pre>}
        </div>
      )}
    </div>
  );
}
