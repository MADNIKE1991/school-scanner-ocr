const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDevices, scan } = require('../services/wiaService');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'scans');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `upload_${Date.now()}${path.extname(file.originalname) || '.png'}`);
  }
});
const upload = multer({ storage });

router.get('/devices', async (req, res) => {
  try {
    const devices = await getDevices();
    res.json({ success: true, devices });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const result = await scan(req.body);
    res.json({ success: true, file: result.fileName });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/upload', upload.single('scanFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Файл не выбран' });
  res.json({ success: true, file: req.file.filename });
});

module.exports = router;
