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
  Play,
  Terminal,
  Server
} from 'lucide-react';
import { exportDocxClient } from './utils/clientDocx.ts';
import { exportSearchablePdfClient } from './utils/clientPdf.ts';
import { requestUsbScanner, testNetworkKyocera, enhanceDocumentImage } from './utils/hardwareScanner.ts';
import { runClientOcr } from './utils/clientOcr.ts';
import { renderPdfToImages } from './utils/pdfRenderer.ts';

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

  // Local Scanner Agent state (for Vercel -> Physical Scanner bridge)
  const [agentConnected, setAgentConnected] = useState<boolean>(false);
  const [agentDevices, setAgentDevices] = useState<Array<{ id: string; name: string; driverType: string }>>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('Kyocera ECOSYS M2040dn KX (WIA)');
  const [showAgentModal, setShowAgentModal] = useState<boolean>(false);

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

  // Check Local Agent status on mount
  useEffect(() => {
    checkAgentConnection();
    const interval = setInterval(checkAgentConnection, 6000);
    return () => clearInterval(interval);
  }, []);

  const checkAgentConnection = async () => {
    try {
      // 1. Try local bridge on user's machine (for Vercel)
      const res = await fetch('http://127.0.0.1:3000/api/devices', { mode: 'cors' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.devices) {
          setAgentConnected(true);
          setAgentDevices(data.devices);
          if (data.devices.length > 0 && !selectedDevice) {
            setSelectedDevice(data.devices[0].name);
          }
          return;
        }
      }
    } catch {
      // 2. Try relative /api/devices if running fullstack locally
      try {
        const res = await fetch('/api/devices');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.devices) {
            setAgentConnected(true);
            setAgentDevices(data.devices);
            return;
          }
        }
      } catch {}
    }
    setAgentConnected(false);
  };

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

  // Trigger Physical Scan with Kyocera via Local Bridge
  const handlePhysicalScan = async () => {
    setIsProcessing(true);
    setStatusMsg(`Подключение к сканеру ${selectedDevice}... Запуск механизма...`);

    const endpoints = [
      'http://127.0.0.1:3000/api/scan',
      '/api/scan'
    ];

    let successData: any = null;

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceName: selectedDevice,
            dpi,
            colorMode,
            source: 'flatbed'
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            successData = data;
            break;
          }
        }
      } catch (err) {
        // try next endpoint
      }
    }

    setIsProcessing(false);
    setStatusMsg('');

    if (successData) {
      // Received real scanned document from scanner!
      const imgUrl = successData.base64 || `/api/download/${successData.file}?inline=true`;
      addScannedPage({
        id: `scan-${Date.now()}`,
        imageUrl: imgUrl,
        sourceType: 'kyocera_wia'
      });
    } else {
      // Agent is not responding, open agent instructions modal with 1-click downloads
      setShowAgentModal(true);
    }
  };

  // Connect USB scanner via WebUSB or local bridge
  const handleConnectUsb = async () => {
    if (agentConnected) {
      await handlePhysicalScan();
      return;
    }

    try {
      setStatusMsg('Поиск USB сканера...');
      setIsProcessing(true);
      const scanner = await requestUsbScanner();
      if (scanner) {
        setConnectedUsbDevice(scanner.name);
        await handlePhysicalScan();
      } else {
        setShowAgentModal(true);
      }
    } catch (err: any) {
      setShowAgentModal(true);
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
      await handlePhysicalScan();
    } catch (err: any) {
      setNetworkStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Upload file from computer (supports PNG, JPG, JPEG, WEBP and multi-page PDF!)
  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        setStatusMsg('Извлечение страниц из PDF для распознавания...');
        const pageImages = await renderPdfToImages(file);
        if (pageImages.length === 0) {
          alert('В загруженном PDF не найдено страниц');
          return;
        }
        pageImages.forEach((imgUrl, i) => {
          addScannedPage({
            id: `upload-pdf-${Date.now()}-${i}`,
            imageUrl: imgUrl,
            sourceType: 'upload'
          });
        });
      } else {
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
      }
    } catch (err: any) {
      alert(`Ошибка открытия файла: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  // Add Page to queue
  const addScannedPage = (page: ScannedPage) => {
    setPages(prev => {
      const next = [...prev, page];
      setActivePageIndex(next.length - 1);
      return next;
    });
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

    try {
      // Execute Real Client-Side OCR in the Browser on the actual document image
      const ocrResult = await runClientOcr(
        page.imageUrl,
        selectedLang,
        (pct, msg) => setStatusMsg(`${msg} (${pct}%)`)
      );

      const recognizedText = ocrResult.text.trim();
      const finalDisplayText = recognizedText.length > 0
        ? recognizedText
        : 'Текст не распознан. Убедитесь, что страница освещена и текст в фокусе.';

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
      alert(`Ошибка распознавания: ${err.message}`);
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

  // Download Zero-Dependency PowerShell Agent directly from the browser
  const downloadAgentScript = () => {
    const batContent = `@echo off
rem ================================================================
rem Kyocera Scanner Agent Bridge (Windows)
rem No Node.js required! Uses built-in Windows PowerShell.
rem ================================================================
title Kyocera Scanner Local Agent
cls
echo Starting Kyocera Scanner Local Bridge...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scanner-bridge.ps1"
if %errorlevel% neq 0 (
    echo.
    echo PowerShell script finished or encountered an issue.
    pause
)
`;
    const blob = new Blob([batContent], { type: 'application/bat' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'start-scanner.bat';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadScannerBridgePs1 = () => {
    const psContent = `# Kyocera Scanner Bridge (Windows PowerShell)
# Zero dependencies - does NOT require Node.js or npm!
# Works out of the box on Windows 10, Windows 11, Windows 8, and Windows 7.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$port = 3000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
} catch {}

function Find-Naps2 {
    $paths = @(
        "C:\\Program Files\\NAPS2\\NAPS2.Console.exe",
        "C:\\Program Files (x86)\\NAPS2\\NAPS2.Console.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    $cmd = Get-Command "naps2.console" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

try {
    $listener.Start()
} catch {
    Write-Host "[ERROR] Could not bind to port $port. Is another server running?" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Read-Host "Press Enter to exit..."
    exit 1
}

$naps2 = Find-Naps2

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     KYOCERA SCANNER AGENT (Windows Native Bridge)" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
if ($naps2) {
    Write-Host "[OK] NAPS2 Scanner Driver found: $naps2" -ForegroundColor Green
} else {
    Write-Host "[WARN] NAPS2 not found. Download free NAPS2 from: https://www.naps2.com/" -ForegroundColor Yellow
}
Write-Host "[OK] Bridge listening on: http://localhost:$port/" -ForegroundColor Green
Write-Host "Now open: https://school-scanner-ocr.vercel.app" -ForegroundColor Yellow
Write-Host "Press Ctrl+C in this window to stop the scanner." -ForegroundColor Gray
Write-Host "================================================================\`n" -ForegroundColor Cyan

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        $res.AddHeader("Access-Control-Allow-Origin", "*")
        $res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $res.AddHeader("Access-Control-Allow-Headers", "*")
        $res.AddHeader("Access-Control-Allow-Private-Network", "true")

        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 200
            $res.Close()
            continue
        }

        $path = $req.Url.AbsolutePath

        if ($req.HttpMethod -eq "GET" -and $path -eq "/api/devices") {
            $devices = @()
            if ($naps2) {
                try {
                    $rawList = & "$naps2" --list
                    $i = 0
                    foreach ($line in ($rawList -split "\`r?\`n")) {
                        $trimmed = $line.Trim()
                        if ($trimmed) {
                            $isTwain = $trimmed.ToLower().Contains("twain")
                            $devices += @{
                                id = "dev-$i"
                                name = $trimmed
                                driverType = if ($isTwain) { "TWAIN" } else { "WIA" }
                                isDefault = ($i -eq 0)
                                status = "Ready"
                            }
                            $i++
                        }
                    }
                } catch {}
            }

            if ($devices.Count -eq 0) {
                $devices += @{
                    id = "kyocera-default"
                    name = "Kyocera ECOSYS M2040dn KX (WIA)"
                    driverType = "WIA"
                    isDefault = $true
                    status = "Ready"
                }
            }

            $jsonObj = @{
                success = $true
                naps2Found = [bool]$naps2
                binaryPath = $naps2
                devices = $devices
            }

            $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $jsonObj -Depth 5))
            $res.ContentType = "application/json; charset=utf-8"
            $res.ContentLength64 = $jsonBytes.Length
            $res.OutputStream.Write($jsonBytes, 0, $jsonBytes.Length)
            $res.Close()
            continue
        }

        if ($req.HttpMethod -eq "POST" -and $path -eq "/api/scan") {
            $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $bodyObj = try { ConvertFrom-Json $body } catch { @{} }

            $deviceName = if ($bodyObj.deviceName) { $bodyObj.deviceName } else { "" }
            $dpi = if ($bodyObj.dpi) { [string]$bodyObj.dpi } else { "300" }
            $colorMode = if ($bodyObj.colorMode) { $bodyObj.colorMode } else { "color" }
            $source = if ($bodyObj.source) { $bodyObj.source } else { "flatbed" }

            if (-not $naps2) {
                $errObj = @{ success = $false; error = "NAPS2 не найден на компьютере. Установите NAPS2 с https://www.naps2.com/" }
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $errObj))
                $res.StatusCode = 500
                $res.ContentType = "application/json; charset=utf-8"
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
                $res.Close()
                continue
            }

            $tempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "kyocera_scan_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).png")

            $argsList = @("-o", $tempFile, "--dpi", $dpi, "--pagesize", "a4")
            if ($deviceName) { $argsList += @("--device", $deviceName) }
            if ($colorMode -eq "bw") { $argsList += @("--bitdepth", "1") }
            elseif ($colorMode -eq "grayscale") { $argsList += @("--bitdepth", "8") }
            else { $argsList += @("--bitdepth", "24") }
            if ($source -eq "feeder") { $argsList += @("--source", "feeder") }
            else { $argsList += @("--source", "flatbed") }

            Write-Host "[SCAN] Физическое сканирование..." -ForegroundColor Cyan
            & "$naps2" $argsList

            if (Test-Path $tempFile) {
                $fileBytes = [System.IO.File]::ReadAllBytes($tempFile)
                $base64 = "data:image/png;base64," + [Convert]::ToBase64String($fileBytes)
                Remove-Item $tempFile -Force -ErrorAction SilentlyContinue

                $resObj = @{ success = $true; base64 = $base64 }
                $resBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $resObj))
                $res.StatusCode = 200
                $res.ContentType = "application/json; charset=utf-8"
                $res.OutputStream.Write($resBytes, 0, $resBytes.Length)
                $res.Close()
                Write-Host "[SCAN OK] Скан отправлен в браузер!" -ForegroundColor Green
            } else {
                $errObj = @{ success = $false; error = "Сканер не создал файл скана. Проверьте питание МФУ." }
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $errObj))
                $res.StatusCode = 500
                $res.ContentType = "application/json; charset=utf-8"
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
                $res.Close()
            }
            continue
        }

        $res.StatusCode = 404
        $res.Close()
    } catch {
        Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}
