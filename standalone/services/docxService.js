/**
 * Сервис экспорта распознанного текста в формат Microsoft Word (DOCX)
 * с созданием реальных кликабельных ссылок (ExternalHyperlink).
 */

const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel } = require('docx');
const fs = require('fs');
const path = require('path');
const { logMessage } = require('./wiaService');

async function exportDocx(text, title = 'Документ Kyocera OCR') {
  const outputDir = path.join(__dirname, '..', 'output');
  const fileName = `doc_${Date.now()}.docx`;
  const filePath = path.join(outputDir, fileName);

  logMessage('INFO', `Генерация DOCX: ${fileName}`);

  const lines = text.split('\n');
  const paragraphs = [];

  // Заголовок
  paragraphs.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 }
    })
  );

  const combinedRegex = /(https?:\/\/[^\s<>"'()[\]{},;:]+|www\.[^\s<>"'()[\]{},;:]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

  for (const line of lines) {
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    const children = [];
    let lastIdx = 0;
    let match;

    while ((match = combinedRegex.exec(line)) !== null) {
      const matchText = match[0];
      const matchStart = match.index;

      if (matchStart > lastIdx) {
        children.push(
          new TextRun({
            text: line.substring(lastIdx, matchStart),
            font: 'Calibri',
            size: 22
          })
        );
      }

      const isEmail = matchText.includes('@') && !matchText.startsWith('http');
      let linkUrl = matchText;
      if (isEmail) linkUrl = `mailto:${matchText}`;
      else if (!matchText.startsWith('http')) linkUrl = `https://${matchText}`;

      // Реальная гиперссылка в DOCX
      children.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: matchText,
              style: 'Hyperlink',
              color: '2563EB',
              underline: {},
              font: 'Calibri',
              size: 22
            })
          ],
          link: linkUrl
        })
      );

      lastIdx = matchStart + matchText.length;
    }

    if (lastIdx < line.length) {
      children.push(
        new TextRun({
          text: line.substring(lastIdx),
          font: 'Calibri',
          size: 22
        })
      );
    }

    paragraphs.push(
      new Paragraph({
        children,
        spacing: { after: 140 }
      })
    );
  }

  const doc = new Document({
    creator: 'Kyocera Scanner Desktop',
    title: title,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
          }
        },
        children: paragraphs
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  logMessage('INFO', `DOCX сохранен: ${fileName}`);

  return { fileName, filePath };
}

module.exports = {
  exportDocx
};
