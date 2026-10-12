import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { generateDocx } from '../services/docxService.ts';
import { generateSearchablePdf, PageExportData } from '../services/pdfService.ts';
import { logMessage, getLogs } from '../services/logger.ts';

export const exportRouter = Router();

// POST /api/export/docx
exportRouter.post('/export/docx', async (req: Request, res: Response) => {
  try {
    const { text, title, author, outputFileName } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Текст документа не предоставлен' });
    }

    const result = await generateDocx({
      text,
      title: title || 'Акт сканирования Kyocera KX (WIA)',
      author: author || 'Kyocera OCR Desktop',
      outputFileName,
    });

    res.json({
      success: true,
      fileName: result.fileName,
      downloadUrl: `/api/download/${result.fileName}`,
      fileSize: result.fileSize,
    });
  } catch (err: any) {
    logMessage('ERROR', 'Ошибка экспорта в DOCX: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/export/pdf
exportRouter.post('/export/pdf', async (req: Request, res: Response) => {
  try {
    const { pages, title, author, outputFileName } = req.body;

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ success: false, error: 'Список страниц для PDF пуст' });
    }

    // Resolve physical paths for images in ./scans
    const scansDir = path.resolve(process.cwd(), 'scans');
    const resolvedPages: PageExportData[] = pages.map((p: any) => {
      let imgPath = p.imagePath;
      if (!path.isAbsolute(imgPath)) {
        imgPath = path.join(scansDir, path.basename(imgPath));
      }
      return {
        imagePath: imgPath,
        ocrResult: p.ocrResult,
        customText: p.customText,
      };
    });

    const result = await generateSearchablePdf({
      pages: resolvedPages,
      title: title || 'Kyocera Searchable PDF Document',
      author: author || 'Kyocera Scanner Desktop',
      outputFileName,
    });

    res.json({
      success: true,
      fileName: result.fileName,
      downloadUrl: `/api/download/${result.fileName}`,
      fileSize: result.fileSize,
      pageCount: result.pageCount,
    });
  } catch (err: any) {
    logMessage('ERROR', 'Ошибка экспорта в Searchable PDF: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/download/:file
exportRouter.get('/download/:file', (req: Request, res: Response) => {
  try {
    const fileName = path.basename(req.params.file);
    const outputDir = path.resolve(process.cwd(), 'output');
    const scansDir = path.resolve(process.cwd(), 'scans');

    let targetPath = path.join(outputDir, fileName);
    if (!fs.existsSync(targetPath)) {
      targetPath = path.join(scansDir, fileName);
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).send('Файл не найден');
    }

    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (ext === '.docx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else if (ext === '.png') {
      res.setHeader('Content-Type', 'image/png');
    } else if (ext === '.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
    } else if (ext === '.jpg' || ext === '.jpeg') {
      res.setHeader('Content-Type', 'image/jpeg');
    }

    // If query parameter inline=true is passed, serve for inline viewing, otherwise trigger download
    if (req.query.inline !== 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    }

    fs.createReadStream(targetPath).pipe(res);
  } catch (err: any) {
    res.status(500).send('Ошибка скачивания: ' + err.message);
  }
});

// GET /api/files (list of recent outputs and scans)
exportRouter.get('/files', (req: Request, res: Response) => {
  try {
    const outputDir = path.resolve(process.cwd(), 'output');
    const scansDir = path.resolve(process.cwd(), 'scans');

    const getFilesFromDir = (dir: string, category: 'output' | 'scan') => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(f => !f.startsWith('.'))
        .map(f => {
          const fp = path.join(dir, f);
          const stat = fs.statSync(fp);
          return {
            name: f,
            category,
            size: stat.size,
            updatedAt: stat.mtimeMs,
            downloadUrl: `/api/download/${f}`,
          };
        });
    };

    const files = [...getFilesFromDir(outputDir, 'output'), ...getFilesFromDir(scansDir, 'scan')]
      .sort((a, b) => b.updatedAt - a.updatedAt);

    res.json({ success: true, files });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/logs
exportRouter.get('/logs', (req: Request, res: Response) => {
  const lines = getLogs(80);
  res.json({ success: true, logs: lines });
});
