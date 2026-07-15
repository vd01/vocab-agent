import { getSettingsByPrefix, setSettings } from '@/lib/db/settings';
import { NextResponse } from 'next/server';

/** GET /api/settings?prefix=notification. — read settings by prefix */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const prefix = url.searchParams.get('prefix') ?? '';

  try {
    const settings = prefix
      ? await getSettingsByPrefix(prefix)
      : await getSettingsByPrefix(''); // all settings

    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[Settings API] GET error:', err);
    return NextResponse.json({ error: 'Failed to read settings' }, { status: 500 });
  }
}

/** POST /api/settings — update multiple settings at once */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const settings: Record<string, string> = body.settings;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Missing settings object' }, { status: 400 });
    }

    await setSettings(settings);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Settings API] POST error:', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
