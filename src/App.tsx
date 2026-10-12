/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Printer,
  Scan,
  FileText,
  FileDown,
  UploadCloud,
  Check,
  Copy,
  ExternalLink,
  Globe,
  HelpCircle,
  Sparkles,
  Layers,
  Trash2,
  Wifi,
  Usb,
  BookOpen,
  Download,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Eye,
  Link as LinkIcon,
  X,
  Play
} from 'lucide-react';
import { exportDocxClient } from './utils/clientDocx.ts';
import { exportSearchablePdfClient } from './utils/clientPdf.ts';
import { requestUsbScanner, testNetworkKyocera, enhanceDocumentImage } from './utils/hardwareScanner.ts';
import { runClientOcr } from './utils/clientOcr.ts';

interface ScannedPage {
  id: string;
  imageUrl: string;
  sourceType: 'camera' | 'usb' | 'network' | 'upload' | 'kyocera_wia';
  text?: string;
  confidence?: number;
  words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  links?: Array<{ url: string; type: 'url' | 'email'; bbox?: { x0: number; y0: number; x1: number; y1: number } }>;
}

export default function App() {
  const [appMode, setAppMode] = useState<'school' | 'advanced' | 'vercel_guide'>('school');

  // Pages
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(-1);

  // States
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedLang, setSelectedLang] = useState<'rus+eng' | 'rus' | 'eng'>('rus+eng');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Camera scanner modal
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Network Kyocera IP modal
  const [showNetworkModal, setShowNetworkModal] = useState<boolean>(false);
  const [printerIp, setPrinterIp] = useState<string>('192.168.1.150');
  const [networkStatus, setNetworkStatus] = useState<string | null>(null);

  // USB Scanner Status
  const [connectedUsbDevice, setConnectedUsbDevice] = useState<string | null>(null);

  // Drag and drop input
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Advanced WIA settings
  const [dpi, setDpi] = useState<number>(300);
  const [colorMode, setColorMode] = useState<'color' | 'grayscale' | 'bw'>('color');

  // Cleanup camera stream on close
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCameraModal(false);
  };

  // Open Camera
  const startCamera = async () => {
    setShowCameraModal(true);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      setCameraError('Не удалось получить доступ к камере. Разрешите доступ в настройках браузера.');
    }
  };

  // Snap photo from camera
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const enhancedUrl = enhanceDocumentImage(canvas);

    addScannedPage({
      id: `cam-${Date.now()}`,
      imageUrl: enhancedUrl,
      sourceType: 'camera'
    });

    stopCamera();
  };

  // Connect USB scanner via WebUSB
  const handleConnectUsb = async () => {
    try {
      setStatusMsg('Поиск USB сканера Kyocera...');
      setIsProcessing(true);
      const scanner = await requestUsbScanner();
      if (scanner) {
        setConnectedUsbDevice(scanner.name);
        await triggerHardwareScan(scanner.name, 'usb');
      }
    } catch (err: any) {
      alert(`USB сканер: ${err.message}\n\nПодсказка: Вы также можете сделать моментальный скан документа через камеру или загрузить файл скана.`);
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Connect Network Kyocera
  const handleConnectNetwork = async () => {
    try {
      setIsProcessing(true);
      setStatusMsg(`Поиск МФУ Kyocera по адресу ${printerIp}...`);
      const res = await testNetworkKyocera(printerIp);
      setNetworkStatus(res.message);
      setShowNetworkModal(false);
      await triggerHardwareScan(`Kyocera ECOSYS (${printerIp})`, 'network');
    } catch (err: any) {
      setNetworkStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Trigger Hardware Scan (if local agent or API is available)
  const triggerHardwareScan = async (deviceName: string, source: ScannedPage['sourceType']) => {
    setIsProcessing(true);
    setStatusMsg(`Подключение к ${deviceName}... Захват страницы...`);
    setErrorMessage(null);

    try {
      // Check if local backend or agent is accessible
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName, dpi, colorMode })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success && data.file) {
        addScannedPage({
          id: `scan-${Date.now()}`,
          imageUrl: `/api/download/${data.file}?inline=true`,
          sourceType: source
        });
        return;
      } else {
        throw new Error(data.error || 'Ошибка захвата изображения со сканера');
      }
    } catch (err: any) {
      // Running on Vercel static cloud without local WIA bridge
      setErrorMessage(
        `Сайт открыт на Vercel (в облаке). Браузер не может напрямую отдавать низкоуровневые команды в локальный USB-порт без установленного агента.\n\nРешение:\n1) Нажмите кнопку «Камера» — сделайте фото документа прямо с камеры ноутбука или смартфона.\n2) Или нажмите «Загрузить фото» и выберите файл со сканера/флешки.`
      );
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Upload file from computer
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        addScannedPage({
          id: `upload-${Date.now()}`,
          imageUrl: e.target.result as string,
          sourceType: 'upload'
        });
      }
    };
    reader.readAsDataURL(file);
  };

  // Add Page to queue
  const addScannedPage = (page: ScannedPage) => {
    setPages(prev => {
      const next = [...prev, page];
      setActivePageIndex(next.length - 1);
      return next;
    });
    setErrorMessage(null);
  };

  // Delete page
  const deletePage = (index: number) => {
    setPages(prev => prev.filter((_, i) => i !== index));
    if (activePageIndex >= index) {
      setActivePageIndex(Math.max(0, activePageIndex - 1));
    }
  };

  // REAL OCR: recognizes text directly in the browser via Tesseract.js (Works 100% on Vercel!)
  const handleRunOCR = async () => {
    if (activePageIndex < 0 || !pages[activePageIndex]) return;
    const page = pages[activePageIndex];

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // First try local backend if available
      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: page.imageUrl.includes('scan_') ? page.imageUrl.split('/').pop()?.split('?')[0] : '',
            lang: selectedLang
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data && data.data.text) {
            setPages(prev => {
              const copy = [...prev];
              copy[activePageIndex] = {
                ...page,
                text: data.data.text,
                words: data.data.words,
                links: data.data.links,
                confidence: data.data.confidence
              };
              return copy;
            });
            return;
          }
        }
      } catch {
        // Fall back to client-side in-browser Tesseract.js
      }

      // Execute Real Client-Side OCR in the Browser on the actual document image!
      const ocrResult = await runClientOcr(
        page.imageUrl,
        selectedLang,
        (pct, msg) => setStatusMsg(`${msg} (${pct}%)`)
      );

      const recognizedText = ocrResult.text.trim();
      const finalDisplayText = recognizedText.length > 0
        ? recognizedText
        : 'Текст не распознан. Пожалуйста, убедитесь, что документ четкий, без смазанных участков и с хорошим освещением.';

      setPages(prev => {
        const copy = [...prev];
        copy[activePageIndex] = {
          ...page,
          text: finalDisplayText,
          words: ocrResult.words,
          links: ocrResult.links,
          confidence: ocrResult.confidence
        };
        return copy;
      });
    } catch (err: any) {
      setErrorMessage(`Ошибка распознавания: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Export DOCX (Client-side, works on Vercel!)
  const handleExportDocx = async () => {
    const text = currentPage?.text;
    if (!text || text.includes('Текст не распознан')) {
      alert('Сначала нажмите «Распознать текст»!');
      return;
    }

    setIsProcessing(true);
    setStatusMsg('Создание документа Word (.docx)...');

    try {
      const blob = await exportDocxClient(text, 'Документ сканирования');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scan_${Date.now()}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Ошибка экспорта DOCX: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Export Searchable PDF (Client-side, works on Vercel!)
  const handleExportPdf = async () => {
    if (pages.length === 0) {
      alert('Нет отсканированных страниц!');
      return;
    }

    setIsProcessing(true);
    setStatusMsg('Сборка Searchable PDF (с кликабельными ссылками)...');

    try {
      const pdfPages = pages.map(p => ({
        imageUrl: p.imageUrl,
        ocrWords: p.words,
        links: p.links
      }));

      const blob = await exportSearchablePdfClient(pdfPages, 'Searchable PDF');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `document_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Ошибка экспорта PDF: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Copy text to clipboard
  const handleCopyText = () => {
    if (!currentPage?.text) return;
    navigator.clipboard.writeText(currentPage.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentPage = activePageIndex >= 0 ? pages[activePageIndex] : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-blue-100">
      {/* Top Header */}
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shadow-xs shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Школьный сканер & OCR</h1>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
                Реальный OCR (Tesseract)
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Сканирование с камеры, загрузка сканов • Реальное распознавание текста без пробников
            </p>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setAppMode('school')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              appMode === 'school'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Школьный режим</span>
          </button>

          <button
            onClick={() => setAppMode('advanced')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              appMode === 'advanced'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span>Настройки сканера</span>
          </button>

          <button
            onClick={() => setAppMode('vercel_guide')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              appMode === 'vercel_guide'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            <span>Инструкция Vercel</span>
          </button>
        </div>
      </header>

      {/* Progress banner */}
      {isProcessing && (
        <div className="bg-blue-600 text-white px-4 py-2.5 text-xs font-medium flex items-center justify-between shadow-sm animate-pulse">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>{statusMsg}</span>
          </div>
          <span className="text-[11px] opacity-90 font-mono">Реальная обработка в браузере</span>
        </div>
      )}

      {/* Error alert modal / banner */}
      {errorMessage && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-xs text-amber-900 flex items-start justify-between">
          <div className="flex items-start gap-2 max-w-4xl">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold">Информация о подключении сканера:</span>
              <p className="whitespace-pre-line text-slate-700">{errorMessage}</p>
            </div>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-amber-800 hover:text-black font-bold text-sm px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* TAB 1: SCHOOL FRIENDLY MODE */}
        {appMode === 'school' && (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden max-w-7xl mx-auto w-full p-4 gap-4">
            {/* Left Section: 3-step action area */}
            <div className="w-full md:w-[380px] flex flex-col gap-4 overflow-y-auto shrink-0">
              {/* Step 1: Input source */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] flex items-center justify-center font-bold">1</span>
                    Откуда взять документ?
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">Страниц: {pages.length}</span>
                </div>

                {/* 4 Large Friendly Buttons */}
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Camera button - REAL CAMERA SCAN */}
                  <button
                    onClick={startCamera}
                    className="p-3 rounded-xl border-2 border-blue-100 hover:border-blue-500 hover:bg-blue-50/50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm">
                      <Camera className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">Камера</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Сфотографировать лист с ноутбука/телефона</span>
                  </button>

                  {/* File Upload / Drag & Drop - REAL SCANNED FILE */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 rounded-xl border-2 border-purple-100 hover:border-purple-500 hover:bg-purple-50/50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">Загрузить скан</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Файл со сканера, флешки или компьютера</span>
                  </button>

                  {/* Network Kyocera */}
                  <button
                    onClick={() => setShowNetworkModal(true)}
                    className="p-3 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Wifi className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">МФУ по сети</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Kyocera в школьной сети по IP</span>
                  </button>

                  {/* USB Scanner */}
                  <button
                    onClick={handleConnectUsb}
                    className="p-3 rounded-xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50/50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Usb className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">USB сканер</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Подключение по USB проводу</span>
                  </button>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />

                {connectedUsbDevice && (
                  <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Подключено: <strong>{connectedUsbDevice}</strong></span>
                  </div>
                )}
              </div>

              {/* Step 2: Page List */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex-1 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] flex items-center justify-center font-bold">2</span>
                    Страницы документа
                  </span>
                  {pages.length > 0 && (
                    <button
                      onClick={() => setPages([])}
                      className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Удалить все
                    </button>
                  )}
                </div>

                {pages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 rounded-xl text-slate-400">
                    <Scan className="w-10 h-10 text-slate-300 mb-2" />
                    <p className="text-xs font-semibold text-slate-600">Нет добавленных документов</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                      Нажмите <strong>«Камера»</strong>, чтобы сфотографировать реальный документ, или нажмите <strong>«Загрузить скан»</strong>
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 overflow-y-auto max-h-60 pr-1">
                    {pages.map((p, idx) => (
                      <div
                        key={p.id}
                        onClick={() => setActivePageIndex(idx)}
                        className={`relative rounded-xl border p-1.5 cursor-pointer transition-all ${
                          idx === activePageIndex
                            ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/40 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center mb-1 relative">
                          <img
                            src={p.imageUrl}
                            alt={`Стр. ${idx + 1}`}
                            className="w-full h-full object-contain"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePage(idx);
                            }}
                            className="absolute top-1 right-1 w-5 h-5 bg-white/90 hover:bg-red-500 hover:text-white rounded-full flex items-center justify-center text-slate-600 shadow-xs text-xs"
                            title="Удалить страницу"
                          >
                            ×
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-[11px] px-1">
                          <span className="font-bold text-slate-700">Стр. {idx + 1}</span>
                          {p.text ? (
                            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1 rounded">Распознано ✓</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Новый скан</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Big OCR Button: Runs REAL Tesseract.js */}
                <button
                  onClick={handleRunOCR}
                  disabled={!currentPage || isProcessing}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>{isProcessing ? 'Идет реальное распознавание...' : 'Распознать текст страницы (OCR)'}</span>
                </button>
              </div>
            </div>

            {/* Right Section: Workspace, Preview & Text Editor */}
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
              {/* Preview & Editor Split */}
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                {/* Visual Document View */}
                <div className="flex-1 bg-slate-100 p-4 flex flex-col items-center justify-center overflow-auto border-b lg:border-b-0 lg:border-r border-slate-200">
                  {!currentPage ? (
                    <div className="text-center text-slate-400 p-6">
                      <Scan className="w-12 h-12 mx-auto text-slate-300 mb-2" />
                      <p className="text-sm font-semibold text-slate-600">Предпросмотр документа</p>
                      <p className="text-xs text-slate-400 mt-1">Сделайте снимок на камеру или выберите файл слева</p>
                    </div>
                  ) : (
                    <div className="max-w-full max-h-full flex items-center justify-center">
                      <img
                        src={currentPage.imageUrl}
                        alt="Отсканированный документ"
                        className="max-h-[calc(100vh-320px)] object-contain rounded-lg shadow-lg border border-slate-300 bg-white"
                      />
                    </div>
                  )}
                </div>

                {/* Text Editor */}
                <div className="flex-1 flex flex-col p-4 bg-white">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      <h2 className="text-sm font-bold text-slate-800">Распознанный текст документа</h2>
                      {currentPage?.confidence ? (
                        <span className="text-[11px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded">
                          Точность: {currentPage.confidence}%
                        </span>
                      ) : null}
                    </div>

                    <button
                      onClick={handleCopyText}
                      disabled={!currentPage?.text}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Скопировано!' : 'Скопировать'}</span>
                    </button>
                  </div>

                  <textarea
                    value={currentPage?.text || ''}
                    onChange={e => {
                      if (activePageIndex >= 0 && pages[activePageIndex]) {
                        const newText = e.target.value;
                        setPages(prev => {
                          const copy = [...prev];
                          copy[activePageIndex] = { ...copy[activePageIndex], text: newText };
                          return copy;
                        });
                      }
                    }}
                    placeholder="Здесь появится РЕАЛЬНЫЙ текст вашего отсканированного документа после нажатия кнопки «Распознать текст страницы (OCR)»...&#10;&#10;Вы сможете сразу внести правки, скопировать текст в реферат или сохранить в Word."
                    className="flex-1 w-full p-3 rounded-xl border border-slate-200 text-xs font-mono leading-relaxed resize-none outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-slate-50/50"
                  />

                  {/* Detected links badge row */}
                  {currentPage?.links && currentPage.links.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-2 overflow-x-auto text-xs">
                      <LinkIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="text-[11px] font-semibold text-slate-500 shrink-0">Ссылки в тексте:</span>
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        {currentPage.links.map((link, lIdx) => (
                          <a
                            key={lIdx}
                            href={link.type === 'email' ? `mailto:${link.url}` : link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-mono text-blue-600 hover:underline bg-blue-50 px-2 py-0.5 rounded border border-blue-200 shrink-0 flex items-center gap-1"
                          >
                            <span>{link.url}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Big Export Bar */}
              <div className="h-20 bg-slate-50 border-t border-slate-200 px-6 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800">Шаг 3: Сохранить результат</h3>
                  <p className="text-[11px] text-slate-500">Генерация файлов прямо в браузере (100% бесплатно и офлайн)</p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleExportDocx}
                    disabled={!currentPage?.text}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Скачать в Word (.docx)</span>
                  </button>

                  <button
                    onClick={handleExportPdf}
                    disabled={pages.length === 0}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                  >
                    <Download className="w-4 h-4" />
                    <span>Скачать в Searchable PDF</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ADVANCED WIA SETTINGS */}
        {appMode === 'advanced' && (
          <div className="flex-1 max-w-5xl mx-auto w-full p-6 space-y-6 overflow-y-auto">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
                  KX
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Настройки оптического распознавания и сканирования</h2>
                  <p className="text-xs text-slate-500">Параметры языка OCR и разрешения изображения</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Язык распознавания OCR:</label>
                  <select
                    value={selectedLang}
                    onChange={e => setSelectedLang(e.target.value as any)}
                    className="w-full text-xs rounded-lg p-2 border border-slate-300 bg-white"
                  >
                    <option value="rus+eng">Русский + Английский (rus+eng)</option>
                    <option value="rus">Только русский (rus)</option>
                    <option value="eng">Только английский (eng)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Разрешение DPI:</label>
                  <select
                    value={dpi}
                    onChange={e => setDpi(Number(e.target.value))}
                    className="w-full text-xs rounded-lg p-2 border border-slate-300 bg-white"
                  >
                    <option value={150}>150 DPI (быстро)</option>
                    <option value={300}>300 DPI (стандартное)</option>
                    <option value={600}>600 DPI (высокое качество)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Цветовой режим:</label>
                  <select
                    value={colorMode}
                    onChange={e => setColorMode(e.target.value as any)}
                    className="w-full text-xs rounded-lg p-2 border border-slate-300 bg-white"
                  >
                    <option value="color">Полноцветный (24-bit)</option>
                    <option value="grayscale">Оттенки серого (8-bit)</option>
                    <option value="bw">Ч/Б контрастный (1-bit)</option>
                  </select>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                <h3 className="font-bold text-slate-800">Как сканировать с МФУ Kyocera на школьный сайт:</h3>
                <p className="text-slate-600">
                  <strong>Вариант 1 (Самый простой):</strong> Нажмите кнопку <strong>«Камера»</strong> на ноутбуке, телефоне или планшете. Приложение сделает четкий снимок страницы с автоконтрастом и сразу распознает текст.
                </p>
                <p className="text-slate-600">
                  <strong>Вариант 2:</strong> Отсканируйте документ с панели МФУ Kyocera на флешку или в сетевую папку (PDF/PNG) и перетащите файл в окно программы через <strong>«Загрузить скан»</strong>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: VERCEL GUIDE */}
        {appMode === 'vercel_guide' && (
          <div className="flex-1 max-w-4xl mx-auto w-full p-6 space-y-6 overflow-y-auto">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center font-bold text-lg">
                  ▲
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Работа приложения на Vercel</h2>
                  <p className="text-xs text-slate-500">
                    Реальное распознавание текста на клиентской стороне без серверов
                  </p>
                </div>
              </div>

              <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-emerald-950">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Теперь никаких пробников и демо-заглушек!
                  </h3>
                  <p>
                    Движок <strong>Tesseract.js</strong> переведен на выполнение прямо в браузере клиента. Когда вы сканируете камерой или загружаете файл, приложение распознает <strong>РЕАЛЬНЫЕ БУКВЫ И СЛОВА</strong> с вашего физического документа.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <h4 className="font-bold text-slate-800">Как обновить приложение на Vercel прямо сейчас:</h4>
                  <p className="text-slate-600">
                    Все изменения уже закоммичены в репозиторий. Если у вас подключен автодеплой в Vercel, он обновится автоматически. Если нет — сделайте `git push origin main` или нажмите <strong>«Redeploy»</strong> в панели Vercel.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CAMERA VIEWFINDER MODAL */}
      {showCameraModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Сканирование документа камерой</h3>
              </div>
              <button onClick={stopCamera} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
              {cameraError ? (
                <div className="p-6 text-center text-white space-y-2">
                  <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
                  <p className="text-xs">{cameraError}</p>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  {/* Document Viewfinder Overlay Grid */}
                  <div className="absolute inset-8 border-2 border-white/60 border-dashed rounded-xl pointer-events-none flex items-center justify-center">
                    <span className="bg-black/60 text-white text-[11px] px-3 py-1 rounded-full font-medium">
                      Поместите страницу в рамку
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="p-4 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500">Автоповышение контраста для четкого распознавания текста</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={stopCamera}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl"
                >
                  Отмена
                </button>
                <button
                  onClick={capturePhoto}
                  disabled={Boolean(cameraError)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                  <span>Сделать скан</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NETWORK KYOCERA IP MODAL */}
      {showNetworkModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900">Подключение сетевого МФУ Kyocera</h3>
              </div>
              <button onClick={() => setShowNetworkModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Введите IP-адрес МФУ Kyocera в школьной сети:
            </p>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">IP-адрес сканера:</label>
              <input
                type="text"
                value={printerIp}
                onChange={e => setPrinterIp(e.target.value)}
                placeholder="192.168.1.150"
                className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-300 outline-none focus:border-blue-500"
              />
            </div>

            {networkStatus && (
              <p className="text-xs text-emerald-600 font-medium">{networkStatus}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNetworkModal(false)}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Отмена
              </button>
              <button
                onClick={handleConnectNetwork}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-md cursor-pointer active:scale-95"
              >
                Подключить и сканировать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
