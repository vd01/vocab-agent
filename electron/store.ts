import Store from 'electron-store';

export interface LocalConfig {
  port: number;
}

export interface RemoteConfig {
  url: string;
  encryptedPassword?: string;
}

export interface WindowConfig {
  shortcut: string;
  closeToTray: boolean;
}

export interface NotificationConfig {
  reviewReminder: boolean;
  reminderInterval: number;
}

export interface AppConfig {
  mode: 'local' | 'remote';
  local: LocalConfig;
  remote: RemoteConfig;
  window: WindowConfig;
  notification: NotificationConfig;
}

const defaults: AppConfig = {
  mode: 'local',
  local: { port: 3088 },
  remote: { url: '' },
  window: { shortcut: 'Super+Shift+V', closeToTray: true },
  notification: { reviewReminder: true, reminderInterval: 30 },
};

let store: Store<AppConfig> | null = null;

export function getStore(): Store<AppConfig> {
  if (!store) {
    store = new Store<AppConfig>({
      defaults,
      encryptionKey: 'vocab-agent-electron-store-key',
    });
  }
  return store;
}

export function getConfig(): AppConfig {
  return getStore().store as AppConfig;
}

export function setConfig(partial: Partial<AppConfig>): AppConfig {
  const s = getStore();
  for (const [key, value] of Object.entries(partial)) {
    s.set(key as keyof AppConfig, value);
  }
  return s.store as AppConfig;
}

export function getRemotePassword(): string | undefined {
  const enc = getStore().get('remote.encryptedPassword') as string | undefined;
  return enc || undefined;
}

export function setRemotePassword(password: string): void {
  const { safeStorage } = require('electron');
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(password);
    getStore().set('remote.encryptedPassword' as keyof AppConfig, encrypted.toString('base64'));
  } else {
    getStore().set('remote.encryptedPassword' as keyof AppConfig, password);
  }
}

export function clearRemotePassword(): void {
  getStore().delete('remote.encryptedPassword' as keyof AppConfig);
}

export function decryptRemotePassword(): string | undefined {
  const enc = getStore().get('remote.encryptedPassword') as string | undefined;
  if (!enc) return undefined;
  try {
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc as string, 'base64'));
    }
    return enc;
  } catch {
    return undefined;
  }
}
