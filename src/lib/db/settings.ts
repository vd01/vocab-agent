import { db } from '@/lib/db';
import { userSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/** Default notification/review-scheduler settings */
export const DEFAULT_SETTINGS: Record<string, string> = {
  'notification.enabled': 'false',
  'notification.intervalMinutes': '30',
  'notification.quietHoursStart': '22',
  'notification.quietHoursEnd': '7',
  'notification.lastDueCount': '0',
  'notification.lastNotifiedAt': '0',

  // 每日学习限额
  'review.dailyNewLimit': '10',       // 每日新词上限（0=不限制）
  'review.dailyReviewLimit': '0',     // 每日复习上限（0=不限制）
};

/** Get a single setting value (falls back to default) */
export async function getSetting(key: string): Promise<string> {
  const row = await db
    .select({ value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.key, key))
    .limit(1);

  if (row.length > 0) return row[0].value;
  return DEFAULT_SETTINGS[key] ?? '';
}

/** Get multiple settings by prefix (e.g. "notification.") */
export async function getSettingsByPrefix(prefix: string): Promise<Record<string, string>> {
  // Drizzle doesn't have a nice LIKE for prefix, use raw SQL
  const { client } = await import('@/lib/db');
  const result = await client.execute({
    sql: `SELECT key, value FROM user_settings WHERE key LIKE ?`,
    args: [prefix + '%'],
  });

  const settings: Record<string, string> = {};
  for (const row of result.rows as unknown as { key: string; value: string }[]) {
    settings[row.key] = row.value;
  }

  // Fill defaults for missing keys
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (key.startsWith(prefix) && !(key in settings)) {
      settings[key] = value;
    }
  }

  return settings;
}

/** Set a single setting value (upsert) */
export async function setSetting(key: string, value: string): Promise<void> {
  const now = new Date();
  await db
    .insert(userSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.key,
      set: { value, updatedAt: now },
    });
}

/** Set multiple settings at once */
export async function setSettings(settings: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    await setSetting(key, value);
  }
}
