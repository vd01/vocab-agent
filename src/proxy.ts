import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "vocab-auth";
const SALT = "vocab-agent-2024";
const LOGIN_PATH = "/login";

async function generateToken(password: string): Promise<string> {
	const data = new TextEncoder().encode(password + SALT);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAuthenticated(req: NextRequest): Promise<boolean> {
	const password = process.env.AUTH_PASSWORD;
	if (!password) return true;

	if (process.env.AUTH_BYPASS === "1") return true;

	const headerPassword = req.headers.get("X-Auth-Password");
	if (headerPassword) {
		return headerPassword === password;
	}

	const token = req.cookies.get(COOKIE_NAME)?.value;
	if (!token) return false;

	return token === (await generateToken(password));
}

export async function proxy(req: NextRequest) {
	const { pathname } = req.nextUrl;

	if (pathname === LOGIN_PATH && (await isAuthenticated(req))) {
		return NextResponse.redirect(new URL("/", req.url));
	}

	const isTauriPopup =
		pathname.startsWith("/quick-lookup") ||
		pathname.startsWith("/settings-lite");
	if (
		!(await isAuthenticated(req)) &&
		pathname !== LOGIN_PATH &&
		!pathname.startsWith("/api/auth") &&
		!isTauriPopup
	) {
		const loginUrl = new URL(LOGIN_PATH, req.url);
		if (pathname !== "/") {
			loginUrl.searchParams.set("redirect", pathname);
		}
		return NextResponse.redirect(loginUrl);
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico).*)",
	],
};
