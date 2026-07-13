import { app, BrowserWindow, ipcMain, dialog, net } from 'electron';
import { createMainWindow, showMainWindow, toggleMainWindow, destroyMainWindow } from './windows';
import { startServer, stopServer, forceKillServer, killStaleServer } from './server';
import { createTray, rebuildTrayMenu } from './tray';
import { registerGlobalShortcut, unregisterGlobalShortcut, updateShortcut } from './shortcut';
import { startReminder, stopReminder } from './notification';
import { autoLogin, performRemoteLogin } from './auto-login';
import { getConfig, setConfig, setRemotePassword, clearRemotePassword, decryptRemotePassword } from './store';
import path from 'path';

const isDev = process.env.ELECTRON_DEV === '1';
const isPreview = process.env.ELECTRON_PREVIEW === '1';

// Ignore SSL certificate errors in dev/preview mode (self-signed certs, etc.)
if (isDev || isPreview) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
}

let currentUrl: string | null = null;
let isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  forceKillServer();
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

app.on('window-all-closed', () => {
});

async function checkRemoteAvailable(url: string, timeout = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const request = net.request(url);
      const timer = setTimeout(() => {
        request.abort();
        resolve(false);
      }, timeout);
      request.on('response', (response) => {
        clearTimeout(timer);
        resolve(response.statusCode >= 200 && response.statusCode < 400);
      });
      request.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      request.end();
    } catch {
      resolve(false);
    }
  });
}

function getErrorPageUrl(remoteUrl: string): string {
  return `file://${path.join(__dirname, 'error-page.html').replace(/\\/g, '/')}?url=${encodeURIComponent(remoteUrl)}`;
}

app.whenReady().then(async () => {
  killStaleServer();

  const config = getConfig();

  if (config.mode === 'remote' && !config.remote.url) {
    console.warn('[Main] Remote mode with empty URL, falling back to local mode');
    setConfig({ mode: 'local' });
  }

  const effectiveConfig = getConfig();

  if (effectiveConfig.mode === 'local') {
    try {
      const port = await startServer(isDev, isPreview);
      currentUrl = `http://localhost:${port}`;
    } catch (err) {
      dialog.showErrorBox('启动失败', `本地服务启动失败: ${err}\n\n日志: ${path.join(app.getPath('userData'), 'server.log')}`);
      app.quit();
      return;
    }
  } else {
    currentUrl = effectiveConfig.remote.url.replace(/\/$/, '');
  }

  const win = createMainWindow(currentUrl);

  if (effectiveConfig.mode === 'remote') {
    const available = await checkRemoteAvailable(currentUrl);
    if (!available) {
      win.loadURL(getErrorPageUrl(currentUrl));
    } else {
      await autoLogin(win);
      win.loadURL(currentUrl);
    }
  }

  createTray();
  registerGlobalShortcut();
  startReminder();

  setupIpcHandlers();
});

app.on('before-quit', () => {
  if (isQuitting) return;
  isQuitting = true;
  unregisterGlobalShortcut();
  stopReminder();
  forceKillServer();
});

app.on('will-quit', () => {
  forceKillServer();
});

function setupIpcHandlers(): void {
  ipcMain.handle('config:get', () => {
    return getConfig();
  });

  ipcMain.handle('config:set', (_e, partial: Record<string, unknown>) => {
    const newConfig = setConfig(partial);
    rebuildTrayMenu();
    return newConfig;
  });

  ipcMain.handle('mode:get', () => {
    return getConfig().mode;
  });

  ipcMain.handle('mode:switch', async (_e, mode: 'local' | 'remote') => {
    const config = getConfig();
    if (config.mode === mode) return;

    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    if (mode === 'remote') {
      if (!config.remote.url) {
        win.webContents.send('mode:switch-error', '请先设置云端地址');
        return;
      }
      const url = config.remote.url.replace(/\/$/, '');
      const available = await checkRemoteAvailable(url);
      if (!available) {
        setConfig({ mode: 'remote' });
        currentUrl = url;
        win.loadURL(getErrorPageUrl(url));
        rebuildTrayMenu();
        return;
      }
      await stopServer();
      setConfig({ mode: 'remote' });
      currentUrl = url;
      await autoLogin(win);
      win.loadURL(currentUrl);
    } else {
      try {
        const port = await startServer(isDev, isPreview);
        setConfig({ mode: 'local' });
        currentUrl = `http://localhost:${port}`;
        win.loadURL(currentUrl);
      } catch (err) {
        win.webContents.send('server:status', 'error');
        return;
      }
    }

    rebuildTrayMenu();
  });

  ipcMain.handle('remote:save-password', async (_e, password: string) => {
    setRemotePassword(password);
    const win = BrowserWindow.getAllWindows()[0];
    if (win && getConfig().mode === 'remote') {
      await performRemoteLogin(win, password);
    }
  });

  ipcMain.handle('remote:clear-password', () => {
    clearRemotePassword();
  });

  ipcMain.handle('shortcut:register', (_e, shortcut: string) => {
    return updateShortcut(shortcut);
  });

  ipcMain.handle('env:restart-server', async () => {
    if (getConfig().mode !== 'local') return;
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    try {
      await stopServer();
      const port = await startServer(isDev, isPreview);
      currentUrl = `http://localhost:${port}`;
      win.loadURL(currentUrl);
    } catch (err) {
      win.webContents.send('server:status', 'error');
    }
  });
}
