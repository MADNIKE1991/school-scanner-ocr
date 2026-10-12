import * as pdfjsLib from 'pdfjs-dist';
// Use locally bundled worker via Vite URL import for 100% offline and reliable PDF rendering
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/**
 * Рендерит страницы PDF в растровые изображения (PNG) для OCR и предпросмотра
 */
export async function renderPdfToImages(fileOrBuffer: File | ArrayBuffer): Promise<string[]> {
  try {
    const arrayBuffer = fileOrBuffer instanceof File ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
      cMapPacked: true,
    });

    const pdf = await loadingTask.promise;
    const images: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      // Масштаб 2.0 (примерно 200–300 DPI) для четкого распознавания символов в Tesseract
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const context = canvas.getContext('2d');
      if (context) {
        // Белый фон под страницей
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext as any).promise;
        images.push(canvas.toDataURL('image/png'));
      }
    }

    return images;
  } catch (err: any) {
    console.error('Ошибка рендеринга PDF:', err);
    throw new Error(`Не удалось открыть PDF: ${err.message}`);
  }
}
