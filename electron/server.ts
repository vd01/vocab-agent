import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import { BrowserWindow } from 'electron';
import net from 'net';
import { getConfig } from './store';

let serverProcess: ChildProcess | null = null;
let statusCallback: ((status: string) => void) | null = null;

export function onServerStatus(cb: (status: string) => void): void {
  statusCallback = cb;
}

function emitStatus(status: string): void {
  statusCallback?.(status);
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('server:status', status);
  });
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
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

export async function startServer(isDev: boolean): Promise<number> {
  const config = getConfig();
  const port = await findAvailablePort(config.local.port);

  const cwd = app.getAppPath();
  const cmd = isDev ? 'next' : 'next';
  const args = isDev
    ? ['dev', '--turbopack', '-p', String(port)]
    : ['start', '-p', String(port)];

  emitStatus('starting');

  serverProcess = spawn('cmd', ['/c', cmd, ...args], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

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
      serverProcess.kill();
    } catch {
      // process may have already exited
    }

    setTimeout(() => {
      if (!killed && pid) {
        try {
          process.kill(pid);
        } catch {
          // ignore
        }
      }
      serverProcess = null;
      resolve();
    }, 5000);
  });
}
