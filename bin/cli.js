#!/usr/bin/env node
import 'tsx/esm';

const { startServer } = await import('../src/server.js');

const PORT = parseInt(process.env.PORT || '3456', 10);
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const isElectron = args.includes('--electron');

async function main() {
  const { port } = await startServer(PORT, isDev);

  if (isElectron) {
    const { createWindow } = await import('../src/electron/app.js');
    createWindow(port, isDev);
  } else {
    console.log(`\n  🌐  Open http://localhost:${port} in your browser`);
    console.log(`  🖥️  Or run with --electron for desktop mode`);
    console.log(`  📂  User templates: ~/.multica-templates/\n`);

    try {
      const { default: open } = await import('open');
      await open(`http://localhost:${port}`);
    } catch {
      // Browser auto-open failed (e.g. headless server). URL already printed above.
    }
  }
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
