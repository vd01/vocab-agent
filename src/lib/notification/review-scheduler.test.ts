import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReviewScheduler, DEFAULT_SCHEDULER_CONFIG, type SchedulerConfig } from './review-scheduler';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Track notification constructor calls
let notificationCallCount = 0;
let lastNotificationInstance: any = null;

// Create a mock Notification constructor that works in Node
class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn().mockResolvedValue('granted');
  onclick: ((ev: Event) => void) | null = null;
  close = vi.fn();

  constructor(public title: string, public options?: NotificationOptions) {
    notificationCallCount++;
    lastNotificationInstance = this;
  }
}

beforeEach(() => {
  mockFetch.mockReset();
  notificationCallCount = 0;
  lastNotificationInstance = null;
  MockNotification.permission = 'default';

  // Install MockNotification as globalThis.Notification
  (globalThis as any).Notification = MockNotification;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReviewScheduler', () => {
  describe('DEFAULT_SCHEDULER_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_SCHEDULER_CONFIG.enabled).toBe(false);
      expect(DEFAULT_SCHEDULER_CONFIG.intervalMinutes).toBe(30);
      expect(DEFAULT_SCHEDULER_CONFIG.quietHoursStart).toBe(22);
      expect(DEFAULT_SCHEDULER_CONFIG.quietHoursEnd).toBe(7);
    });
  });

  describe('constructor', () => {
    it('should merge partial config with defaults', () => {
      const scheduler = new ReviewScheduler({ intervalMinutes: 60 });
      const config = scheduler.getConfig();
      expect(config.intervalMinutes).toBe(60);
      expect(config.enabled).toBe(false);
      expect(config.quietHoursStart).toBe(22);
    });
  });

  describe('updateConfig', () => {
    it('should update config', () => {
      const scheduler = new ReviewScheduler();
      scheduler.updateConfig({ intervalMinutes: 15 });
      expect(scheduler.getConfig().intervalMinutes).toBe(15);
    });
  });

  describe('start/stop', () => {
    it('should not start when disabled', () => {
      const scheduler = new ReviewScheduler({ enabled: false });
      scheduler.start();
      // No crash, no timer set
      expect(scheduler.getConfig().enabled).toBe(false);
    });

    it('should stop cleanly', () => {
      const scheduler = new ReviewScheduler({ enabled: true });
      scheduler.start();
      scheduler.stop();
      // No crash
    });
  });

  describe('checkNow', () => {
    it('should return 0 when disabled', async () => {
      const scheduler = new ReviewScheduler({ enabled: false });
      const count = await scheduler.checkNow();
      expect(count).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch due count from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ due: 5 }),
      });

      const scheduler = new ReviewScheduler({ enabled: true });
      const count = await scheduler.checkNow();
      expect(count).toBe(5);
      expect(mockFetch).toHaveBeenCalledWith('/api/review-due');
    });

    it('should call onDueWords callback when due words found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ due: 3 }),
      });

      const callback = vi.fn();
      const scheduler = new ReviewScheduler({ enabled: true });
      scheduler.setOnDueWords(callback);
      await scheduler.checkNow();
      expect(callback).toHaveBeenCalledWith(3);
    });

    it('should not call onDueWords when no due words', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ due: 0 }),
      });

      const callback = vi.fn();
      const scheduler = new ReviewScheduler({ enabled: true });
      scheduler.setOnDueWords(callback);
      await scheduler.checkNow();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const scheduler = new ReviewScheduler({ enabled: true });
      const count = await scheduler.checkNow();
      expect(count).toBe(0);
    });
  });

  describe('quiet hours', () => {
    it('should detect quiet hours when start > end (wraps midnight)', () => {
      // 22:00 - 07:00
      const scheduler = new ReviewScheduler({
        enabled: true,
        quietHoursStart: 22,
        quietHoursEnd: 7,
      });

      // Access private method via any
      const isQuiet = (scheduler as any).isQuietHours.bind(scheduler);

      // Mock different hours
      const originalGetHours = Date.prototype.getHours;

      Date.prototype.getHours = vi.fn().mockReturnValue(23);
      expect(isQuiet()).toBe(true);

      Date.prototype.getHours = vi.fn().mockReturnValue(0);
      expect(isQuiet()).toBe(true);

      Date.prototype.getHours = vi.fn().mockReturnValue(6);
      expect(isQuiet()).toBe(true);

      Date.prototype.getHours = vi.fn().mockReturnValue(12);
      expect(isQuiet()).toBe(false);

      Date.prototype.getHours = vi.fn().mockReturnValue(21);
      expect(isQuiet()).toBe(false);

      // Restore
      Date.prototype.getHours = originalGetHours;
    });

    it('should detect quiet hours when start < end (no wrap)', () => {
      // 1:00 - 6:00
      const scheduler = new ReviewScheduler({
        enabled: true,
        quietHoursStart: 1,
        quietHoursEnd: 6,
      });

      const isQuiet = (scheduler as any).isQuietHours.bind(scheduler);
      const originalGetHours = Date.prototype.getHours;

      Date.prototype.getHours = vi.fn().mockReturnValue(3);
      expect(isQuiet()).toBe(true);

      Date.prototype.getHours = vi.fn().mockReturnValue(12);
      expect(isQuiet()).toBe(false);

      Date.prototype.getHours = vi.fn().mockReturnValue(0);
      expect(isQuiet()).toBe(false);

      Date.prototype.getHours = originalGetHours;
    });
  });

  describe('notification dedup', () => {
    it('should not show notification for same due count twice', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ due: 5 }),
      });

      MockNotification.permission = 'granted';

      const scheduler = new ReviewScheduler({ enabled: true });
      scheduler.setOnDueWords(vi.fn());

      // First check — should show notification
      await scheduler.checkNow();
      expect(notificationCallCount).toBe(1);

      // Second check — same due count, should NOT show notification
      await scheduler.checkNow();
      expect(notificationCallCount).toBe(1); // still 1 (dedup)
    });

    it('should show notification when due count changes', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ due: 5 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ due: 8 }) });

      MockNotification.permission = 'granted';

      const scheduler = new ReviewScheduler({ enabled: true });
      scheduler.setOnDueWords(vi.fn());

      await scheduler.checkNow();
      await scheduler.checkNow();

      expect(notificationCallCount).toBe(2);
    });
  });
});

describe('ReviewScheduler static methods', () => {
  it('getPermissionStatus should return unsupported when Notification not available', () => {
    const original = (globalThis as any).Notification;
    delete (globalThis as any).Notification;
    expect(ReviewScheduler.getPermissionStatus()).toBe('unsupported');
    (globalThis as any).Notification = original;
  });

  it('getPermissionStatus should return current permission', () => {
    // MockNotification is already installed in beforeEach
    MockNotification.permission = 'granted';
    expect(ReviewScheduler.getPermissionStatus()).toBe('granted');

    MockNotification.permission = 'denied';
    expect(ReviewScheduler.getPermissionStatus()).toBe('denied');

    MockNotification.permission = 'default';
    expect(ReviewScheduler.getPermissionStatus()).toBe('default');
  });
});
