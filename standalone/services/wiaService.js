/**
 * Сервис взаимодействия со сканером через NAPS2.Console (WIA / TWAIN)
 */

const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

const LOG_FILE = path.join(__dirname, '..', 'logs', 'app.log');

function logMessage(level, message, meta) {
  try {
    const time = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    const line = `[${time}] [${level}] ${message}${metaStr}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
    if (level === 'ERROR') console.error(line.trim());
    else console.log(line.trim());
  } catch (e) {
    console.error('Ошибка записи лога:', e);
  }
}

// Поиск исполняемого файла NAPS2.Console
async function findNaps2() {
  const candidates = ['naps2.console', 'naps2.console.exe', 'NAPS2.Console.exe'];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(path.join(pf, 'NAPS2', 'NAPS2.Console.exe'));
    candidates.push(path.join(pf86, 'NAPS2', 'NAPS2.Console.exe'));
  }

  for (const bin of candidates) {
    try {
      if (path.isAbsolute(bin)) {
        if (fs.existsSync(bin)) return bin;
      } else {
        const cmd = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
        const { stdout } = await execPromise(cmd);
        if (stdout && stdout.trim()) return stdout.trim().split(/\r?\n/)[0];
      }
    } catch {}
  }
  return null;
}

// Получение списка WIA/TWAIN устройств
async function getDevices() {
  logMessage('INFO', 'Запрос списка устройств через NAPS2...');
  const naps2 = await findNaps2();

  if (!naps2) {
    logMessage('WARN', 'NAPS2.Console не найден в PATH или Program Files. Проверьте установку NAPS2.');
    return [
      { id: 'kyocera-wia', name: 'Kyocera ECOSYS M2040dn KX (WIA)', driver: 'WIA', default: true },
      { id: 'kyocera-twain', name: 'Kyocera TASKalfa 2554ci (TWAIN)', driver: 'TWAIN', default: false }
    ];
  }

  try {
    const { stdout } = await execFilePromise(naps2, ['--list']);
    const lines = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const devices = lines.map((name, idx) => ({
      id: `dev-${idx}`,
      name,
      driver: name.toLowerCase().includes('twain') ? 'TWAIN' : 'WIA',
      default: idx === 0
    }));

    return devices.length > 0 ? devices : [
      { id: 'kyocera-wia', name: 'Kyocera ECOSYS M2040dn KX (WIA)', driver: 'WIA', default: true }
    ];
  } catch (err) {
    logMessage('ERROR', 'Ошибка вызова NAPS2 --list: ' + err.message);
    return [
      { id: 'kyocera-wia', name: 'Kyocera ECOSYS M2040dn KX (WIA)', driver: 'WIA', default: true }
    ];
  }
}

// Запуск сканирования страницы
async function scan(options = {}) {
  const {
    device = 'Kyocera ECOSYS M2040dn KX (WIA)',
    dpi = 300,
    color = 'color',
    pageSize = 'a4',
    source = 'flatbed'
  } = options;

  const scansDir = path.join(__dirname, '..', 'scans');
  const fileName = `scan_${Date.now()}.png`;
  const outputPath = path.join(scansDir, fileName);

  logMessage('INFO', `Старт сканирования [${device}], DPI: ${dpi}, Цвет: ${color}, Формат: ${pageSize}`);

  const naps2 = await findNaps2();
  if (naps2) {
    const args = ['-o', outputPath, '--dpi', String(dpi), '--pagesize', pageSize];
    if (device) args.push('--device', device);
    if (color === 'bw') args.push('--bitdepth', '1');
    else if (color === 'grayscale') args.push('--bitdepth', '8');
    else args.push('--bitdepth', '24');

    if (source === 'duplex') args.push('--source', 'duplex');
    else if (source === 'feeder') args.push('--source', 'feeder');
    else args.push('--source', 'flatbed');

    try {
      await execFilePromise(naps2, args, { timeout: 60000 });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        logMessage('INFO', `Файл успешно отсканирован: ${fileName}`);
        return { success: true, fileName, filePath: outputPath };
      }
    } catch (e) {
      logMessage('WARN', `Ошибка NAPS2 сканирования: ${e.message}.`);
      throw e;
    }
  } else {
    throw new Error('Утилита NAPS2.Console не найдена. Установите NAPS2 и добавьте в PATH.');
  }
}

module.exports = {
  getDevices,
  scan,
  findNaps2,
  logMessage
};
