/*
 * Expo web export (docs) is hosted at the domain root.
 * For SPAs with deep links (e.g. /chatmind), asset URLs MUST be absolute.
 * Relative URLs like ./_expo/... would resolve to /chatmind/_expo/... and 404,
 * resulting in a blank white page.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const webRoot = path.join(projectRoot, 'docs');

function replaceInFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  for (const { from, to } of replacements) {
    content = content.split(from).join(to);
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((p) => fs.statSync(p).isFile());
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function moveDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  // If dest exists, remove it to keep output deterministic.
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.renameSync(src, dest);
  return true;
}

function writeFileIfChanged(filePath, content) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (existing === content) return;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureServiceWorkerFiles() {
  // Expo web export does not emit service worker files by default.
  // If Vercel rewrites /service-worker.js to the SPA shell, browsers can get stuck on old caches.
  const recoverySw = `/* MindSparkle recovery service worker */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    try {
      await self.registration.unregister();
    } catch (e) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        try { client.navigate(client.url); } catch (e) {}
      }
    } catch (e) {}
  })());
});

self.addEventListener('fetch', () => {
  // Intentionally no-op: do not intercept requests.
});
`;

  writeFileIfChanged(path.join(webRoot, 'service-worker.js'), recoverySw);
  writeFileIfChanged(path.join(webRoot, 'sw.js'), recoverySw);
}

function main() {
  if (!fs.existsSync(webRoot)) {
    console.error(`Expected export folder not found: ${webRoot}`);
    process.exit(1);
  }

  ensureServiceWorkerFiles();

  const indexHtmlPath = path.join(webRoot, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    console.error(`Expected ${indexHtmlPath} to exist. Run \"expo export -p web\" first.`);
    process.exit(1);
  }

  // Ensure index.html uses absolute paths (supports deep links)
  replaceInFile(indexHtmlPath, [
    { from: 'href="./favicon.ico"', to: 'href="/favicon.ico"' },
    { from: 'href="favicon.ico"', to: 'href="/favicon.ico"' },
    { from: 'href="/favicon.ico"', to: 'href="/favicon.ico"' },
    { from: 'src="./_expo/', to: 'src="/_expo/' },
    { from: 'src="_expo/', to: 'src="/_expo/' },
  ]);

  // Ensure JS bundles reference absolute /_expo paths (works from any deep URL).
  const jsDir = path.join(webRoot, '_expo', 'static', 'js', 'web');
  const jsFiles = listFiles(jsDir).filter((f) => f.endsWith('.js'));

  for (const file of jsFiles) {
    replaceInFile(file, [
      { from: '"./_expo/', to: '"/_expo/' },
      { from: "'./_expo/", to: "'/_expo/" },
    ]);
  }

  // Vercel can treat paths containing "node_modules" specially in static output.
  // Expo export places many dependency assets under /assets/node_modules/... which may 404.
  // Move to /assets/vendor/... and rewrite bundle references.
  const assetsNodeModules = path.join(webRoot, 'assets', 'node_modules');
  const assetsVendor = path.join(webRoot, 'assets', 'vendor');
  const didMove = moveDir(assetsNodeModules, assetsVendor);
  if (didMove) {
    for (const file of jsFiles) {
      replaceInFile(file, [
        { from: '"/assets/node_modules/', to: '"/assets/vendor/' },
        { from: "'/assets/node_modules/", to: "'/assets/vendor/" },
        { from: '"assets/node_modules/', to: '"assets/vendor/' },
        { from: "'assets/node_modules/", to: "'assets/vendor/" },
      ]);
    }
  }

  console.log('Ensured web export uses absolute asset paths (docs).');
  if (didMove) console.log('Moved /assets/node_modules -> /assets/vendor and rewrote bundle references.');
}

main();
