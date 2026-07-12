import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import path from 'path';
import { getConfig, setConfig } from './store';
import { showMainWindow, toggleMainWindow, destroyMainWindow } from './windows';
import { stopServer } from './server';

let tray: Tray | null = null;

function createTrayIcon(): Electron.NativeImage {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = size / 2;
      const cy = size / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < size / 2 - 1) {
        canvas[idx] = 59;
        canvas[idx + 1] = 130;
        canvas[idx + 2] = 246;
        canvas[idx + 3] = 255;
      } else {
        canvas[idx + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function buildContextMenu(): Menu {
  const config = getConfig();
  return Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => toggleMainWindow(),
    },
    { type: 'separator' },
    {
      label: '复习提醒',
      type: 'checkbox',
      checked: config.notification.reviewReminder,
      click: (item) => {
        setConfig({ notification: { ...config.notification, reviewReminder: item.checked } });
      },
    },
    { type: 'separator' },
    {
      label: '本地模式',
      type: 'radio',
      checked: config.mode === 'local',
      click: () => {
        if (config.mode !== 'local') {
          setConfig({ mode: 'local' });
          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send('mode:changed', 'local');
          });
          rebuildTrayMenu();
        }
      },
    },
    {
      label: '云端模式',
      type: 'radio',
      checked: config.mode === 'remote',
      click: () => {
        if (config.mode !== 'remote') {
          setConfig({ mode: 'remote' });
          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send('mode:changed', 'remote');
          });
          rebuildTrayMenu();
        }
      },
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        showMainWindow();
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          const url = win.webContents.getURL();
          const base = new URL(url).origin;
          win.loadURL(`${base}/settings`);
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: async () => {
        await stopServer();
        destroyMainWindow();
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);
}

function rebuildTrayMenu(): void {
  if (tray) {
    tray.setContextMenu(buildContextMenu());
  }
}

export function createTray(): Tray {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Vocab Agent');
  tray.setContextMenu(buildContextMenu());

  tray.on('click', () => {
    toggleMainWindow();
  });

  return tray;
}

export function getTray(): Tray | null {
  return tray;
}

export { rebuildTrayMenu };
