# Kyocera Scanner OCR Desktop (Локальное приложение)

Локальное десктопное веб-приложение на стеке **Node.js + Express + HTML/CSS/Vanilla JS** для прямого взаимодействия с МФУ Kyocera через стандартный драйвер Windows (WIA / TWAIN), офлайн-распознавания текста (OCR rus + eng) и экспорта в форматы **DOCX** и **Searchable PDF** с активными гиперссылками.

---

## 1. Системные требования и установка

### 1.1. Node.js
Установите [Node.js LTS (v18, v20 или v22)](https://nodejs.org/) для Windows.
Проверка в командной строке:
```bash
node -v
npm -v
```

### 1.2. Установка официального драйвера Kyocera (KX Driver)
Для корректной работы WIA и TWAIN сканирования:
1. Загрузите официальный **KX Driver** или **KX V4 Driver** с сайта Kyocera для вашей модели МФУ (например, *ECOSYS M2040dn*, *TASKalfa 2554ci*, *FS-1025MFP*):
   - [Официальный центр поддержки Kyocera](https://www.kyoceradocumentsolutions.ru/download)
2. При установке выберите выборочную установку и обязательно отметьте компоненты:
   - **KX Driver**
   - **Kyocera TWAIN Driver**
   - **WIA Driver**
3. Если МФУ подключено по сети (LAN / Wi-Fi):
   - Откройте утилиту **Kyocera TWAIN Driver Settings** в меню Пуск.
   - Нажмите «Добавить», введите сетевой IP-адрес сканера и имя профиля (например `Kyocera Scanner`).
   - Нажмите «Тест связи» для подтверждения доступности.

### 1.3. Установка NAPS2 (Not Another PDF Scanner 2)
NAPS2 предоставляет мощную и бесплатную консольную утилиту `NAPS2.Console`, которая стабильно взаимодействует с WIA/TWAIN драйверами Kyocera без графического окна:
1. Скачайте инсталлятор с официального сайта: [https://www.naps2.com/download](https://www.naps2.com/download)
2. При установке убедитесь, что путь `C:\Program Files\NAPS2` добавлен в системную переменную `PATH`, либо приложение автоматически найдет исполняемый файл по стандартному пути.

### 1.4. Языковые модели Tesseract OCR (Офлайн rus + eng)
Приложение использует `tesseract.js`. Чтобы приложение работало полностью автономно без подключения к интернету:
1. Скачайте языковые модели:
   - `rus.traineddata`
   - `eng.traineddata`
   из официального репозитория [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast).
2. Поместите оба файла в локальную папку проекта `./tessdata/`.

---

## 2. Проверка сканера через NAPS2 CLI (Командная строка)

Перед запуском сервера проверьте, что Windows и NAPS2 видят ваше МФУ Kyocera.

### Список доступных сканеров:
```bash
naps2.console --list
```
*Пример вывода:*
```text
Kyocera ECOSYS M2040dn KX (WIA)
Kyocera TASKalfa 2554ci (TWAIN)
```

### Тестовое сканирование страницы со стекла (Flatbed, 300 DPI, цветное):
```bash
naps2.console -o "test_scan.png" --device "Kyocera ECOSYS M2040dn KX (WIA)" --dpi 300 --pagesize a4 --bitdepth 24 --source flatbed
```

### Тестовое сканирование из автоподатчика документов (ADF / Feeder):
```bash
naps2.console -o "test_adf.png" --device "Kyocera ECOSYS M2040dn KX (WIA)" --dpi 300 --pagesize a4 --source feeder
```

---

## 3. Запуск приложения

```bash
# 1. Перейдите в папку проекта
cd kyocera-scanner-ocr

# 2. Установите зависимости npm
npm install

# 3. Запустите локальный сервер
npm start

# Для режима разработки с автоперезагрузкой:
npm run dev
```

Откройте браузер по адресу: **`http://localhost:3000`**

---

## 4. Структура проекта

```text
kyocera-scanner-ocr/
├── server.js               # Главный файл Express сервера (localhost:3000)
├── package.json            # Зависимости и скрипты
├── routes/
│   ├── scan.js             # /api/devices, /api/scan, /api/upload
│   ├── ocr.js              # /api/ocr (Tesseract.js worker)
│   └── export.js           # /api/export/docx, /api/export/pdf, /api/download/:file
├── services/
│   ├── wiaService.js       # Обертка вызова NAPS2.Console CLI
│   ├── ocrService.js       # Tesseract.js OCR, парсинг TSV/координат и ссылок
│   ├── docxService.js      # Генератор Word с реальными ссылками ExternalHyperlink
│   └── pdfService.js       # Генератор Searchable PDF (слой 3 Tr + Link Annotations)
├── public/
│   ├── index.html          # Разметка десктопного интерфейса
│   ├── style.css           # Тёмная и светлая темы, стили холста и редактора
│   └── app.js              # Клиентская логика, Canvas превью, OCR рамки
├── scans/                  # Временные исходные файлы сканирования
├── output/                 # Сгенерированные готовые DOCX и PDF документы
├── logs/                   # Логи приложения (app.log)
└── tessdata/               # Офлайн языковые модели rus.traineddata, eng.traineddata
```

---

## 5. Типичные проблемы и решения

### Проблема 1: Сканер Kyocera не отображается в списке `naps2.console --list`
- **Причина 1**: Не установлен официальный драйвер Kyocera KX или служба WIA отключена.
  - *Решение*: Откройте `services.msc` в Windows, найдите службу **«Служба загрузки изображений Windows (WIA)»** (Windows Image Acquisition), убедитесь, что тип запуска — «Автоматически», и состояние — «Выполняется».
- **Причина 2**: МФУ подключено по сети, но IP-адрес изменился.
  - *Решение*: Запустите «Kyocera TWAIN Driver Setup», проверьте текущий IP МФУ и выполните «Тест».

### Проблема 2: Ошибка «tessdata/rus.traineddata not found» при отсутствии интернета
- **Причина**: По умолчанию `tesseract.js` пытается загрузить языковой пакет из CDN при первом запуске.
  - *Решение*: Скачайте `rus.traineddata` и `eng.traineddata` вручную и положите в папку `./tessdata/`. Сервер сконфигурирован на чтение из локального кэша.

### Проблема 3: В некоторых PDF-просмотрщиках не кликаются ссылки
- **Причина**: Разные просмотрщики (Adobe Acrobat Reader, Foxit, встроенный просмотрщик Chrome/Edge) имеют разные требования к аннотациям ссылок:
  - В приложении ссылки генерируются через стандартный спецификационный объект PDF: `Subtype: 'Link'`, с действием `Action -> S: 'URI'` и правильным прямоугольником координат `Rect: [llx, lly, urx, ury]`.
  - Убедитесь, что в Adobe Reader включена опция «Создавать ссылки из URL-адресов» (Правка -> Установки -> Общие).

### Проблема 4: Смещение невидимого текста относительно изображения
- **Причина**: Разница в разрешении DPI исходного скана и точек PDF (72 pt / inch).
  - *Решение*: В `services/pdfService.js` реализован динамический расчет масштабных коэффициентов:
    `scaleX = pageWidth / imageWidth`, `scaleY = pageHeight / imageHeight`, что гарантирует совпадение текста и изображения при любых DPI (150, 300, 600).
