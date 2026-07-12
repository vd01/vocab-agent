import { Notification, BrowserWindow } from 'electron';
import { getConfig } from './store';
import { showMainWindow } from './windows';

let reminderTimer: ReturnType<typeof setInterval> | null = null;

export function startReminder(): void {
  stopReminder();
  const config = getConfig();
  if (!config.notification.reviewReminder) return;

  const intervalMs = config.notification.reminderInterval * 60 * 1000;

  reminderTimer = setInterval(async () => {
    const currentConfig = getConfig();
    if (!currentConfig.notification.reviewReminder) return;

    try {
      const dueCount = await fetchDueCount(currentConfig);
      if (dueCount > 0) {
        const notification = new Notification({
          title: 'Vocab Agent 复习提醒',
          body: `你有 ${dueCount} 个单词待复习`,
          icon: getNotificationIcon(),
          silent: false,
        });

        notification.on('click', () => {
          showMainWindow();
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            const url = win.webContents.getURL();
            const base = new URL(url).origin;
            win.loadURL(`${base}/?command=/review`);
          }
        });

        notification.show();
      }
    } catch (err) {
      console.error('[Notification] Failed to check due count:', err);
    }
  }, intervalMs);

  checkNow();
}

export function stopReminder(): void {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

async function checkNow(): Promise<void> {
  const config = getConfig();
  if (!config.notification.reviewReminder) return;

  try {
    const dueCount = await fetchDueCount(config);
    if (dueCount > 0) {
      const notification = new Notification({
        title: 'Vocab Agent 复习提醒',
        body: `你有 ${dueCount} 个单词待复习`,
        icon: getNotificationIcon(),
        silent: true,
      });

      notification.on('click', () => {
        showMainWindow();
      });

      notification.show();
    }
  } catch {
    // silently fail on startup check
  }
}

async function fetchDueCount(config: ReturnType<typeof getConfig>): Promise<number> {
  let baseUrl: string;
  if (config.mode === 'local') {
    baseUrl = `http://localhost:${config.local.port}`;
  } else {
    baseUrl = config.remote.url.replace(/\/$/, '');
  }

  const res = await fetch(`${baseUrl}/api/review-due`, {
    headers: config.mode === 'remote' ? getRemoteHeaders(config) : {},
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.due ?? 0;
}

function getRemoteHeaders(config: ReturnType<typeof getConfig>): Record<string, string> {
  return {};
}

function getNotificationIcon(): string | undefined {
  return undefined;
}
