import fs from 'fs';
import path from 'path';

const LOG_FILE = path.resolve(process.cwd(), 'logs', 'app.log');

export function logMessage(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: any) {
  try {
    const logsDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${metaStr}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
    if (level === 'ERROR') {
      console.error(line.trim());
    } else {
      console.log(line.trim());
    }
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

export function getLogs(lines = 100): string[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    return content.trim().split('\n').slice(-lines);
  } catch {
    return [];
  }
}
