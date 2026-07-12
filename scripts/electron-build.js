const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

run('npm run build');
run('npm run electron:compile');

const distDir = path.join(root, 'dist-electron');
for (const f of fs.readdirSync(distDir)) {
  if (f.endsWith('.exe') || f.endsWith('.blockmap') || f === 'win-unpacked' || f === '.icon-ico') {
    const p = path.join(distDir, f);
    console.log(`> Removing old build artifact: ${f}`);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

run('npm prune --omit=dev');
console.log('> Installing electron-builder temporarily...');
run('npm install --no-save electron-builder');
try {
  run('npx electron-builder --win');
} finally {
  console.log('> Restoring devDependencies...');
  try { run('npm install'); } catch {}
}
