import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('config:set', config),
  getMode: () => ipcRenderer.invoke('mode:get'),
  switchMode: (mode: 'local' | 'remote') => ipcRenderer.invoke('mode:switch', mode),
  saveRemotePassword: (password: string) => ipcRenderer.invoke('remote:save-password', password),
  clearRemotePassword: () => ipcRenderer.invoke('remote:clear-password'),
  registerShortcut: (shortcut: string) => ipcRenderer.invoke('shortcut:register', shortcut),
  onServerStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('server:status', (_e, status) => callback(status));
  },
  onNotificationClick: (callback: () => void) => {
    ipcRenderer.on('notification:click', () => callback());
  },
  isElectron: true,
});
