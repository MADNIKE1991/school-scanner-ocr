import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { processOCR, extractLinks } from '../services/ocrService.ts';
import { logMessage } from '../services/logger.ts';

export const ocrRouter = Router();

// POST /api/ocr
ocrRouter.post('/ocr', async (req: Request, res: Response) => {
  try {
    const { fileName, lang = 'rus+eng', customText } = req.body;

    if (!fileName) {
      return res.status(400).json({ success: false, error: 'Параметр fileName обязателен' });
    }

    const scansDir = path.resolve(process.cwd(), 'scans');
    let targetPath = path.join(scansDir, fileName);

    // Also check output dir if needed
    if (!fs.existsSync(targetPath)) {
      const outputDir = path.resolve(process.cwd(), 'output');
      const outPath = path.join(outputDir, fileName);
      if (fs.existsSync(outPath)) {
        targetPath = outPath;
      } else {
        return res.status(404).json({ success: false, error: `Файл скана не найден: ${fileName}` });
      }
    }

    const ocrResult = await processOCR(targetPath, lang);

    res.json({
      success: true,
      data: ocrResult,
    });
  } catch (err: any) {
    logMessage('ERROR', 'Ошибка выполнения OCR: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ocr/parse-links
// Client-side helper to quickly parse URLs / emails when user edits text in textarea
ocrRouter.post('/ocr/parse-links', (req: Request, res: Response) => {
  const { text } = req.body;
  const links = extractLinks(text || '');
  res.json({ success: true, links });
});
