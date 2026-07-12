import { spawn, ChildProcess, execSync } from 'child_process';
import { app, BrowserWindow } from 'electron';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { getConfig } from './store';

let serverProcess: ChildProcess | null = null;
let statusCallback: ((status: string) => void) | null = null;

function getPidFilePath(): string {
  return path.join(app.getPath('temp'), 'vocab-agent-next.pid');
}

function savePid(pid: number): void {
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
  try {
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {}
}

function killByPid(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 9);
    }
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
  killByPid(pid);
  clearPid();
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
  const dataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  overrides.VOCAB_DATA_DIR = dataDir;
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

function healthCheck(port: number, timeout = 60000): Promise<void> {
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
      return execSync('which node', { encoding: 'utf-8' }).trim() || null;
    } catch { return null; }
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

async function runMigrate(cwd: string): Promise<void> {
  const dataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'vocab.db');

  if (!fs.existsSync(dbPath)) {
    const oldDbPath = path.join(cwd, 'data', 'vocab.db');
    if (fs.existsSync(oldDbPath)) {
      console.log(`[Server] Migrating database from ${oldDbPath} to ${dbPath}`);
      try {
        fs.copyFileSync(oldDbPath, dbPath);
        const oldEcdict = path.join(cwd, 'data', 'ecdict.db');
        if (fs.existsSync(oldEcdict)) {
          fs.copyFileSync(oldEcdict, path.join(dataDir, 'ecdict.db'));
        }
      } catch (err) {
        console.error('[Server] Failed to migrate database:', err);
      }
    }
  }

  try {
    const { createClient } = require('@libsql/client');
    const client = createClient({ url: `file:${dbPath}` });

    await client.execute(`CREATE TABLE IF NOT EXISTS words (id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, phonetic TEXT, definition TEXT NOT NULL, examples TEXT, source TEXT, tag TEXT, collins INTEGER, bnc INTEGER, frq INTEGER, exchange TEXT, created_at INTEGER NOT NULL)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, word_id TEXT NOT NULL REFERENCES words(id), rating INTEGER NOT NULL, state INTEGER NOT NULL, due INTEGER NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL, elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL, last_review INTEGER, reviewed_at INTEGER NOT NULL)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_reviews_word_id ON reviews(word_id)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(due)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, parts TEXT, agent_type TEXT, seq INTEGER NOT NULL UNIQUE, created_at INTEGER NOT NULL)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS dynamic_commands (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, tool_code TEXT NOT NULL, component_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS dynamic_extractors (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, script_code TEXT NOT NULL, output_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS developer_lessons (id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, context TEXT, created_at INTEGER NOT NULL)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS pinned_words (id TEXT PRIMARY KEY, word_id TEXT NOT NULL REFERENCES words(id), word TEXT NOT NULL, phonetic TEXT, definition TEXT, position INTEGER NOT NULL, side TEXT NOT NULL, rich_content TEXT, created_at INTEGER NOT NULL)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_pinned_words_side ON pinned_words(side)`);

    try {
      const cols = await client.execute(`PRAGMA table_info(chat_messages)`);
      const hasSeq = cols.rows.some((r: any) => r.name === 'seq');
      if (!hasSeq) {
        await client.execute(`ALTER TABLE chat_messages ADD COLUMN seq INTEGER`);
        await client.execute(`UPDATE chat_messages SET seq = rowid WHERE seq IS NULL`);
      }
    } catch {}

    try {
      const cols = await client.execute(`PRAGMA table_info(pinned_words)`);
      const hasArchivedAt = cols.rows.some((r: any) => r.name === 'archived_at');
      if (!hasArchivedAt) {
        await client.execute(`ALTER TABLE pinned_words ADD COLUMN archived_at INTEGER`);
      }
    } catch {}

    client.close();
    console.log('[Server] Migrations complete');
  } catch (err) {
    console.error('[Server] Migration error:', err);
  }
}

export async function startServer(isDev: boolean, isPreview: boolean): Promise<number> {
  const config = getConfig();
  const port = await findAvailablePort(config.local.port);

  let cwd: string;
  if (isDev || isPreview) {
    cwd = path.resolve(app.getAppPath(), '..');
  } else {
    const exeDir = path.dirname(app.getPath('exe'));
    cwd = path.join(exeDir, 'resources', 'app');
  }

  killStaleServer();

  await runMigrate(cwd);

  const envOverrides = buildEnvOverrides();
  const nodeExe = (isDev || isPreview) ? process.execPath : findNodeExe();
  if (!nodeExe) {
    throw new Error('未找到 Node.js，请确认已安装 Node.js 20+ 并添加到 PATH');
  }

  const spawnEnv = { ...process.env, PORT: String(port), ...envOverrides } as Record<string, string>;
  const nodeDir = path.dirname(nodeExe);
  if (nodeDir && !(spawnEnv.PATH || '').split(path.delimiter).includes(nodeDir)) {
    spawnEnv.PATH = nodeDir + path.delimiter + (spawnEnv.PATH || '');
  }

  emitStatus('starting');

  const nextScript = path.join(cwd, 'node_modules', 'next', 'dist', 'bin', 'next');
  const args = isDev
    ? [nextScript, 'dev', '--turbopack', '-p', String(port)]
    : [nextScript, 'start', '-p', String(port)];

  console.log(`[Server] Starting: ${nodeExe} ${args.join(' ')}`);
  console.log(`[Server] cwd: ${cwd}`);
  console.log(`[Server] getAppPath: ${app.getAppPath()}`);
  console.log(`[Server] exePath: ${app.getPath('exe')}`);
  console.log(`[Server] PATH includes nodejs: ${!!(process.env.PATH || '').includes('nodejs')}`);

  const logPath = path.join(app.getPath('userData'), 'server.log');
  let logStream: fs.WriteStream | null = null;
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'w' });
  } catch {}
  function log(msg: string) {
    console.log(msg);
    logStream?.write(msg + '\n');
  }

  serverProcess = spawn(nodeExe, args, {
    cwd,
    env: spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (serverProcess.pid) {
    savePid(serverProcess.pid);
    log(`[Server] PID: ${serverProcess.pid}`);
  }

  serverProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log(`[Next.js] ${msg}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log(`[Next.js err] ${msg}`);
  });

  serverProcess.on('error', (err) => {
    log(`[Server] Process error: ${err}`);
    emitStatus('error');
  });

  serverProcess.on('exit', (code, signal) => {
    log(`[Server] Process exited with code=${code} signal=${signal}`);
    if (code !== 0 && code !== null) {
      emitStatus('error');
    }
    serverProcess = null;
    clearPid();
    logStream?.end();
    logStream = null;
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
  return new Promise((resolve) => {
    if (!serverProcess) {
      clearPid();
      resolve();
      return;
    }

    const pid = serverProcess.pid!;
    let killed = false;

    serverProcess.on('exit', () => {
      killed = true;
      serverProcess = null;
      clearPid();
      resolve();
    });

    try {
      killByPid(pid);
    } catch {}

    setTimeout(() => {
      if (!killed && pid) {
        try { killByPid(pid); } catch {}
      }
      serverProcess = null;
      clearPid();
      resolve();
    }, 3000);
  });
}

export function forceKillServer(): void {
  const pid = serverProcess?.pid || readPid();
  if (!pid) return;
  killByPid(pid);
  serverProcess = null;
  clearPid();
}
