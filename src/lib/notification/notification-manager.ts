/**
 * NotificationManager — singleton that manages the ReviewScheduler lifecycle,
 * persists config to the backend API, and coordinates between UI and scheduler.
 *
 * Usage:
 *   const nm = NotificationManager.getInstance();
 *   await nm.init();          // load config from DB
 *   nm.setEnabled(true);     // enable notifications
 */

import { ReviewScheduler, type SchedulerConfig, DEFAULT_SCHEDULER_CONFIG } from './review-scheduler';
import { cachedFetch } from '@/lib/fetch-cache';

export type NotificationChangeCallback = (
  enabled: boolean,
  config: SchedulerConfig,
) => void;

class NotificationManager {
  private static instance: NotificationManager | null = null;
  private scheduler: ReviewScheduler;
  private config: SchedulerConfig;
  private initialized = false;
  private listeners: Set<NotificationChangeCallback> = new Set();
  private dueCountListeners: Set<(dueCount: number) => void> = new Set();

  private constructor() {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG };
    this.scheduler = new ReviewScheduler(this.config);
    this.scheduler.setOnDueWords((dueCount) => {
      this.dueCountListeners.forEach(cb => cb(dueCount));
    });
  }

  static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  /** Initialize: load saved config from DB and start scheduler if enabled */
  async init() {
    if (this.initialized) return;
    try {
      const data = await cachedFetch<{ settings: Record<string, string> }>('/api/settings?prefix=notification.');
      const saved = data.settings ?? {};
      this.config = {
        enabled: saved['notification.enabled'] === 'true',
        intervalMinutes: parseInt(saved['notification.intervalMinutes'] ?? '30', 10) || 30,
        quietHoursStart: parseInt(saved['notification.quietHoursStart'] ?? '22', 10),
        quietHoursEnd: parseInt(saved['notification.quietHoursEnd'] ?? '7', 10),
      };
      this.scheduler.updateConfig(this.config);
      if (this.config.enabled) {
        this.scheduler.start();
      }
    } catch (err) {
      console.error('[NotificationManager] Init failed:', err);
    }
    this.initialized = true;
  }

  /** Enable/disable notifications (also requests browser permission if enabling) */
  async setEnabled(enabled: boolean) {
    if (enabled) {
      const permission = await ReviewScheduler.requestPermission();
      if (permission !== 'granted') {
        // Permission denied — don't enable
        this.notifyListeners(false, this.config);
        return;
      }
    }

    this.config.enabled = enabled;
    this.scheduler.updateConfig(this.config);

    if (enabled) {
      this.scheduler.start();
    } else {
      this.scheduler.stop();
    }

    await this.saveConfig();
    this.notifyListeners(enabled, this.config);
  }

  /** Update config and persist */
  async updateConfig(patch: Partial<SchedulerConfig>) {
    this.config = { ...this.config, ...patch };
    this.scheduler.updateConfig(this.config);
    await this.saveConfig();
    this.notifyListeners(this.config.enabled, this.config);
  }

  /** Get current config */
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /** Get current due count (triggers a check) */
  async checkDueCount(): Promise<number> {
    return this.scheduler.checkNow();
  }

  /** Subscribe to config changes */
  onChange(cb: NotificationChangeCallback) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Subscribe to due words detection */
  onDueWords(cb: (dueCount: number) => void) {
    this.dueCountListeners.add(cb);
    return () => this.dueCountListeners.delete(cb);
  }

  private notifyListeners(enabled: boolean, config: SchedulerConfig) {
    this.listeners.forEach(cb => cb(enabled, config));
  }

  private async saveConfig() {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            'notification.enabled': String(this.config.enabled),
            'notification.intervalMinutes': String(this.config.intervalMinutes),
            'notification.quietHoursStart': String(this.config.quietHoursStart),
            'notification.quietHoursEnd': String(this.config.quietHoursEnd),
          },
        }),
      });
    } catch (err) {
      console.error('[NotificationManager] Save config failed:', err);
    }
  }
}

export { NotificationManager };
