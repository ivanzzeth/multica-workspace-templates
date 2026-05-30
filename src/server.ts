import express from 'express';
import type { ViteDevServer } from 'vite';
import { createServer as createViteServer } from 'vite';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createExpressApp(isDev: boolean) {
  const app = express();
  app.use(express.json());

  // Mount API routes BEFORE Vite — must catch all /api/* before SPA fallback
  const apiRouter = await createApiRouter();
  app.use('/api', apiRouter);

  // API error handler: ensure API errors never leak to Vite's SPA fallback
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err.message || err);
    res.status(500).json({ error: 'Internal server error' });
  });

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const clientDir = resolve(__dirname, '../dist/client');
    app.use(express.static(clientDir));
    // SPA fallback — only for non-API routes
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      const indexPath = join(clientDir, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(200).send('<html><body><h1>Build not found. Run `npm run build` first.</h1></body></html>');
      }
    });
  }

  return app;
}

export async function startServer(port: number, isDev: boolean, host: string = 'localhost') {
  const app = await createExpressApp(isDev);

  return new Promise<{ app: express.Application; port: number }>((resolve) => {
    const server = app.listen(port, host, () => {
      const addr = server.address() as any;
      console.log(`Server running at http://${addr.address}:${addr.port}`);
      resolve({ app, port: addr.port });
    });
  });
}
