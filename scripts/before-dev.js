#!/usr/bin/env node

/**
 * beforeDevCommand for Tauri.
 * Checks if the Next.js dev server is already running on port 3088.
 * - If running: prints a notice and exits 0 (Tauri continues).
 * - If not: spawns `npm run dev -- --turbopack --port 3088` in the background.
 */

const http = require("http");
const { spawn } = require("child_process");
const PORT = 3088;

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

  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--turbopack", "--port", String(PORT)],
    { stdio: "inherit", shell: true, detached: true }
  );

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
