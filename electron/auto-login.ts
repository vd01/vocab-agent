import { BrowserWindow, session } from 'electron';
import { getConfig, decryptRemotePassword, clearRemotePassword } from './store';

export async function autoLogin(win: BrowserWindow): Promise<boolean> {
  const config = getConfig();
  if (config.mode !== 'remote' || !config.remote.url) return false;

  const password = decryptRemotePassword();
  if (!password) return false;

  try {
    const baseUrl = config.remote.url.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) return false;

    const setCookieHeader = res.headers.getSetCookie();
    if (setCookieHeader) {
      const cookies = parseSetCookieHeader(setCookieHeader, baseUrl);
      for (const cookie of cookies) {
        await session.defaultSession.cookies.set(cookie);
      }
    }

    return true;
  } catch (err) {
    console.error('[AutoLogin] Failed:', err);
    return false;
  }
}

function parseSetCookieHeader(
  header: string | string[],
  baseUrl: string
): Electron.CookiesSetDetails[] {
  const url = new URL(baseUrl);
  const headers = Array.isArray(header) ? header : [header];
  const cookies: Electron.CookiesSetDetails[] = [];

  for (const h of headers) {
    const parts = h.split(';').map((p) => p.trim());
    const nameValue = parts[0];
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx === -1) continue;

    const name = nameValue.slice(0, eqIdx);
    const value = nameValue.slice(eqIdx + 1);

    const cookie: Electron.CookiesSetDetails = {
      url: `${url.protocol}//${url.host}`,
      name,
      value,
      path: '/',
      secure: url.protocol === 'https:',
      httpOnly: false,
    };

    for (const part of parts.slice(1)) {
      const lower = part.toLowerCase();
      if (lower.startsWith('path=')) {
        cookie.path = part.slice(5);
      } else if (lower === 'secure') {
        cookie.secure = true;
      } else if (lower === 'httponly') {
        cookie.httpOnly = true;
      } else if (lower.startsWith('samesite=')) {
        const sv = part.slice(9).toLowerCase();
        if (sv === 'lax') cookie.sameSite = 'lax';
        else if (sv === 'strict') cookie.sameSite = 'strict';
        else if (sv === 'none') cookie.sameSite = 'no_restriction';
      }
    }

    cookies.push(cookie);
  }

  return cookies;
}

export async function performRemoteLogin(
  win: BrowserWindow,
  password: string
): Promise<boolean> {
  const config = getConfig();
  if (!config.remote.url) return false;

  try {
    const baseUrl = config.remote.url.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) return false;

    const setCookieHeader = res.headers.getSetCookie();
    if (setCookieHeader) {
      const cookies = parseSetCookieHeader(setCookieHeader, baseUrl);
      for (const cookie of cookies) {
        await session.defaultSession.cookies.set(cookie);
      }
    }

    return true;
  } catch {
    return false;
  }
}
