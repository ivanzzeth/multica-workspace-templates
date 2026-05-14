import { useState, useEffect } from 'react';
import { useApi } from './hooks/useApi.js';
import { ImportWizard } from './components/ImportWizard.js';
import { ExportForm } from './components/ExportForm.js';
import './styles/app.css';

type Page = 'import' | 'export';

export default function App() {
  const api = useApi();
  const [page, setPage] = useState<Page>('import');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([api.fetchWorkspaces(), api.fetchTemplates()])
      .then(() => setReady(true))
      .catch((e) => setError(e.message));
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
          <button className={`nav-btn ${page === 'import' ? 'active' : ''}`} onClick={() => setPage('import')}>
            Import Template
          </button>
          <button className={`nav-btn ${page === 'export' ? 'active' : ''}`} onClick={() => setPage('export')}>
            Export Workspace
          </button>
        </nav>
      </header>
      <main className="main">
        {error && <div className="error-banner">{error}</div>}
        {page === 'import' && <ImportWizard api={api} />}
        {page === 'export' && <ExportForm api={api} />}
      </main>
    </div>
  );
}
