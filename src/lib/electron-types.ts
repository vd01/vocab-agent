export interface ElectronAPI {
  getConfig: () => Promise<AppConfig>;
  setConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  getMode: () => Promise<'local' | 'remote'>;
  switchMode: (mode: 'local' | 'remote') => Promise<void>;
  saveRemotePassword: (password: string) => Promise<void>;
  clearRemotePassword: () => Promise<void>;
  registerShortcut: (shortcut: string) => Promise<boolean>;
  onServerStatus: (callback: (status: string) => void) => void;
  onNotificationClick: (callback: () => void) => void;
  isElectron: boolean;
}

export interface AppConfig {
  mode: 'local' | 'remote';
  local: { port: number };
  remote: { url: string; encryptedPassword?: string };
  window: { shortcut: string; closeToTray: boolean };
  notification: { reviewReminder: boolean; reminderInterval: number };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
