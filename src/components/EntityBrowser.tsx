import { useState, useCallback, useRef } from 'react';
import type { useApi, EntitySummary } from '../hooks/useApi.js';

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
  const [detail, setDetail] = useState<any>(null);
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
    } catch (e: any) {
      setError(e.message);
    }
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

  const openDetail = useCallback(async (ref: string) => {
    setLoading(true);
    try {
      const parts = ref.split('/');
      const type = parts[parts.length - 1].split('@')[0] === 'skill' || parts.includes('skill') ? 'skill'
        : parts.includes('agent') ? 'agent' : 'autopilot';
      const namePart = ref.split('/').pop() || '';
      const name = namePart.split('@')[0];
      const version = namePart.includes('@') ? namePart.split('@')[1] : undefined;
      const data = await apiRef.current.fetchEntity(type, name, version);
      setDetail(data);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  // Load on mount
  if (!loaded) loadEntities();

  if (detail) {
    return <EntityDetail entity={detail.entity} refStr={detail.ref} onBack={() => { setDetail(null); setError(null); }} api={api} />;
  }

  const filtered = search
    ? entities.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()) || e.description?.toLowerCase().includes(search.toLowerCase()))
    : entities;

  return (
    <div className="wizard">
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Entity Browser</h2>
        <p className="hint">Browse and manage reusable entities (agents, skills, autopilots).</p>
        {error && <div className="error-banner">{error}</div>}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {TAB_OPTIONS.map((t) => (
            <button key={t.key} className={`nav-btn ${tab === t.key ? 'active' : ''}`} onClick={() => switchTab(t.key)}>
              {t.label} {tab === t.key && entities.length > 0 && `(${entities.length})`}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <input
            className="input"
            placeholder="Search entities..."
            value={search}
            onChange={(e) => doSearch(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        {loading && <div className="spinner" />}

        {!loading && filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <p className="hint">No entities found. Import entity YAML files or export a workspace in reference mode to populate entities.</p>
          </div>
        )}

        {filtered.map((e) => (
          <button key={e.ref} className="template-card" onClick={() => openDetail(e.ref)} style={{ width: '100%', textAlign: 'left' }}>
            <strong>{TYPE_ICONS[e.type] || '\u{1F4E6}'} {e.name} <span className="version-badge">v{e.version}</span> <span className="source-badge">{e.source === 'local' ? 'local' : 'remote'}</span></strong>
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

function EntityDetail({ entity, refStr, onBack, api }: { entity: any; refStr: string; onBack: () => void; api: ReturnType<typeof useApi> }) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const doDelete = async () => {
    try {
      await api.deleteEntity(
        entity.entity,
        entity.name,
        entity.version,
        entity.namespace || 'multica'
      );
      onBack();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="card">
      <button className="nav-btn" onClick={onBack} style={{ marginBottom: 16 }}>{'◀'} Back to Entity Browser</button>

      <h2>{TYPE_ICONS[entity.entity] || ''} {entity.name} <span className="version-badge">v{entity.version}</span></h2>
      <p className="hint" style={{ marginBottom: 16 }}>{entity.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
        {entity.entity === 'agent' && (
          <>
            <div><strong>Model:</strong> {entity.model}</div>
            <div><strong>Runtime:</strong> {entity.runtime_provider}</div>
            <div><strong>Visibility:</strong> {entity.visibility || 'private'}</div>
            {entity.max_concurrent_tasks && <div><strong>Max Tasks:</strong> {entity.max_concurrent_tasks}</div>}
          </>
        )}
        {entity.entity === 'autopilot' && (
          <>
            <div><strong>Mode:</strong> {entity.mode}</div>
            <div><strong>Agent:</strong> {entity.agent_ref}</div>
            {entity.triggers && <div><strong>Triggers:</strong> {entity.triggers.length}</div>}
          </>
        )}
        {entity.metadata?.tags && (
          <div><strong>Tags:</strong> {entity.metadata.tags.join(', ')}</div>
        )}
      </div>

      {entity.entity === 'agent' && entity.skills && Object.keys(entity.skills).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3>Skills ({Object.keys(entity.skills).length})</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(entity.skills).map(([name, version]: [string, any]) => (
              <span key={name} className="tag" style={{ fontSize: 13 }}>{name}@{version}</span>
            ))}
          </div>
        </div>
      )}

      {(entity.entity === 'skill' || entity.entity === 'agent') && (
        <div style={{ marginBottom: 20 }}>
          <h3>Files</h3>
          {entity.files ? (
            entity.files.map((f: any) => (
              <div key={f.path} className="card" style={{ marginTop: 8, padding: 12 }}>
                <strong>{f.path}</strong>
                <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, marginTop: 8, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                  {(f.content || '').slice(0, 2000)}
                  {(f.content || '').length > 2000 && '\n... (truncated)'}
                </pre>
              </div>
            ))
          ) : (
            <p className="hint">No files</p>
          )}
        </div>
      )}

      {entity.entity === 'agent' && entity.instructions && (
        <div style={{ marginBottom: 20 }}>
          <h3>Instructions</h3>
          <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 4, whiteSpace: 'pre-wrap' }}>
            {(entity.instructions || '').slice(0, 5000)}
            {(entity.instructions || '').length > 5000 && '\n... (truncated)'}
          </pre>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {deleteConfirm ? (
          <>
            <span style={{ color: '#ef4444', fontSize: 14 }}>Confirm delete?</span>
            <button className="nav-btn" onClick={doDelete} style={{ background: '#ef4444', color: '#fff' }}>Yes, delete</button>
            <button className="nav-btn" onClick={() => setDeleteConfirm(false)}>Cancel</button>
          </>
        ) : (
          <button className="nav-btn" onClick={() => setDeleteConfirm(true)} style={{ color: '#ef4444' }}>Delete Entity</button>
        )}
      </div>
    </div>
  );
}
