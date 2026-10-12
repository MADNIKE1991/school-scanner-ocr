/**
 * Сервис оптического распознавания текста (OCR) на базе tesseract.js (офлайн)
 */

const { createWorker } = require('tesseract.js');
const path = require('path');
const { logMessage } = require('./wiaService');

// Регулярные выражения для поиска ссылок и e-mail
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>"'()[\]{},;:]+/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;

function extractLinks(text, words = []) {
  const links = [];
  const visited = new Set();

  const urlMatches = text.match(URL_REGEX) || [];
  for (const m of urlMatches) {
    let clean = m.trim().replace(/[.,;:)]$/, '');
    if (!clean.startsWith('http') && clean.startsWith('www.')) clean = `https://${clean}`;
    if (!visited.has(clean)) {
      visited.add(clean);
      const wMatch = words.find(w => w.text && (w.text.includes(m) || m.includes(w.text)));
      links.push({ url: clean, type: 'url', bbox: wMatch ? wMatch.bbox : null });
    }
  }

  const emailMatches = text.match(EMAIL_REGEX) || [];
  for (const m of emailMatches) {
    const clean = m.trim().replace(/[.,;:)]$/, '');
    if (!visited.has(clean)) {
      visited.add(clean);
      const wMatch = words.find(w => w.text && (w.text.includes(m) || m.includes(w.text)));
      links.push({ url: clean, type: 'email', bbox: wMatch ? wMatch.bbox : null });
    }
  }

  return links;
}

async function runOCR(filePath, lang = 'rus+eng', onProgress) {
  logMessage('INFO', `Запуск OCR для файла: ${path.basename(filePath)} (язык: ${lang})`);

  let workerLang = 'rus+eng';
  if (lang === 'rus') workerLang = 'rus';
  if (lang === 'eng') workerLang = 'eng';

  const worker = await createWorker(workerLang, 1, {
    cachePath: path.join(__dirname, '..', 'tessdata'),
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round((m.progress || 0) * 100));
      }
    }
  });

  const { data } = await worker.recognize(filePath);
  await worker.terminate();

  const words = (data.words || []).map(w => ({
    text: w.text.trim(),
    confidence: Math.round(w.confidence || 0),
    bbox: {
      x0: w.bbox.x0,
      y0: w.bbox.y0,
      x1: w.bbox.x1,
      y1: w.bbox.y1
    }
  })).filter(w => w.text.length > 0);

  const lines = (data.lines || []).map(l => ({
    text: l.text.trim(),
    bbox: {
      x0: l.bbox.x0,
      y0: l.bbox.y0,
      x1: l.bbox.x1,
      y1: l.bbox.y1
    }
  }));

  const links = extractLinks(data.text, words);

  logMessage('INFO', `OCR завершен: слов=${words.length}, ссылок=${links.length}`);

  return {
    text: data.text,
    words,
    lines,
    links,
    confidence: Math.round(data.confidence || 0),
    imageWidth: 1240,
    imageHeight: 1754
  };
}

module.exports = {
  runOCR,
  extractLinks
};
