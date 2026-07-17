#!/usr/bin/env node

/**
 * beforeDevCommand for Tauri.
 * Checks if the Next.js dev server is already running on port 3088.
 * - If running: prints a notice and exits 0 (Tauri continues).
 * - If not: spawns `npm run dev -- --turbopack --port 3088` in the background.
 *
 * Options (env vars):
 *   TAURI_DEV_SHOW_SERVER=1  — show the server console window (default: hidden)
 */

const http = require("http");
const { spawn } = require("child_process");
const PORT = 3088;
const SHOW_SERVER = !!process.env.TAURI_DEV_SHOW_SERVER;

function checkServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const alive = await checkServer(PORT);

  if (alive) {
    console.log(`[before-dev] Next.js dev server already running on port ${PORT} — skipping startup.`);
    console.log(`[before-dev] If this is wrong, kill the process on port ${PORT} and retry.`);
    process.exit(0);
  }

  console.log(`[before-dev] Starting Next.js dev server on port ${PORT}...`);

  const isWin = process.platform === "win32";

  // On Windows, hide the console window by default.
  // Set TAURI_DEV_SHOW_SERVER=1 to show it (useful for debugging server logs).
  const spawnOpts = {
    stdio: SHOW_SERVER ? "inherit" : "pipe",
    detached: true,
    env: { ...process.env },
  };

  if (isWin && !SHOW_SERVER) {
    spawnOpts.windowsHide = true;
  }

  const child = spawn(
    isWin ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--turbopack", "--port", String(PORT)],
    spawnOpts
  );

  if (!SHOW_SERVER) {
    // Silently discard stdout/stderr so nothing leaks to the Tauri console
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", () => {});
  }

  child.unref();

  // Wait up to 30s for the server to become available
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await checkServer(PORT)) {
      console.log(`[before-dev] Next.js dev server is ready on port ${PORT}.`);
      process.exit(0);
    }
  }

  console.warn(`[before-dev] Timed out waiting for Next.js on port ${PORT}. It may still be starting — Tauri will proceed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[before-dev] Error: ${e.message}`);
  process.exit(0); // Don't block Tauri
});
