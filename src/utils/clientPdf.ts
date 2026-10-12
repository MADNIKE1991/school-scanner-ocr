import { PDFDocument, StandardFonts, PDFString } from 'pdf-lib';

export interface ClientPdfPage {
  imageUrl: string;
  ocrWords?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  links?: Array<{ url: string; type: 'url' | 'email'; bbox?: { x0: number; y0: number; x1: number; y1: number } }>;
}

export async function exportSearchablePdfClient(pages: ClientPdfPage[], title = 'Школьный Searchable PDF'): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setProducer('School Scanner OCR');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const page of pages) {
    // Fetch image data from URL or base64
    const response = await fetch(page.imageUrl);
    const imageBytes = await response.arrayBuffer();

    let embeddedImg;
    try {
      embeddedImg = await pdfDoc.embedPng(imageBytes);
    } catch {
      try {
        embeddedImg = await pdfDoc.embedJpg(imageBytes);
      } catch (err) {
        console.error('Failed to embed image:', err);
      }
    }

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);

    if (embeddedImg) {
      pdfPage.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight
      });
    }

    const imgW = 1240;
    const imgH = 1754;
    const scaleX = pageWidth / imgW;
    const scaleY = pageHeight / imgH;

    // Invisible text layer for searchability and text selection
    if (page.ocrWords && page.ocrWords.length > 0) {
      for (const w of page.ocrWords) {
        if (!w.text || !w.bbox) continue;

        const pdfX = w.bbox.x0 * scaleX;
        const pdfY = pageHeight - w.bbox.y1 * scaleY;
        const fontSize = Math.max(7, Math.min(22, (w.bbox.y1 - w.bbox.y0) * scaleY * 0.85));

        try {
          const ascii = w.text.replace(/[^\x20-\x7E]/g, ' ');
          if (ascii.trim()) {
            pdfPage.drawText(ascii, {
              x: pdfX,
              y: pdfY,
              size: fontSize,
              font,
              opacity: 0
            });
          }
        } catch {}
      }
    }

    // Clickable link annotations
    if (page.links && page.links.length > 0) {
      for (const link of page.links) {
        const x0 = (link.bbox?.x0 || 60) * scaleX;
        const y0 = pageHeight - (link.bbox?.y1 || 300) * scaleY;
        const x1 = Math.max(x0 + 60, (link.bbox?.x1 || 240) * scaleX);
        const y1 = pageHeight - (link.bbox?.y0 || 285) * scaleY;

        const targetUrl = link.type === 'email' && !link.url.startsWith('mailto:')
          ? `mailto:${link.url}`
          : link.url;

        try {
          const linkAnnot = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [x0, y0, x1, y1],
            Border: [0, 0, 0],
            A: {
              Type: 'Action',
              S: 'URI',
              URI: PDFString.of(targetUrl)
            }
          });
          pdfPage.node.addAnnot(pdfDoc.context.register(linkAnnot));
        } catch {}
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}
