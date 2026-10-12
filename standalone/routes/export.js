const express = require('express');
const path = require('path');
const fs = require('fs');
const { exportDocx } = require('../services/docxService');
const { exportSearchablePdf } = require('../services/pdfService');

const router = express.Router();

router.post('/export/docx', async (req, res) => {
  try {
    const { text, title } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'Текст пуст' });

    const result = await exportDocx(text, title);
    res.json({ success: true, fileName: result.fileName, downloadUrl: `/api/download/${result.fileName}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/export/pdf', async (req, res) => {
  try {
    const { pages, title } = req.body;
    if (!pages || !pages.length) return res.status(400).json({ success: false, error: 'Нет страниц' });

    const resolved = pages.map(p => ({
      imagePath: path.join(__dirname, '..', 'scans', path.basename(p.imagePath)),
      ocrResult: p.ocrResult
    }));

    const result = await exportSearchablePdf(resolved, title);
    res.json({ success: true, fileName: result.fileName, downloadUrl: `/api/download/${result.fileName}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/download/:file', (req, res) => {
  const fileName = path.basename(req.params.file);
  const outDir = path.join(__dirname, '..', 'output');
  const scanDir = path.join(__dirname, '..', 'scans');

  let fp = path.join(outDir, fileName);
  if (!fs.existsSync(fp)) fp = path.join(scanDir, fileName);

  if (!fs.existsSync(fp)) return res.status(404).send('Файл не найден');
  res.download(fp, fileName);
});

module.exports = router;
