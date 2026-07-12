import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { createMainWindow, showMainWindow, toggleMainWindow, destroyMainWindow } from './windows';
import { startServer, stopServer } from './server';
import { createTray, rebuildTrayMenu } from './tray';
import { registerGlobalShortcut, unregisterGlobalShortcut, updateShortcut } from './shortcut';
import { startReminder, stopReminder } from './notification';
import { autoLogin, performRemoteLogin } from './auto-login';
import { getConfig, setConfig, setRemotePassword, clearRemotePassword, decryptRemotePassword } from './store';

const isDev = process.env.ELECTRON_DEV === '1';

let currentUrl: string | null = null;

app.requestSingleInstanceLock();
app.on('second-instance', () => {
  showMainWindow();
});

app.on('window-all-closed', () => {
  // prevent default — we manage close behavior in windows.ts
});

app.whenReady().then(async () => {
  const config = getConfig();

  if (config.mode === 'local') {
    try {
      const port = await startServer(isDev);
      currentUrl = `http://localhost:${port}`;
    } catch (err) {
      dialog.showErrorBox('启动失败', `本地服务启动失败: ${err}`);
      app.quit();
      return;
    }
  } else {
    if (!config.remote.url) {
      dialog.showErrorBox('配置错误', '云端模式未设置远程地址，请切换到本地模式或设置远程 URL');
      app.quit();
      return;
    }
    currentUrl = config.remote.url.replace(/\/$/, '');
  }

  const win = createMainWindow(currentUrl);

  if (config.mode === 'remote') {
    await autoLogin(win);
    win.loadURL(currentUrl);
  }

  createTray();
  registerGlobalShortcut();
  startReminder();

  setupIpcHandlers();
});

app.on('before-quit', async () => {
  unregisterGlobalShortcut();
  stopReminder();
  await stopServer();
});

app.on('will-quit', () => {
  unregisterGlobalShortcut();
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

    setConfig({ mode });

    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    if (mode === 'local') {
      try {
        const port = await startServer(isDev);
        currentUrl = `http://localhost:${port}`;
      } catch (err) {
        win.webContents.send('server:status', 'error');
        return;
      }
    } else {
      await stopServer();
      const newConfig = getConfig();
      if (!newConfig.remote.url) return;
      currentUrl = newConfig.remote.url.replace(/\/$/, '');
      await autoLogin(win);
    }

    win.loadURL(currentUrl);
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
}
