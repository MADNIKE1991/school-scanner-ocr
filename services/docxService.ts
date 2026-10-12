import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType } from 'docx';
import fs from 'fs';
import path from 'path';
import { logMessage } from './logger.ts';
import { URL_REGEX, EMAIL_REGEX } from './ocrService.ts';

export interface DocxExportOptions {
  text: string;
  title?: string;
  author?: string;
  outputFileName?: string;
}

export async function generateDocx(options: DocxExportOptions): Promise<{
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
}> {
  const outputDir = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const fileName = options.outputFileName || `kyocera_doc_${timestamp}.docx`;
  const filePath = path.join(outputDir, fileName);

  logMessage('INFO', `Генерация документа Microsoft Word (DOCX): ${fileName}`);

  const lines = options.text.split('\n');
  const paragraphs: Paragraph[] = [];

  // Title header
  paragraphs.push(
    new Paragraph({
      text: options.title || 'Документ сканирования Kyocera KX (WIA/OCR)',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  // Subtitle with date
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Сформировано локальным сервисом Kyocera OCR • ${new Date().toLocaleString('ru-RU')}`,
          italics: true,
          color: '666666',
          size: 20, // 10pt
        }),
      ],
      spacing: { after: 300 },
    })
  );

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    // Process line segments to separate plain text from URLs and Emails
    const children: (TextRun | ExternalHyperlink)[] = [];
    const combinedRegex = /(https?:\/\/[^\s<>"'()[\]{},;:]+|www\.[^\s<>"'()[\]{},;:]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = combinedRegex.exec(line)) !== null) {
      const matchText = match[0];
      const matchStart = match.index;

      // Plain text before match
      if (matchStart > lastIndex) {
        children.push(
          new TextRun({
            text: line.substring(lastIndex, matchStart),
            font: 'Calibri',
            size: 22, // 11pt
          })
        );
      }

      // Check if match is email or web URL
      const isEmail = matchText.includes('@') && !matchText.startsWith('http');
      let linkTarget = matchText;
      if (isEmail) {
        linkTarget = `mailto:${matchText}`;
      } else if (!matchText.startsWith('http')) {
        linkTarget = `https://${matchText}`;
      }

      // Real clickable Hyperlink in DOCX
      children.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: matchText,
              style: 'Hyperlink',
              color: '2563EB',
              underline: {},
              font: 'Calibri',
              size: 22,
            }),
          ],
          link: linkTarget,
        })
      );

      lastIndex = matchStart + matchText.length;
    }

    // Trailing text
    if (lastIndex < line.length) {
      children.push(
        new TextRun({
          text: line.substring(lastIndex),
          font: 'Calibri',
          size: 22,
        })
      );
    }

    // Check if line looks like a section header
    const isHeading =
      trimmed.match(/^[0-9]\.\s+[А-ЯA-Z]/) ||
      trimmed.startsWith('ПРОТОКОЛ') ||
      trimmed.startsWith('АКТ') ||
      trimmed.startsWith('ДОГОВОР');

    paragraphs.push(
      new Paragraph({
        children,
        heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
        spacing: { after: isHeading ? 200 : 140 },
      })
    );
  }

  const doc = new Document({
    creator: options.author || 'Kyocera Scanner OCR',
    title: options.title || 'Документ Kyocera OCR',
    description: 'Локальное распознавание текста с гиперссылками',
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch = 1440 twips (2.54 cm)
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  const fileSize = fs.statSync(filePath).size;

  logMessage('INFO', `DOCX успешно создан: ${filePath} (${fileSize} байт)`);

  return {
    success: true,
    filePath,
    fileName,
    fileSize,
  };
}
