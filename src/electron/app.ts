import { BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createWindow(port: number, isDev: boolean) {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Multica Template Manager',
    show: false,
  });

  const url = isDev
    ? `http://localhost:${port}`
    : `http://localhost:${port}`;

  win.loadURL(url);
  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => {
    process.exit(0);
  });
}
