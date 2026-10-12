import { createWorker } from 'tesseract.js';

export interface ClientOCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  links: Array<{
    url: string;
    type: 'url' | 'email';
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>"'()[\]{},;:]+/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;

export async function runClientOcr(
  imageSource: string | HTMLCanvasElement | HTMLImageElement,
  lang: string = 'rus+eng',
  onProgress?: (progress: number, status: string) => void
): Promise<ClientOCRResult> {
  // Map language to Tesseract codes
  let tesseractLang = 'rus+eng';
  if (lang === 'rus') tesseractLang = 'rus';
  if (lang === 'eng') tesseractLang = 'eng';

  if (onProgress) onProgress(10, 'Загрузка модуля OCR в браузере...');

  const worker = await createWorker(tesseractLang, 1, {
    logger: m => {
      if (onProgress && m.status) {
        const pct = Math.round((m.progress || 0) * 100);
        if (m.status === 'loading tesseract core') onProgress(20, 'Загрузка ядра Tesseract...');
        else if (m.status.includes('loading language')) onProgress(40, `Загрузка языковой модели (${tesseractLang})...`);
        else if (m.status === 'recognizing text') onProgress(50 + Math.round(pct * 0.45), `Распознавание символов: ${pct}%`);
      }
    }
  });

  if (onProgress) onProgress(60, 'Сканирование строк и слов документа...');

  const ret = await worker.recognize(imageSource);
  await worker.terminate();

  const pageData = ret.data as any;
  const rawText = pageData.text || '';

  const words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }> = [];

  if (pageData.words && Array.isArray(pageData.words)) {
    for (const w of pageData.words) {
      if (w.text && w.text.trim().length > 0) {
        words.push({
          text: w.text.trim(),
          confidence: Math.round(w.confidence || 0),
          bbox: {
            x0: w.bbox.x0,
            y0: w.bbox.y0,
            x1: w.bbox.x1,
            y1: w.bbox.y1
          }
        });
      }
    }
  }

  // Extract real links from user's scanned text
  const links: Array<{ url: string; type: 'url' | 'email'; bbox?: { x0: number; y0: number; x1: number; y1: number } }> = [];
  const visited = new Set<string>();

  const urlMatches = rawText.match(URL_REGEX) || [];
  for (const m of urlMatches) {
    let clean = m.trim().replace(/[.,;:)]$/, '');
    if (!clean.startsWith('http') && clean.startsWith('www.')) clean = `https://${clean}`;
    if (!visited.has(clean)) {
      visited.add(clean);
      const wMatch = words.find(w => w.text && (w.text.includes(m) || m.includes(w.text)));
      links.push({ url: clean, type: 'url', bbox: wMatch ? wMatch.bbox : undefined });
    }
  }

  const emailMatches = rawText.match(EMAIL_REGEX) || [];
  for (const m of emailMatches) {
    const clean = m.trim().replace(/[.,;:)]$/, '');
    if (!visited.has(clean)) {
      visited.add(clean);
      const wMatch = words.find(w => w.text && (w.text.includes(m) || m.includes(w.text)));
      links.push({ url: clean, type: 'email', bbox: wMatch ? wMatch.bbox : undefined });
    }
  }

  if (onProgress) onProgress(100, 'Готово!');

  return {
    text: rawText,
    confidence: Math.round(pageData.confidence || 0),
    words,
    links
  };
}
