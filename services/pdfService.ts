import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray, PDFDict } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { logMessage } from './logger.ts';
import { OCRResult, OCRWord, DetectedLink, extractLinks } from './ocrService.ts';

export interface PageExportData {
  imagePath: string;
  ocrResult?: OCRResult;
  customText?: string;
}

export interface PdfExportOptions {
  pages: PageExportData[];
  title?: string;
  author?: string;
  outputFileName?: string;
}

export async function generateSearchablePdf(options: PdfExportOptions): Promise<{
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
}> {
  const outputDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const fileName = options.outputFileName || `kyocera_scan_${timestamp}.pdf`;
  const filePath = path.join(outputDir, fileName);

  logMessage('INFO', `Генерация Searchable PDF (${options.pages.length} стр.): ${fileName}`);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(options.title || 'Документ сканирования Kyocera KX Searchable PDF');
  pdfDoc.setAuthor(options.author || 'Kyocera WIA/TWAIN OCR');
  pdfDoc.setProducer('Kyocera Scanner Desktop Service');
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let pageIdx = 0; pageIdx < options.pages.length; pageIdx++) {
    const pageData = options.pages[pageIdx];
    const imagePath = pageData.imagePath;

    if (!fs.existsSync(imagePath)) {
      logMessage('WARN', `Файл изображения не найден: ${imagePath}`);
      continue;
    }

    const imageBytes = fs.readFileSync(imagePath);
    let embeddedImage;
    const ext = path.extname(imagePath).toLowerCase();

    try {
      if (ext === '.jpg' || ext === '.jpeg') {
        embeddedImage = await pdfDoc.embedJpg(imageBytes);
      } else {
        // PNG or other raster
        embeddedImage = await pdfDoc.embedPng(imageBytes);
      }
    } catch (err: any) {
      logMessage('WARN', `Сбой встраивания растрового изображения: ${err.message}. Создание страницы документа.`);
    }

    // A4 Standard Dimensions: 595.28 x 841.89 points
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 1. Draw scanned document image as background
    if (embeddedImage) {
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    } else {
      // Clean fallback background
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        color: rgb(0.98, 0.98, 0.98),
      });
    }

    // 2. Invisible Searchable Text Layer
    // We map words from OCR coordinates to PDF points
    const ocr = pageData.ocrResult;
    const imgW = ocr?.imageWidth || 1240;
    const imgH = ocr?.imageHeight || 1754;

    const scaleX = pageWidth / imgW;
    const scaleY = pageHeight / imgH;

    if (ocr && ocr.words && ocr.words.length > 0) {
      for (const word of ocr.words) {
        if (!word.text || !word.bbox) continue;

        // Convert image coordinate (top-left 0,0) to PDF coordinate (bottom-left 0,0)
        const pdfX = word.bbox.x0 * scaleX;
        const pdfY = pageHeight - word.bbox.y1 * scaleY;
        const wordHeight = (word.bbox.y1 - word.bbox.y0) * scaleY;
        const fontSize = Math.max(7, Math.min(24, wordHeight * 0.85));

        try {
          // Render mode: invisible text (opacity: 0)
          // In PDF viewers (Adobe, Chrome, Edge), this creates selectable, searchable text
          // that matches exactly what the eye sees on the scan image.
          // Note: sanitize text to ASCII / standard latin or basic characters if standard Helvetica
          const safeText = sanitizeForStandardFont(word.text);
          if (safeText.length > 0) {
            page.drawText(safeText, {
              x: pdfX,
              y: pdfY,
              size: fontSize,
              font,
              opacity: 0, // invisible text layer
            });
          }
        } catch {
          // fallback if symbol not in Helvetica font
        }
      }
    }

    // 3. Clickable Link Annotations
    // For every detected URL or email address, create a real clickable PDF Link Annotation!
    const links: DetectedLink[] = ocr?.links || [];

    // Also check page custom text for any updated links
    if (pageData.customText) {
      const extraLinks = extractLinks(pageData.customText, ocr?.words || []);
      for (const el of extraLinks) {
        if (!links.some(l => l.url === el.url)) {
          links.push(el);
        }
      }
    }

    for (let lIdx = 0; lIdx < links.length; lIdx++) {
      const link = links[lIdx];
      let rect: [number, number, number, number];

      if (link.bbox) {
        const x0 = link.bbox.x0 * scaleX;
        const y0 = pageHeight - link.bbox.y1 * scaleY;
        const x1 = Math.max(x0 + 60, link.bbox.x1 * scaleX);
        const y1 = pageHeight - link.bbox.y0 * scaleY;
        rect = [x0, y0, x1, y1];
      } else {
        // Fallback positioning in lower quadrant if bbox was approximate
        const yOffset = 300 - lIdx * 25;
        rect = [40, yOffset, 300, yOffset + 15];
      }

      const targetUrl = link.type === 'email' && !link.url.startsWith('mailto:')
        ? `mailto:${link.url}`
        : link.url;

      try {
        const linkAnnotation = pdfDoc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: rect,
          Border: [0, 0, 0], // Invisible border box
          H: 'I', // Invert highlight when clicked
          A: {
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(targetUrl),
          },
        });

        const annotRef = pdfDoc.context.register(linkAnnotation);
        page.node.addAnnot(annotRef);
      } catch (err: any) {
        logMessage('WARN', `Ошибка добавления ссылки в PDF [${targetUrl}]: ${err.message}`);
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, pdfBytes);
  const fileSize = fs.statSync(filePath).size;

  logMessage('INFO', `Searchable PDF успешно создан: ${filePath} (${fileSize} байт, ${pdfDoc.getPageCount()} стр.)`);

  return {
    success: true,
    filePath,
    fileName,
    fileSize,
    pageCount: pdfDoc.getPageCount(),
  };
}

// Replaces non-printable or Cyrillic characters with phonetic or placeholder
// so Standard Helvetica doesn't throw encoding errors in pdf-lib
function sanitizeForStandardFont(text: string): string {
  // Helvetica only supports WinAnsi / Latin1.
  // We transliterate or keep characters in 32..255 range so invisible selection still captures length
  return text.split('').map(ch => {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) return ch;
    // Basic cyrillic transliteration for clipboard extraction
    if (CYRILLIC_MAP[ch]) return CYRILLIC_MAP[ch];
    return ' ';
  }).join('');
}

const CYRILLIC_MAP: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'E', 'Ж': 'Zh',
  'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
  'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts',
  'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu',
  'Я': 'Ya'
};
