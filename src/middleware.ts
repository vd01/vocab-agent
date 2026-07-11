import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'vocab-auth';
const SALT = 'vocab-agent-2024';
const LOGIN_PATH = '/login';

/**
 * 生成 token: sha256(password + salt) — 使用 Web Crypto API（Edge Runtime 兼容）
 */
async function generateToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(password + SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 验证请求中的认证 cookie
 */
async function isAuthenticated(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;

  const password = process.env.AUTH_PASSWORD;
  if (!password) return false;

  return token === await generateToken(password);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 已登录用户访问 /login → 重定向到首页
  if (pathname === LOGIN_PATH && await isAuthenticated(req)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // 未登录用户 → 重定向到 /login（排除 /login 本身和 /api/auth）
  if (!await isAuthenticated(req) && pathname !== LOGIN_PATH && !pathname.startsWith('/api/auth')) {
    const loginUrl = new URL(LOGIN_PATH, req.url);
    // 保存原始路径，登录后跳回
    if (pathname !== '/') {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除：
     * - _next/static (静态资源)
     * - _next/image (图片优化)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
