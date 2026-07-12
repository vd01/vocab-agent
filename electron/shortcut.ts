import { globalShortcut, BrowserWindow } from 'electron';
import { getConfig, setConfig } from './store';
import { toggleMainWindow } from './windows';

let currentShortcut: string | null = null;

export function registerGlobalShortcut(shortcut?: string): boolean {
  unregisterGlobalShortcut();

  const accel = shortcut || getConfig().window.shortcut;

  try {
    const success = globalShortcut.register(accel, () => {
      toggleMainWindow();
    });

    if (success) {
      currentShortcut = accel;
      console.log(`[Shortcut] Registered: ${accel}`);
      return true;
    } else {
      console.warn(`[Shortcut] Failed to register: ${accel} (conflict)`);
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('shortcut:conflict', accel);
      });
      return false;
    }
  } catch (err) {
    console.error(`[Shortcut] Error registering ${accel}:`, err);
    return false;
  }
}

export function unregisterGlobalShortcut(): void {
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut);
    currentShortcut = null;
  }
}

export function updateShortcut(newShortcut: string): boolean {
  const success = registerGlobalShortcut(newShortcut);
  if (success) {
    setConfig({ window: { ...getConfig().window, shortcut: newShortcut } });
  }
  return success;
}

export function getCurrentShortcut(): string | null {
  return currentShortcut;
}
