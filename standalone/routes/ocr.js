const express = require('express');
const path = require('path');
const { runOCR } = require('../services/ocrService');

const router = express.Router();

router.post('/ocr', async (req, res) => {
  try {
    const { fileName, lang = 'rus+eng' } = req.body;
    if (!fileName) return res.status(400).json({ success: false, error: 'Укажите fileName' });

    const filePath = path.join(__dirname, '..', 'scans', fileName);
    const data = await runOCR(filePath, lang);

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
