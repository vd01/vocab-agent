import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';

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

export interface EnvConfig {
  openaiApiKey: string;
  openaiBaseUrl: string;
  teacherModel: string;
  developerModel: string;
  authPassword: string;
}

export interface AppConfig {
  mode: 'local' | 'remote';
  local: LocalConfig;
  remote: RemoteConfig;
  window: WindowConfig;
  notification: NotificationConfig;
  env: EnvConfig;
}

const defaults: AppConfig = {
  mode: 'local',
  local: { port: 3088 },
  remote: { url: '' },
  window: { shortcut: 'Super+Shift+V', closeToTray: true },
  notification: { reviewReminder: true, reminderInterval: 30 },
  env: {
    openaiApiKey: '',
    openaiBaseUrl: '',
    teacherModel: 'gpt-4o-mini',
    developerModel: 'deepseek-reasoner',
    authPassword: '',
  },
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function readStore(): AppConfig {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) return { ...defaults };
    const data = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(data);
    return deepMerge(defaults, parsed);
  } catch {
    return { ...defaults };
  }
}

function writeStore(config: AppConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = readStore();
    if (!cachedConfig.env || (!cachedConfig.env.openaiApiKey && !cachedConfig.env.openaiBaseUrl && !cachedConfig.env.authPassword)) {
      migrateFromEnvLocal(cachedConfig);
    }
  }
  return cachedConfig;
}

function migrateFromEnvLocal(cfg: AppConfig): void {
  const envPaths = [
    path.resolve(app.getAppPath(), '..', '.env.local'),
    path.resolve(app.getAppPath(), '..', '..', '.env.local'),
  ];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf-8');
    const parsed: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      parsed[key] = val;
    }
    if (Object.keys(parsed).length === 0) continue;
    cfg.env = {
      openaiApiKey: parsed.OPENAI_API_KEY || cfg.env?.openaiApiKey || '',
      openaiBaseUrl: parsed.OPENAI_BASE_URL || cfg.env?.openaiBaseUrl || '',
      teacherModel: parsed.TEACHER_MODEL || cfg.env?.teacherModel || 'gpt-4o-mini',
      developerModel: parsed.DEVELOPER_MODEL || cfg.env?.developerModel || 'deepseek-reasoner',
      authPassword: parsed.AUTH_PASSWORD || cfg.env?.authPassword || '',
    };
    writeStore(cfg);
    cachedConfig = cfg;
    console.log('[Store] Migrated .env.local settings to config');
    return;
  }
}

export function setConfig(partial: Partial<AppConfig>): AppConfig {
  const current = getConfig();
  const merged = deepMerge(current, partial) as AppConfig;
  writeStore(merged);
  cachedConfig = merged;
  return merged;
}

export function getRemotePassword(): string | undefined {
  const enc = getConfig().remote.encryptedPassword;
  return enc || undefined;
}

export function setRemotePassword(password: string): void {
  let stored: string;
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(password);
    stored = encrypted.toString('base64');
  } else {
    stored = password;
  }
  setConfig({ remote: { ...getConfig().remote, encryptedPassword: stored } });
}

export function clearRemotePassword(): void {
  const cfg = getConfig();
  const newRemote = { ...cfg.remote };
  delete newRemote.encryptedPassword;
  const merged = { ...cfg, remote: newRemote };
  writeStore(merged);
  cachedConfig = merged;
}

export function decryptRemotePassword(): string | undefined {
  const enc = getConfig().remote.encryptedPassword;
  if (!enc) return undefined;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    }
    return enc;
  } catch {
    return undefined;
  }
}
