/**
 * Логика фронтенда: Сканирование, холст Canvas, OCR, экспорт DOCX/PDF
 */

// Состояние приложения
const state = {
  devices: [],
  pages: [], // { id, fileName, previewUrl, ocrResult, customText }
  currentPageIndex: -1,
  theme: 'dark'
};

// Элементы DOM
const deviceSelect = document.getElementById('deviceSelect');
const dpiSelect = document.getElementById('dpiSelect');
const colorSelect = document.getElementById('colorSelect');
const formatSelect = document.getElementById('formatSelect');
const sourceSelect = document.getElementById('sourceSelect');
const langSelect = document.getElementById('langSelect');

const scanBtn = document.getElementById('scanBtn');
const ocrBtn = document.getElementById('ocrBtn');
const exportDocxBtn = document.getElementById('exportDocxBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const clearPagesBtn = document.getElementById('clearPagesBtn');
const themeToggle = document.getElementById('themeToggle');

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const browseLink = document.getElementById('browseLink');

const previewCanvas = document.getElementById('previewCanvas');
const boxOverlay = document.getElementById('boxOverlay');
const ctx = previewCanvas.getContext('2d');

const recognizedTextArea = document.getElementById('recognizedTextArea');
const linksList = document.getElementById('linksList');
const toggleBoxes = document.getElementById('toggleBoxes');

const progressContainer = document.getElementById('progressContainer');
const progressBarFill = document.getElementById('progressBarFill');
const progressLabel = document.getElementById('progressLabel');
const pagesList = document.getElementById('pagesList');
const pageCount = document.getElementById('pageCount');

// Инициализация
window.addEventListener('DOMContentLoaded', () => {
  loadDevices();
  setupEventListeners();
});

// Загрузка WIA устройств
async function loadDevices() {
  try {
    const res = await fetch('/api/devices');
    const data = await res.json();
    deviceSelect.innerHTML = '';

    if (data.devices && data.devices.length > 0) {
      data.devices.forEach(dev => {
        const opt = document.createElement('option');
        opt.value = dev.name;
        opt.textContent = `${dev.name} [${dev.driver}]`;
        if (dev.default) opt.selected = true;
        deviceSelect.appendChild(opt);
      });
    } else {
      deviceSelect.innerHTML = '<option value="Kyocera KX Driver">Kyocera KX (WIA)</option>';
    }
  } catch (err) {
    deviceSelect.innerHTML = '<option value="Kyocera ECOSYS M2040dn KX (WIA)">Kyocera ECOSYS M2040dn KX (WIA)</option>';
  }
}

// Слушатели событий
function setupEventListeners() {
  // Переключение темы
  themeToggle.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
  });

  // Сканирование
  scanBtn.addEventListener('click', handleScan);

  // Drag-and-drop
  browseLink.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) uploadFile(e.target.files[0]);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) uploadFile(e.dataTransfer.files[0]);
  });

  // OCR
  ocrBtn.addEventListener('click', handleOCR);

  // Текстреа - обновление ссылок
  recognizedTextArea.addEventListener('input', () => {
    if (state.currentPageIndex >= 0) {
      state.pages[state.currentPageIndex].customText = recognizedTextArea.value;
      updateLinksDisplay(recognizedTextArea.value);
    }
  });

  // Переключение рамок
  toggleBoxes.addEventListener('change', () => {
    boxOverlay.style.display = toggleBoxes.checked ? 'block' : 'none';
  });

  // Экспорт
  exportDocxBtn.addEventListener('click', handleExportDocx);
  exportPdfBtn.addEventListener('click', handleExportPdf);
  clearPagesBtn.addEventListener('click', clearPages);
}

