import { startServer } from './server.js';

const PORT = parseInt(process.env.PORT || '3456', 10);
const isDev = process.argv.includes('--dev');
const isElectron = process.argv.includes('--electron');

async function main() {
  const { port } = await startServer(PORT, isDev);

  if (isElectron) {
    const { createWindow } = await import('./electron/app.js');
    createWindow(port, isDev);
  } else {
    console.log(`\n  🌐  Open http://localhost:${port} in your browser`);
    console.log(`  🖥️  Or run with --electron for desktop mode\n`);
  }
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
