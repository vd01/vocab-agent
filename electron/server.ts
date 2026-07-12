import { spawn, ChildProcess, execSync } from 'child_process';
import { app, BrowserWindow } from 'electron';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { getConfig } from './store';

let serverProcess: ChildProcess | null = null;
let serverPid: number | null = null;
let watchdogProcess: ChildProcess | null = null;
let statusCallback: ((status: string) => void) | null = null;

function getPidFilePath(): string {
  return path.join(app.getPath('temp'), 'vocab-agent-next.pid');
}

function savePid(pid: number): void {
  serverPid = pid;
  try {
    fs.writeFileSync(getPidFilePath(), String(pid), 'utf-8');
  } catch {}
}

function readPid(): number | null {
  try {
    const pidFile = getPidFilePath();
    if (!fs.existsSync(pidFile)) return null;
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function clearPid(): void {
  serverPid = null;
  try {
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {}
}

export function killStaleServer(): void {
  const pid = readPid();
  if (!pid) return;
  try {
    process.kill(pid, 0);
  } catch {
    clearPid();
    return;
  }
  console.log(`[Server] Killing stale Next.js process (PID ${pid})`);
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 9);
    }
  } catch {}
  clearPid();
}

function startWatchdog(nextPid: number): void {
  if (watchdogProcess) return;
  const script = `
const net = require('net');
const { execSync } = require('child_process');
const fs = require('fs');
const pidFile = process.argv[1];
const nextPid = parseInt(process.argv[2], 10);
const electronPid = process.argv[3] ? parseInt(process.argv[3], 10) : 0;

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killNext() {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /PID ' + nextPid + ' /T /F', { stdio: 'ignore' });
    } else {
      process.kill(nextPid, 9);
    }
  } catch {}
  try { fs.unlinkSync(pidFile); } catch {}
  process.exit(0);
}

if (!isAlive(nextPid)) { process.exit(0); }

setInterval(() => {
  if (electronPid && !isAlive(electronPid)) {
    killNext();
  }
  if (!isAlive(nextPid)) {
    try { fs.unlinkSync(pidFile); } catch {}
    process.exit(0);
  }
}, 2000);
`;
  const scriptPath = path.join(app.getPath('temp'), 'vocab-agent-watchdog.js');
  try {
    fs.writeFileSync(scriptPath, script, 'utf-8');
    watchdogProcess = spawn(process.execPath, [scriptPath, getPidFilePath(), String(nextPid), String(process.pid)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    watchdogProcess.unref();
    console.log(`[Server] Watchdog started (watching Next PID ${nextPid}, Electron PID ${process.pid})`);
  } catch (err) {
    console.error('[Server] Failed to start watchdog:', err);
  }
}

function stopWatchdog(): void {
  if (!watchdogProcess) return;
  try {
    watchdogProcess.kill();
  } catch {}
  watchdogProcess = null;
}

export function onServerStatus(cb: (status: string) => void): void {
  statusCallback = cb;
}

function emitStatus(status: string): void {
  statusCallback?.(status);
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('server:status', status);
  });
}

function buildEnvOverrides(): Record<string, string> {
  const env = getConfig().env;
  const overrides: Record<string, string> = {};
  if (env.openaiApiKey) overrides.OPENAI_API_KEY = env.openaiApiKey;
  if (env.openaiBaseUrl) overrides.OPENAI_BASE_URL = env.openaiBaseUrl;
  if (env.teacherModel) overrides.TEACHER_MODEL = env.teacherModel;
  if (env.developerModel) overrides.DEVELOPER_MODEL = env.developerModel;
  if (env.authPassword) overrides.AUTH_PASSWORD = env.authPassword;
  return overrides;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let checked = 0;
    const total = 2;
    let available = true;

    function checkHost(host: string) {
      const server = net.createServer();
      server.once('error', () => {
        available = false;
        checked++;
        if (checked >= total) resolve(available);
      });
      server.once('listening', () => {
        server.close();
        checked++;
        if (checked >= total) resolve(available);
      });
      server.listen(port, host);
    }

    checkHost('127.0.0.1');
    checkHost('::1');
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
    if (port > startPort + 100) {
      throw new Error(`No available port found in range ${startPort}-${startPort + 100}`);
    }
  }
  return port;
}

