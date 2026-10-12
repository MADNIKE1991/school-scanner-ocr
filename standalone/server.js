/**
 * Локальный сервер Kyocera Scanner OCR
 * Стек: Node.js (CommonJS), Express, tesseract.js, docx, pdf-lib
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const scanRoutes = require('./routes/scan');
const ocrRoutes = require('./routes/ocr');
const exportRoutes = require('./routes/export');
const { logMessage } = require('./services/wiaService');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация необходимых папок
const DIRS = ['scans', 'output', 'logs', 'tessdata'];
DIRS.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS & Chrome Private Network Access for Vercel
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

// Статические файлы фронтенда
app.use(express.static(path.join(__dirname, 'public')));
app.use('/scans', express.static(path.join(__dirname, 'scans')));
app.use('/output', express.static(path.join(__dirname, 'output')));

// Маршруты API
app.use('/api', scanRoutes);
app.use('/api', ocrRoutes);
app.use('/api', exportRoutes);

// Запуск сервера
app.listen(PORT, () => {
  const msg = `Сервер Kyocera Scanner запущен: http://localhost:${PORT}`;
  console.log(msg);
  logMessage('INFO', msg);
});
