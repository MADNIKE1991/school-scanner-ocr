import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel } from 'docx';

export async function exportDocxClient(text: string, title = 'Школьный документ OCR'): Promise<Blob> {
  const lines = text.split('\n');
  const paragraphs: Paragraph[] = [];

  // Заголовок
  paragraphs.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 }
    })
  );

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Распознано в школьном сканере • ${new Date().toLocaleDateString('ru-RU')}`,
          italics: true,
          color: '666666',
          size: 20
        })
      ],
      spacing: { after: 280 }
    })
  );

  const combinedRegex = /(https?:\/\/[^\s<>"'()[\]{},;:]+|www\.[^\s<>"'()[\]{},;:]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

  for (const line of lines) {
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    const children: (TextRun | ExternalHyperlink)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = combinedRegex.exec(line)) !== null) {
      const matchText = match[0];
      const matchStart = match.index;

      if (matchStart > lastIndex) {
        children.push(
          new TextRun({
            text: line.substring(lastIndex, matchStart),
            font: 'Calibri',
            size: 24 // 12pt
          })
        );
      }

      const isEmail = matchText.includes('@') && !matchText.startsWith('http');
      let linkTarget = matchText;
      if (isEmail) linkTarget = `mailto:${matchText}`;
      else if (!matchText.startsWith('http')) linkTarget = `https://${matchText}`;

      children.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: matchText,
              style: 'Hyperlink',
              color: '2563EB',
              underline: {},
              font: 'Calibri',
              size: 24
            })
          ],
          link: linkTarget
        })
      );

      lastIndex = matchStart + matchText.length;
    }

    if (lastIndex < line.length) {
      children.push(
        new TextRun({
          text: line.substring(lastIndex),
          font: 'Calibri',
          size: 24
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

  return await Packer.toBlob(doc);
}