function healthCheck(port: number, timeout = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = net.createConnection({ host: '127.0.0.1', port }, () => {
        req.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Server health check timed out after ${timeout}ms`));
        } else {
          setTimeout(check, 2000);
        }
      });
      req.setTimeout(3000, () => {
        req.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Server health check timed out after ${timeout}ms`));
        } else {
          setTimeout(check, 2000);
        }
      });
    };
    check();
  });
}

function findNodeExe(): string | null {
  if (process.platform !== 'win32') {
    try {
      const which = execSync('which node', { encoding: 'utf-8' }).trim();
      if (which) return which;
    } catch {}
    return null;
  }
  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const p of paths) {
    const nodePath = path.join(p, 'node.exe');
    if (fs.existsSync(nodePath)) return nodePath;
  }
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const searchDirs = [
    path.join(programFiles, 'nodejs'),
    path.join(programFilesX86, 'nodejs'),
    localAppData ? path.join(localAppData, 'Programs', 'nodejs') : '',
  ].filter(Boolean);
  for (const dir of searchDirs) {
    const nodePath = path.join(dir, 'node.exe');
    if (fs.existsSync(nodePath)) return nodePath;
  }
  return null;
}

export async function startServer(isDev: boolean, isPreview: boolean): Promise<number> {
  const config = getConfig();
  const port = await findAvailablePort(config.local.port);

  const cwd = (isDev || isPreview) ? path.resolve(app.getAppPath(), '..') : path.dirname(app.getPath('exe'));

  killStaleServer();

  const envOverrides = buildEnvOverrides();
  const env = { ...process.env, PORT: String(port), ...envOverrides };

  emitStatus('starting');

  const nextScript = path.join(cwd, 'node_modules', 'next', 'dist', 'bin', 'next');
  const args = isDev
    ? [nextScript, 'dev', '--turbopack', '-p', String(port)]
    : [nextScript, 'start', '-p', String(port)];

  const nodeExe = (isDev || isPreview) ? process.execPath : findNodeExe();
  if (!nodeExe) {
    throw new Error('未找到 Node.js，请确认已安装 Node.js 20+ 并添加到 PATH');
  }

  serverProcess = spawn(nodeExe, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (serverProcess.pid) {
    savePid(serverProcess.pid);
    startWatchdog(serverProcess.pid);
  }

  serverProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Next.js] ${msg}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[Next.js] ${msg}`);
  });

  serverProcess.on('error', (err) => {
    console.error('[Server] Process error:', err);
    emitStatus('error');
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[Server] Process exited with code ${code}`);
      emitStatus('error');
    }
    serverProcess = null;
    clearPid();
  });

  try {
    await healthCheck(port);
    emitStatus('ready');
    return port;
  } catch (err) {
    emitStatus('error');
    throw err;
  }
}

export function stopServer(): Promise<void> {
  stopWatchdog();
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    const pid = serverProcess.pid;
    let killed = false;

    serverProcess.on('exit', () => {
      killed = true;
      serverProcess = null;
      resolve();
    });

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch {
      // process may have already exited
    }

    setTimeout(() => {
      if (!killed && pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          } else {
            process.kill(pid, 9);
          }
        } catch {
          // ignore
        }
      }
      serverProcess = null;
      resolve();
    }, 3000);
  });
}

export function forceKillServer(): void {
  stopWatchdog();
  const pid = serverProcess?.pid || serverPid || readPid();
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 9);
    }
  } catch {}
  serverProcess = null;
  clearPid();
}
