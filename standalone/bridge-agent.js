/**
 * Kyocera Scanner Local Bridge (Агент локального сканирования для Vercel / Web)
 * Работает без npm install на чистом Node.js (http, child_process, fs, path)
 * Порт: 3000
 */

const http = require('http');
const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);
const PORT = 3000;

const SCANS_DIR = path.join(__dirname, 'scans');
if (!fs.existsSync(SCANS_DIR)) fs.mkdirSync(SCANS_DIR, { recursive: true });

async function findNaps2() {
  const candidates = ['naps2.console', 'naps2.console.exe'];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\NAPS2\\NAPS2.Console.exe');
    candidates.push('C:\\Program Files (x86)\\NAPS2\\NAPS2.Console.exe');
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

const server = http.createServer(async (req, res) => {
  // CORS & Chrome Private Network Access for Vercel HTTPS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. GET /api/devices
  if (req.method === 'GET' && url.pathname === '/api/devices') {
    const naps2 = await findNaps2();
    let devices = [];
    if (naps2) {
      try {
        const { stdout } = await execFilePromise(naps2, ['--list']);
        const lines = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        devices = lines.map((name, i) => ({
          id: `dev-${i}`,
          name,
          driverType: name.toLowerCase().includes('twain') ? 'TWAIN' : 'WIA',
          isDefault: i === 0,
          status: 'Ready'
        }));
      } catch {}
    }

    if (devices.length === 0) {
      devices = [
        { id: 'kyocera-default', name: 'Kyocera ECOSYS M2040dn KX (WIA)', driverType: 'WIA', isDefault: true, status: 'Ready' }
      ];
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      success: true,
      naps2Found: Boolean(naps2),
      binaryPath: naps2,
      devices
    }));
  }

  // 2. POST /api/scan
  if (req.method === 'POST' && url.pathname === '/api/scan') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const { deviceName, dpi = 300, colorMode = 'color', source = 'flatbed' } = data;
        const naps2 = await findNaps2();

        if (!naps2) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            success: false,
            error: 'NAPS2.Console не найден на компьютере. Установите NAPS2 с сайта https://www.naps2.com/'
          }));
        }

        const fileName = `scan_${Date.now()}.png`;
        const filePath = path.join(SCANS_DIR, fileName);

        const args = ['-o', filePath, '--dpi', String(dpi), '--pagesize', 'a4'];
        if (deviceName) args.push('--device', deviceName);
        if (colorMode === 'bw') args.push('--bitdepth', '1');
        else if (colorMode === 'grayscale') args.push('--bitdepth', '8');
        else args.push('--bitdepth', '24');

        if (source === 'duplex') args.push('--source', 'duplex');
        else if (source === 'feeder') args.push('--source', 'feeder');
        else args.push('--source', 'flatbed');

        console.log(`[SCAN] Запуск физического сканирования: ${naps2} ${args.join(' ')}`);
        await execFilePromise(naps2, args, { timeout: 90000 });

        let base64 = null;
        if (fs.existsSync(filePath)) {
          base64 = `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: true,
          file: fileName,
          base64,
          isSimulated: false
        }));
      } catch (err) {
        console.error(`[SCAN ERROR] ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 3. Fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`   KYOCERA SCANNER BRIDGE ЗАПУЩЕН НА ПОРТУ ${PORT}`);
  console.log('================================================================');
  console.log(' Веб-сайт на Vercel теперь может напрямую управлять сканером!');
  console.log(' Откройте https://school-scanner-ocr.vercel.app');
  console.log('================================================================');
});