// Запуск сканирования
async function handleScan() {
  setLoading(true, 'Инициализация сканера Kyocera...');
  try {
    const payload = {
      deviceName: deviceSelect.value,
      dpi: parseInt(dpiSelect.value, 10),
      colorMode: colorSelect.value,
      pageSize: formatSelect.value,
      source: sourceSelect.value
    };

    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Ошибка сканирования');

    addPage({
      fileName: data.file,
      previewUrl: `/api/download/${data.file}?inline=true`
    });
  } catch (err) {
    alert(`Ошибка сканирования: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// Загрузка файла пользователем
async function uploadFile(file) {
  setLoading(true, 'Загрузка файла скана...');
  const formData = new FormData();
  formData.append('scanFile', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Ошибка загрузки');

    addPage({
      fileName: data.file,
      previewUrl: `/api/download/${data.file}?inline=true`
    });
  } catch (e) {
    alert(`Ошибка: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

// Добавление страницы
function addPage(page) {
  state.pages.push(page);
  renderPagesList();
  selectPage(state.pages.length - 1);
}

function clearPages() {
  state.pages = [];
  state.currentPageIndex = -1;
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  boxOverlay.innerHTML = '';
  recognizedTextArea.value = '';
  renderPagesList();
  updateButtonStates();
}

function renderPagesList() {
  pageCount.textContent = state.pages.length;
  if (state.pages.length === 0) {
    pagesList.innerHTML = '<div class="empty-state">Нет отсканированных страниц</div>';
    return;
  }

  pagesList.innerHTML = '';
  state.pages.forEach((page, idx) => {
    const div = document.createElement('div');
    div.className = `page-thumb ${idx === state.currentPageIndex ? 'active' : ''}`;
    div.innerHTML = `
      <img src="${page.previewUrl}" alt="Стр. ${idx + 1}" />
      <span class="page-thumb-num">Стр. ${idx + 1}</span>
    `;
    div.addEventListener('click', () => selectPage(idx));
    pagesList.appendChild(div);
  });
}

function selectPage(index) {
  if (index < 0 || index >= state.pages.length) return;
  state.currentPageIndex = index;
  renderPagesList();

  const page = state.pages[index];
  loadImageToCanvas(page.previewUrl);

  if (page.ocrResult) {
    recognizedTextArea.value = page.customText || page.ocrResult.text;
    renderBoundingBoxes(page.ocrResult);
    updateLinksDisplay(recognizedTextArea.value);
  } else {
    recognizedTextArea.value = '';
    boxOverlay.innerHTML = '';
    linksList.innerHTML = 'нет';
  }

  updateButtonStates();
}

function loadImageToCanvas(url) {
  const img = new Image();
  img.onload = () => {
    previewCanvas.width = img.naturalWidth || 1240;
    previewCanvas.height = img.naturalHeight || 1754;
    ctx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);

    if (state.pages[state.currentPageIndex]?.ocrResult) {
      renderBoundingBoxes(state.pages[state.currentPageIndex].ocrResult);
    }
  };
  img.src = url;
}

// Запуск OCR
async function handleOCR() {
  if (state.currentPageIndex < 0) return;
  const page = state.pages[state.currentPageIndex];

  setLoading(true, 'Оптическое распознавание Tesseract.js (RUS+ENG)...');

  try {
    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: page.fileName,
        lang: langSelect.value
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Ошибка OCR');

    page.ocrResult = data.data;
    page.customText = data.data.text;
    recognizedTextArea.value = page.customText;

    renderBoundingBoxes(page.ocrResult);
    updateLinksDisplay(page.customText);
    updateButtonStates();
  } catch (err) {
    alert(`Ошибка OCR: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// Отрисовка рамок слов
function renderBoundingBoxes(ocr) {
  boxOverlay.innerHTML = '';
  if (!ocr || !ocr.words) return;

  const canvasRect = previewCanvas.getBoundingClientRect();
  const scaleX = canvasRect.width / (previewCanvas.width || 1240);
  const scaleY = canvasRect.height / (previewCanvas.height || 1754);

  ocr.words.forEach(w => {
    if (!w.bbox) return;
    const box = document.createElement('div');
    box.className = 'ocr-box';

    const isLink = ocr.links && ocr.links.some(l => l.url.includes(w.text) || w.text.includes(l.url));
    if (isLink) box.classList.add('link-box');

    box.style.left = `${w.bbox.x0 * scaleX}px`;
    box.style.top = `${w.bbox.y0 * scaleY}px`;
    box.style.width = `${(w.bbox.x1 - w.bbox.x0) * scaleX}px`;
    box.style.height = `${(w.bbox.y1 - w.bbox.y0) * scaleY}px`;
    box.title = `${w.text} (${w.confidence}%)`;

    boxOverlay.appendChild(box);
  });
}

function updateLinksDisplay(text) {
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"'()[\]{},;:]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const matches = text.match(urlRegex) || [];

  if (matches.length === 0) {
    linksList.innerHTML = 'ссылок не найдено';
    return;
  }

  linksList.innerHTML = matches.map(m => {
    const isEmail = m.includes('@') && !m.startsWith('http');
    const href = isEmail ? `mailto:${m}` : (m.startsWith('http') ? m : `https://${m}`);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${m}</a>`;
  }).join(' ');
}

// Экспорт DOCX
async function handleExportDocx() {
  const text = recognizedTextArea.value;
  if (!text) return alert('Нет текста для экспорта!');

  setLoading(true, 'Формирование документа DOCX...');
  try {
    const res = await fetch('/api/export/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        title: 'Документ сканирования Kyocera KX'
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    downloadUrl(data.downloadUrl);
  } catch (e) {
    alert(`Ошибка экспорта DOCX: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

// Экспорт PDF
async function handleExportPdf() {
  if (state.pages.length === 0) return alert('Нет страниц для экспорта!');

  setLoading(true, 'Сборка Searchable PDF с невидимым слоем и ссылками...');
  try {
    const payload = {
      pages: state.pages.map(p => ({
        imagePath: p.fileName,
        ocrResult: p.ocrResult,
        customText: p.customText
      })),
      title: 'Kyocera Scan Searchable PDF'
    };

    const res = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    downloadUrl(data.downloadUrl);
  } catch (e) {
    alert(`Ошибка экспорта PDF: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

function downloadUrl(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function updateButtonStates() {
  const hasPages = state.pages.length > 0;
  const hasCurrentPage = state.currentPageIndex >= 0;
  const hasText = recognizedTextArea.value.trim().length > 0;

  ocrBtn.disabled = !hasCurrentPage;
  exportDocxBtn.disabled = !hasText;
  exportPdfBtn.disabled = !hasPages;
}

function setLoading(isLoading, text = '') {
  if (isLoading) {
    progressContainer.style.display = 'block';
    progressLabel.textContent = text;
    progressBarFill.style.width = '70%';
  } else {
    progressBarFill.style.width = '100%';
    setTimeout(() => {
      progressContainer.style.display = 'none';
      progressBarFill.style.width = '0%';
    }, 400);
  }
}
