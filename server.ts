import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { scanRouter } from './routes/scan.ts';
import { ocrRouter } from './routes/ocr.ts';
import { exportRouter } from './routes/export.ts';
import { findNaps2Binary } from './services/wiaService.ts';
import { logMessage } from './services/logger.ts';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Ensure directories exist
  ['scans', 'output', 'logs', 'tessdata'].forEach(dirName => {
    const dir = path.resolve(process.cwd(), dirName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  logMessage('INFO', 'Запуск Kyocera Scanner OCR Desktop сервиса...');

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CORS & Chrome Private Network Access for Vercel cloud frontend to talk to local scanner
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // API Routes
  app.use('/api', scanRouter);
  app.use('/api', ocrRouter);
  app.use('/api', exportRouter);

  // System Diagnostics
  app.get('/api/system-status', async (req, res) => {
    const naps2Path = await findNaps2Binary();
    res.json({
      status: 'online',
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      naps2Available: Boolean(naps2Path),
      naps2Path: naps2Path || 'Not found in PATH or standard Program Files',
      kxDriverHint: 'Для МФУ Kyocera установите официальный KX Driver (v8.x+) с поддержкой WIA 2.0',
      storage: {
        scansDir: path.resolve(process.cwd(), 'scans'),
        outputDir: path.resolve(process.cwd(), 'output'),
        logsDir: path.resolve(process.cwd(), 'logs'),
      },
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logMessage('INFO', `Сервер Kyocera Scanner запущен на http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
