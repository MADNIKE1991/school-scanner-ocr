/**
 * Сервис создания Searchable PDF:
 * 1. Изображение скана как фон
 * 2. Невидимый текстовый слой (render mode 3 / opacity 0) с точными координатами слов из OCR
 * 3. Кликабельные ссылки через PDF аннотации (Link Annotations с URI Action)
 */

const { PDFDocument, StandardFonts, PDFString } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { logMessage } = require('./wiaService');

async function exportSearchablePdf(pages, title = 'Kyocera Searchable PDF') {
  const outputDir = path.join(__dirname, '..', 'output');
  const fileName = `searchable_${Date.now()}.pdf`;
  const filePath = path.join(outputDir, fileName);

  logMessage('INFO', `Генерация Searchable PDF: ${fileName} (${pages.length} стр.)`);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setProducer('Kyocera Desktop OCR');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < pages.length; i++) {
    const { imagePath, ocrResult } = pages[i];
    if (!fs.existsSync(imagePath)) continue;

    const imgBytes = fs.readFileSync(imagePath);
    let embeddedImg;
    const ext = path.extname(imagePath).toLowerCase();

    if (ext === '.jpg' || ext === '.jpeg') {
      embeddedImg = await pdfDoc.embedJpg(imgBytes);
    } else {
      embeddedImg = await pdfDoc.embedPng(imgBytes);
    }

    // A4 габариты в пунктах (points)
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 1. Отрисовка скана как фона страницы
    page.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight
    });

    const imgW = ocrResult?.imageWidth || 1240;
    const imgH = ocrResult?.imageHeight || 1754;
    const scaleX = pageWidth / imgW;
    const scaleY = pageHeight / imgH;

    // 2. Невидимый слой текста (Searchable)
    if (ocrResult?.words) {
      for (const word of ocrResult.words) {
        if (!word.text || !word.bbox) continue;

        // Перевод координат из графических (верх-лево 0,0) в PDF (низ-лево 0,0)
        const pdfX = word.bbox.x0 * scaleX;
        const pdfY = pageHeight - word.bbox.y1 * scaleY;
        const h = (word.bbox.y1 - word.bbox.y0) * scaleY;
        const fontSize = Math.max(7, Math.min(22, h * 0.85));

        try {
          const cleanText = word.text.replace(/[^\x20-\x7E]/g, ' ');
          if (cleanText.trim()) {
            page.drawText(cleanText, {
              x: pdfX,
              y: pdfY,
              size: fontSize,
              font,
              opacity: 0 // Невидимый слой: текст можно выделять и копировать
            });
          }
        } catch (e) {}
      }
    }

    // 3. Добавление кликабельных ссылок (Link Annotations)
    if (ocrResult?.links) {
      for (const link of ocrResult.links) {
        let rect;
        if (link.bbox) {
          const x0 = link.bbox.x0 * scaleX;
          const y0 = pageHeight - link.bbox.y1 * scaleY;
          const x1 = Math.max(x0 + 50, link.bbox.x1 * scaleX);
          const y1 = pageHeight - link.bbox.y0 * scaleY;
          rect = [x0, y0, x1, y1];
        } else {
          rect = [50, 200, 250, 215];
        }

        const targetUrl = link.type === 'email' && !link.url.startsWith('mailto:')
          ? `mailto:${link.url}`
          : link.url;

        try {
          const annot = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: rect,
            Border: [0, 0, 0],
            A: {
              Type: 'Action',
              S: 'URI',
              URI: PDFString.of(targetUrl)
            }
          });
          const annotRef = pdfDoc.context.register(annot);
          page.node.addAnnot(annotRef);
        } catch (err) {
          logMessage('WARN', `Ошибка создания ссылки в PDF: ${err.message}`);
        }
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, pdfBytes);
  logMessage('INFO', `Searchable PDF сохранен: ${fileName}`);

  return { fileName, filePath };
}

module.exports = {
  exportSearchablePdf
};
