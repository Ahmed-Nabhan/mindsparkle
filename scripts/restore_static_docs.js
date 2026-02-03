const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const webRoot = path.join(projectRoot, 'docs');
const staticRoot = path.join(projectRoot, 'static_docs');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  ensureDir(destDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else if (entry.isFile()) {
      copyFile(src, dest);
    }
  }
}

function main() {
  if (!fs.existsSync(staticRoot)) {
    console.log('[restore_static_docs] No static_docs/ directory found; skipping.');
    return;
  }

  // Copy specific top-level HTML pages.
  for (const name of ['privacy.html', 'terms.html', 'support.html']) {
    const src = path.join(staticRoot, name);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(webRoot, name));
    }
  }

  // Copy landing site folder.
  const landingSrc = path.join(staticRoot, 'landing');
  if (fs.existsSync(landingSrc)) {
    copyDir(landingSrc, path.join(webRoot, 'landing'));
  }

  console.log('[restore_static_docs] Restored static docs pages.');
}

main();
