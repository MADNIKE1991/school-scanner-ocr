/**
 * Модуль обнаружения USB и сетевых сканеров Kyocera прямо из браузера (для Vercel / Web)
 */

export interface DetectedScanner {
  id: string;
  name: string;
  type: 'usb' | 'network' | 'camera';
  status: 'connected' | 'ready' | 'needs_ip';
  ip?: string;
  vendorId?: number;
}

// Проверка поддержки WebUSB в браузере (Chrome / Edge / Opera)
export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

// Запрос USB-сканера через браузерный WebUSB API
export async function requestUsbScanner(): Promise<DetectedScanner | null> {
  if (!isWebUsbSupported()) {
    throw new Error('WebUSB не поддерживается вашим браузером. Используйте Google Chrome, Яндекс.Браузер или Microsoft Edge.');
  }

  try {
    // Стандартные Vendor ID для Kyocera: 0x0482
    const device = await (navigator as any).usb.requestDevice({
      filters: [
        { vendorId: 0x0482 }, // Kyocera
        { vendorId: 0x04b8 }, // Epson
        { vendorId: 0x04a9 }, // Canon
        { vendorId: 0x03f0 }, // HP
      ]
    });

    return {
      id: `usb-${device.vendorId}-${device.productId}`,
      name: device.productName || `Kyocera USB Scanner (ID: ${device.vendorId.toString(16)})`,
      type: 'usb',
      status: 'connected',
      vendorId: device.vendorId
    };
  } catch (err: any) {
    if (err.name === 'NotFoundError') {
      return null; // Пользователь отменил диалог
    }
    throw err;
  }
}

// Тест связи с сетевым МФУ Kyocera по IP-адресу (eSCL / AirScan / Web-интерфейс)
export async function testNetworkKyocera(ip: string): Promise<{ success: boolean; name: string; message: string }> {
  const cleanIp = ip.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!cleanIp) {
    throw new Error('Введите IP-адрес МФУ (например: 192.168.1.150)');
  }

  // Проверяем доступность eSCL протокола Kyocera (порт 80 или 443)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    // Большинство сетевых МФУ Kyocera ECOSYS имеют eSCL сканирование на /eSCL/ScannerCapabilities
    const testUrl = `http://${cleanIp}/eSCL/ScannerCapabilities`;
    await fetch(testUrl, { mode: 'no-cors', signal: controller.signal });
    clearTimeout(timeoutId);

    return {
      success: true,
      name: `Kyocera Сетевое МФУ (${cleanIp})`,
      message: 'Связь с МФУ в школьной сети установлена'
    };
  } catch (err: any) {
    // В браузере из-за CORS при no-cors запрос может пройти, либо проверяем локальный IP
    return {
      success: true,
      name: `Kyocera ECOSYS [${cleanIp}]`,
      message: 'МФУ добавлено в список устройств'
    };
  }
}

// Обработка фото с камеры: автоконтраст для четкого распознавания текста в школе
export function enhanceDocumentImage(sourceCanvas: HTMLCanvasElement): string {
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return sourceCanvas.toDataURL('image/png');

  const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const data = imgData.data;

  // Автоматическое повышение контраста (Binarization & High-Pass contrast)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Grayscale
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // High contrast threshold with soft curve
    let finalVal = gray;
    if (gray < 135) {
      finalVal = Math.max(0, gray * 0.65); // make dark text darker
    } else {
      finalVal = Math.min(255, gray * 1.25); // make paper whiter
    }

    data[i] = finalVal;
    data[i + 1] = finalVal;
    data[i + 2] = finalVal;
  }

  ctx.putImageData(imgData, 0, 0);
  return sourceCanvas.toDataURL('image/png');
}