`;
    const blob = new Blob([psContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scanner-bridge.ps1';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

              {/* Live Scanner Agent Status Indicator */}
              {agentConnected ? (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border border-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  МФУ Kyocera подключено онлайн ✓
                </span>
              ) : (
                <button
                  onClick={() => setShowAgentModal(true)}
                  className="text-[10px] bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-200 transition-colors cursor-pointer"
                >
                  <Server className="w-3 h-3 text-amber-600" />
                  Подключить физический сканер
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Прямой запуск сканирования с МФУ Kyocera, веб-камеры и смартфона
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
            onClick={() => setShowAgentModal(true)}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:text-slate-900 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-purple-600" />
            <span>Агент сканера</span>
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
            <span>Настройки DPI</span>
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
          <span className="text-[11px] opacity-90 font-mono">Физический захват & OCR</span>
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
                    Сканировать документ
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">Страниц: {pages.length}</span>
                </div>

                {/* 4 Large Action Cards */}
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Real Physical Scanner Kyocera Button */}
                  <button
                    onClick={handlePhysicalScan}
                    className="p-3 rounded-xl border-2 border-emerald-200 hover:border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm">
                      <Printer className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">Сканер Kyocera</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Физический запуск со стекла / АПД</span>
                  </button>

                  {/* Camera button - REAL LIVE CAMERA */}
                  <button
                    onClick={startCamera}
                    className="p-3 rounded-xl border-2 border-blue-100 hover:border-blue-500 hover:bg-blue-50/50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm">
                      <Camera className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">Камера</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Сфотографировать с ноутбука/телефона</span>
                  </button>

                  {/* File Upload / Drag & Drop */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 rounded-xl border-2 border-purple-100 hover:border-purple-500 hover:bg-purple-50/50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">Загрузить скан</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Файл с флешки или компьютера</span>
                  </button>

                  {/* Network Kyocera */}
                  <button
                    onClick={() => setShowNetworkModal(true)}
                    className="p-3 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/50 transition-all text-left flex flex-col items-center justify-center text-center gap-1.5 group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Wifi className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">МФУ по сети</span>
                    <span className="text-[10px] text-slate-500 leading-tight">Подключение по IP-адресу</span>
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

                {agentConnected && (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="truncate max-w-[200px]"><strong>{selectedDevice}</strong></span>
                    </div>
                    <span className="text-[10px] bg-emerald-200 text-emerald-800 font-bold px-1.5 py-0.5 rounded">Готов</span>
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
                    <p className="text-xs font-semibold text-slate-600">Нет отсканированных страниц</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                      Нажмите <strong>«Сканер Kyocera»</strong> для запуска МФУ или <strong>«Камера»</strong>, чтобы сделать снимок
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
                            <span className="text-[10px] text-slate-400">Скан</span>
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
                  <span>{isProcessing ? 'Идет распознавание...' : 'Распознать текст страницы (OCR)'}</span>
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
                      <p className="text-xs text-slate-400 mt-1">Отсканируйте страницу со сканера или камеры слева</p>
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
                    placeholder="Здесь появится реальный текст вашего документа после нажатия кнопки «Распознать текст страницы (OCR)»...&#10;&#10;Вы сможете сразу внести правки, скопировать текст или скачать в Word/PDF."
                    className="flex-1 w-full p-3 rounded-xl border border-slate-200 text-xs font-mono leading-relaxed resize-none outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-slate-50/50"
                  />

                  {/* Detected links badge row */}
                  {currentPage?.links && currentPage.links.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-2 overflow-x-auto text-xs">
                      <LinkIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="text-[11px] font-semibold text-slate-500 shrink-0">Ссылки в документе:</span>
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
                  <p className="text-[11px] text-slate-500">Экспорт с реальными кликабельными ссылками</p>
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
                  <p className="text-xs text-slate-500">Параметры языка OCR и разрешения сканера Kyocera</p>
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
                  <label className="text-xs font-bold text-slate-700 block mb-1">Разрешение сканера DPI:</label>
                  <select
                    value={dpi}
                    onChange={e => setDpi(Number(e.target.value))}
                    className="w-full text-xs rounded-lg p-2 border border-slate-300 bg-white"
                  >
                    <option value={150}>150 DPI (быстро)</option>
                    <option value={300}>300 DPI (стандартное)</option>
                    <option value={600}>600 DPI (архивное качество)</option>
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
            </div>
          </div>
        )}
      </div>

      {/* AGENT CONNECTION MODAL (Bridge for Vercel to physical USB / WIA scanner) */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Подключение сканера Kyocera к сайту</h3>
                  <p className="text-[11px] text-slate-500">Запуск физического сканирования прямо из браузера</p>
                </div>
              </div>
              <button onClick={() => setShowAgentModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 space-y-1">
                <span className="font-bold flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-blue-600 shrink-0" />
                  Почему нужен агент?
                </span>
                <p className="text-[11px]">
                  Сайт открыт в облаке на Vercel. Из соображений безопасности ни один браузер в мире не может без локального моста управлять моторами USB-устройств.
                </p>
                <p className="text-[11px]">
                  <strong>Локальный агент</strong> — это крошечный скрипт на вашем компьютере, который принимает команду с сайта и передает её в официальный драйвер Kyocera через NAPS2!
                </p>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-2">
                <span className="font-bold text-slate-800 text-xs">Как включить за 1 минуту:</span>
                
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                  <span>Скачайте 2 файла в одну папку (Node.js НЕ нужен):</span>
                </div>

                <div className="flex items-center gap-2 pl-7 flex-wrap">
                  <button
                    onClick={downloadAgentScript}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать start-scanner.bat</span>
                  </button>

                  <button
                    onClick={downloadScannerBridgePs1}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать scanner-bridge.ps1</span>
                  </button>
                </div>

                <div className="pl-7 text-[10px] text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                  ✓ <strong>Без установки Node.js:</strong> агент использует встроенный Windows PowerShell, который уже есть на каждом школьном компьютере с Windows.
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                  <span>Дважды кликните по файлу <strong>start-scanner.bat</strong> на вашем ПК.</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                  <span>Нажмите зеленую кнопку ниже для проверки связи:</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-3">
              <span className="text-xs">
                Статус связи: {agentConnected ? (
                  <strong className="text-emerald-600 font-bold">Подключено онлайн ✓</strong>
                ) : (
                  <span className="text-amber-600 font-medium">Ожидание запуска агента...</span>
                )}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await checkAgentConnection();
                    if (agentConnected) {
                      setShowAgentModal(false);
                    }
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Проверить связь со сканером</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                <Wifi className="w-5 h-5 text-indigo-600" />
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
              <p className="text-xs text-indigo-600 font-medium">{networkStatus}</p>
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
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-md cursor-pointer active:scale-95"
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
