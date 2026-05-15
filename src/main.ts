import { startServer } from './server.js';

const PORT = parseInt(process.env.PORT || '8422', 10);
const HOST = process.env.HOST || '0.0.0.0';
const isDev = process.argv.includes('--dev');
const isElectron = process.argv.includes('--electron');

async function main() {
  const { port } = await startServer(PORT, isDev, HOST);

  if (isElectron) {
    const { createWindow } = await import('./electron/app.js');
    createWindow(port, isDev);
  } else {
    const url = HOST === '0.0.0.0' ? `http://localhost:${port}` : `http://${HOST}:${port}`;
    console.log(`\n  🌐  Open ${url} in your browser`);
    console.log(`  🖥️  Or run with --electron for desktop mode\n`);
  }
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
