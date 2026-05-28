import { useState, useEffect, useCallback, useRef } from 'react';
import type { useApi, ServerProfile } from '../hooks/useApi.js';

interface Props {
  api: ReturnType<typeof useApi>;
  onServersChanged?: () => void;
}

export function SettingsView({ api, onServersChanged }: Props) {
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [current, setCurrent] = useState<ServerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({ name: '', server_url: '', app_url: '', token: '' });

  const apiRef = useRef(api);
  apiRef.current = api;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRef.current.fetchServers();
      setServers(data.servers);
      setCurrent(data.current);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const doAdd = async () => {
    if (!form.server_url || !form.token) {
      setError('Server URL and API Token are required');
      return;
    }
    setError(null);
    try {
      await api.addServer(form);
      setForm({ name: '', server_url: '', app_url: '', token: '' });
      setAdding(false);
      setMsg('Server added');
      await refresh();
      onServersChanged?.();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doRemove = async (id: string) => {
    if (!confirm('Remove this server?')) return;
    setError(null);
    try {
      await api.removeServer(id);
      setMsg('Server removed');
      await refresh();
      onServersChanged?.();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doSwitch = async (id: string) => {
    setSwitching(id);
    setError(null);
    setMsg(null);
    try {
      await api.switchServer(id);
      setMsg('Switched — refreshing...');
      await api.fetchWorkspaces();
      await refresh();
      onServersChanged?.();
      setMsg('Switched successfully');
    } catch (e: any) {
      setError(e.message);
    }
    setSwitching(null);
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      {msg && <div className="success-banner">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Connected Servers</h2>
        <p className="hint">Manage your Multica server connections. Switch between servers to work with different instances.</p>

        {servers.length === 0 && !adding && (
          <div className="empty-state">
            <p>No servers configured.</p>
            <p className="hint">Add a server to get started.</p>
          </div>
        )}

        <div className="ws-list">
          {servers.map((s) => (
            <div key={s.id} className={`ws-card ${s.is_default ? 'server-active' : ''}`} style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>{s.name}</strong>
                {current?.id === s.id && <span className="badge" style={{ background: 'var(--green)', fontSize: 10 }}>active</span>}
                {s.is_default && !(current?.id === s.id) && <span className="badge" style={{ fontSize: 10 }}>default</span>}
              </div>
              <code style={{ fontSize: 11, color: 'var(--text2)' }}>{s.server_url}</code>
              <div style={{ display: 'flex', gap: 6 }}>
                {current?.id !== s.id && (
                  <button className="btn-small" onClick={() => doSwitch(s.id)} disabled={switching === s.id}>
                    {switching === s.id ? 'Switching...' : 'Switch'}
                  </button>
                )}
                <button className="btn-small" onClick={() => doRemove(s.id)} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        {!adding && (
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>
            + Add Server
          </button>
        )}
      </div>

      {adding && (
        <div className="card">
          <h2>Add Server</h2>
          <p className="hint">Connect to a Multica server instance. You can find the API token in the Multica web UI under Settings → API Keys.</p>

          <div className="form-field">
            <label>Display Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Production, Staging" />
          </div>
          <div className="form-field">
            <label>Server URL *</label>
            <input value={form.server_url} onChange={(e) => setForm({ ...form, server_url: e.target.value })} placeholder="http://localhost:8081" />
          </div>
          <div className="form-field">
            <label>App URL (optional)</label>
            <input value={form.app_url} onChange={(e) => setForm({ ...form, app_url: e.target.value })} placeholder="http://localhost:3002" />
          </div>
          <div className="form-field">
            <label>API Token *</label>
            <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="mul_..." />
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={doAdd}>Save Server</button>
          </div>
        </div>
      )}

      <SecretsPanel api={api} />
    </div>
  );
}

function SecretsPanel({ api }: { api: ReturnType<typeof useApi> }) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const apiRef = useRef(api);
  apiRef.current = api;

  const refresh = useCallback(async () => {
    try {
      const s = await apiRef.current.fetchSecrets();
      setSecrets(s);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addSecret = async () => {
    if (!newKey.trim()) return;
    setError(null);
    try {
      await api.setSecret(newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
      setMsg('Secret saved');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeSecret = async (key: string) => {
    if (!confirm(`Delete secret "${key}"?`)) return;
    setError(null);
    try {
      await api.deleteSecret(key);
      setMsg('Secret deleted');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading) return null;

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h2>Global Secrets</h2>
      <p className="hint">Store API keys, tokens and other secrets locally. When importing a template, matching variable names are auto-filled.</p>

      {msg && <div className="success-banner">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}

      {Object.keys(secrets).length > 0 ? (
        <table className="runtime-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {Object.entries(secrets).map(([key, value]) => (
              <tr key={key}>
                <td><code>{key}</code></td>
                <td><code style={{ fontSize: 11, color: 'var(--text2)' }}>{value.substring(0, 20)}{value.length > 20 ? '...' : ''}</code></td>
                <td>
                  <button className="btn-small" onClick={() => removeSecret(key)} style={{ borderColor: 'var(--red)', color: 'var(--red)', fontSize: 10 }}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty-state"><p>No secrets stored yet.</p></div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          className="env-input"
          style={{ flex: 1, padding: '6px 10px' }}
          placeholder="VAR_NAME"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addSecret()}
        />
        <input
          className="env-input"
          style={{ flex: 2, padding: '6px 10px' }}
          type="password"
          placeholder="secret value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addSecret()}
        />
        <button className="btn btn-primary" onClick={addSecret}>Add</button>
      </div>
    </div>
  );
}
