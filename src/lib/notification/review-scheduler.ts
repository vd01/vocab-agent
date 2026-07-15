/**
 * ReviewScheduler — handles periodic polling for due words and
 * triggering notifications or in-app prompts.
 *
 * Designed for browser-side use (Web Notification API).
 * Runs entirely in the client — no Service Worker needed.
 */

export interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;       // polling interval, default 30
  quietHoursStart: number;       // 0-23, default 22 (10 PM)
  quietHoursEnd: number;         // 0-23, default 7 (7 AM)
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  intervalMinutes: 30,
  quietHoursStart: 22,
  quietHoursEnd: 7,
};

export type DueWordsCallback = (dueCount: number) => void;

export class ReviewScheduler {
  private config: SchedulerConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDueCount = 0;
  private lastNotifiedDueCount = 0;
  private onDueWords: DueWordsCallback | null = null;

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
  }

  /** Set callback for when due words are detected */
  setOnDueWords(cb: DueWordsCallback) {
    this.onDueWords = cb;
  }

  /** Update config and restart if running */
  updateConfig(patch: Partial<SchedulerConfig>) {
    this.config = { ...this.config, ...patch };
    if (this.timer) {
      this.stop();
      if (this.config.enabled) this.start();
    }
  }

  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /** Start polling */
  start() {
    this.stop();
    if (!this.config.enabled) return;

    // Check immediately on start
    this.check();

    // Then poll at interval
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => this.check(), intervalMs);
  }

  /** Stop polling */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Manual check (for UI triggers like page load) */
  async checkNow(): Promise<number> {
    return this.check();
  }

  private async check(): Promise<number> {
    if (!this.config.enabled) return 0;

    try {
      const dueCount = await this.fetchDueCount();
      this.lastDueCount = dueCount;

      if (dueCount > 0) {
        // Notify callback (for in-app prompt)
        this.onDueWords?.(dueCount);

        // Show browser notification only if:
        // 1. Not in quiet hours
        // 2. Due count changed since last notification (dedup)
        if (!this.isQuietHours() && dueCount !== this.lastNotifiedDueCount) {
          this.showBrowserNotification(dueCount);
          this.lastNotifiedDueCount = dueCount;
        }
      } else {
        // Reset dedup when no due words
        this.lastNotifiedDueCount = 0;
      }

      return dueCount;
    } catch (err) {
      console.error('[ReviewScheduler] Check failed:', err);
      return 0;
    }
  }

  private async fetchDueCount(): Promise<number> {
    const res = await fetch('/api/review-due');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.due ?? 0;
  }

  private isQuietHours(): boolean {
    const hour = new Date().getHours();
    const { quietHoursStart, quietHoursEnd } = this.config;

    if (quietHoursStart < quietHoursEnd) {
      // e.g. 1-6 (1 AM to 6 AM)
      return hour >= quietHoursStart && hour < quietHoursEnd;
    } else {
      // e.g. 22-7 (10 PM to 7 AM) — wraps midnight
      return hour >= quietHoursStart || hour < quietHoursEnd;
    }
  }

  private showBrowserNotification(dueCount: number) {
    // Use globalThis so it works in both browser and test environments
    const g = globalThis as any;
    if (!g.Notification) return;

    const permission = g.Notification.permission;
    if (permission !== 'granted') return;

    try {
      const notification = new g.Notification('📚 Vocab Agent 复习提醒', {
        body: `你有 ${dueCount} 个单词待复习`,
        icon: '/favicon.ico',
        tag: 'vocab-review-reminder', // replaces previous notification with same tag
      });

      notification.onclick = () => {
        g.window?.focus();
        // Dispatch custom event so app can handle it (e.g. trigger /review)
        g.window?.dispatchEvent(new CustomEvent('review-notification-click'));
        notification.close();
      };
    } catch (err) {
      console.error('[ReviewScheduler] Notification failed:', err);
    }
  }

  /** Request browser notification permission. Returns the permission state. */
  static async requestPermission(): Promise<NotificationPermission> {
    const g = globalThis as any;
    if (!g.Notification) return 'denied';
    if (g.Notification.permission === 'granted') return 'granted';
    if (g.Notification.permission === 'denied') return 'denied';
    return g.Notification.requestPermission();
  }

  /** Check if browser notifications are supported and permitted */
  static getPermissionStatus(): 'unsupported' | 'granted' | 'denied' | 'default' {
    const g = globalThis as any;
    if (!g.Notification) return 'unsupported';
    return g.Notification.permission;
  }
}
