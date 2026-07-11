import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'vocab-auth';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const SALT = 'vocab-agent-2024';

/**
 * 生成认证 token: sha256(password + salt) — Web Crypto API
 */
async function generateToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(password + SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * POST /api/auth — 登录验证
 * Body: { password: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '请输入密码' }, { status: 400 });
    }

    const expectedPassword = process.env.AUTH_PASSWORD;

    if (!expectedPassword) {
      console.error('[Auth] AUTH_PASSWORD 环境变量未设置，拒绝所有登录');
      return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
    }

    if (password !== expectedPassword) {
      return NextResponse.json({ error: '密码错误' }, { status: 401 });
    }

    // 密码正确，生成 token 并设置 cookie
    const token = await generateToken(password);

    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[Auth] Error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/auth — 退出登录
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
