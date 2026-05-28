import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi, ServerProfile } from './hooks/useApi.js';
import { ImportWizard } from './components/ImportWizard.js';
import { ExportForm } from './components/ExportForm.js';
import { TemplatesView } from './components/TemplatesView.js';
import { SettingsView } from './components/SettingsView.js';
import './styles/app.css';

type Page = 'import' | 'export' | 'templates' | 'settings';

export default function App() {
  const api = useApi();
  const [page, setPage] = useState<Page>('import');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [currentServer, setCurrentServer] = useState<ServerProfile | null>(null);
  const [switching, setSwitching] = useState(false);

  const apiRef = useRef(api);
  apiRef.current = api;

  const loadInitial = useCallback(async () => {
    try {
      const a = apiRef.current;
      const [srvData] = await Promise.all([
        a.fetchServers(),
        a.fetchWorkspaces(),
        a.fetchTemplates(),
      ]);
      setServers(srvData.servers);
      setCurrentServer(srvData.current);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadInitial().then(() => setReady(true)).catch((e) => setError(e.message));
  }, [loadInitial]);

  const doSwitchServer = async (id: string) => {
    setSwitching(true);
    try {
      const a = apiRef.current;
      await a.switchServer(id);
      await a.fetchWorkspaces();
      const data = await a.fetchServers();
      setServers(data.servers);
      setCurrentServer(data.current);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
    setSwitching(false);
  };

  const refreshServers = useCallback(async () => {
    const data = await apiRef.current.fetchServers();
    setServers(data.servers);
    setCurrentServer(data.current);
  }, []);

  if (!ready) {
    return (
      <div className="app">
        <header className="header">
          <h1>Multica Template Manager</h1>
        </header>
        <main className="main loading">{error ? <div className="error-banner">Error: {error}</div> : <div className="spinner" />}</main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Multica Template Manager</h1>
        <nav className="nav">
          <button className={`nav-btn ${page === 'templates' ? 'active' : ''}`} onClick={() => setPage('templates')}>
            Templates
          </button>
          <button className={`nav-btn ${page === 'import' ? 'active' : ''}`} onClick={() => setPage('import')}>
            Import
          </button>
          <button className={`nav-btn ${page === 'export' ? 'active' : ''}`} onClick={() => setPage('export')}>
            Export
          </button>
          <button className={`nav-btn ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
            Settings
          </button>
        </nav>
        <div className="server-selector">
          {currentServer && (
            <select
              className="server-select"
              value={currentServer.id}
              onChange={(e) => doSwitchServer(e.target.value)}
              disabled={switching}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.server_url}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>
      <main className="main">
        {error && <div className="error-banner">{error}</div>}
        {page === 'templates' && <TemplatesView api={api} />}
        {page === 'import' && <ImportWizard api={api} />}
        {page === 'export' && <ExportForm api={api} />}
        {page === 'settings' && <SettingsView api={api} onServersChanged={refreshServers} />}
      </main>
    </div>
  );
}
