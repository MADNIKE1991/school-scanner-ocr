import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { listDevices, executeScan } from '../services/wiaService.ts';
import { logMessage } from '../services/logger.ts';

export const scanRouter = Router();

// Configure multer for file uploads (drag-and-drop or file pick)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const scansDir = path.resolve(process.cwd(), 'scans');
    if (!fs.existsSync(scansDir)) {
      fs.mkdirSync(scansDir, { recursive: true });
    }
    cb(null, scansDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e4);
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `upload_${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
});

// GET /api/devices
scanRouter.get('/devices', async (req: Request, res: Response) => {
  try {
    const result = await listDevices();
    res.json({
      success: true,
      devices: result.devices,
      naps2Found: result.naps2Found,
      binaryPath: result.binaryPath,
      systemPlatform: process.platform,
    });
  } catch (err: any) {
    logMessage('ERROR', 'Ошибка получения устройств: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/scan
scanRouter.post('/scan', async (req: Request, res: Response) => {
  try {
    const { deviceName, dpi, colorMode, pageSize, duplex, source } = req.body;
    const scanResult = await executeScan({
      deviceName,
      dpi: dpi ? parseInt(dpi, 10) : 300,
      colorMode: colorMode || 'color',
      pageSize: pageSize || 'a4',
      duplex: Boolean(duplex),
      source: source || 'flatbed',
    });

    res.json({
      success: true,
      file: scanResult.fileName,
      filePath: scanResult.filePath,
      isSimulated: scanResult.isSimulated,
      metadata: scanResult.metadata,
      previewUrl: `/api/download/${scanResult.fileName}`,
    });
  } catch (err: any) {
    logMessage('ERROR', 'Ошибка процесса сканирования: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/upload
scanRouter.post('/upload', upload.single('scanFile'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не передан' });
    }

    logMessage('INFO', `Пользователь загрузил документ для OCR: ${req.file.filename} (${req.file.size} байт)`);

    res.json({
      success: true,
      file: req.file.filename,
      filePath: req.file.path,
      size: req.file.size,
      originalName: req.file.originalname,
      previewUrl: `/api/download/${req.file.filename}`,
    });
  } catch (err: any) {
    logMessage('ERROR', 'Ошибка загрузки файла: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
