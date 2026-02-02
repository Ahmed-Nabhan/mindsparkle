/*
 * Expo web export (docs) is hosted at the domain root.
 * The default export currently emits absolute URLs like /_expo/... and /favicon.ico,
 * which we normalize to relative paths for safer hosting.
 *
 * This script rewrites those absolute paths to relative paths so the web export works
 * when hosted at https://example.com/<something>/app/.
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

function main() {
  if (!fs.existsSync(webRoot)) {
    console.error(`Expected export folder not found: ${webRoot}`);
    process.exit(1);
  }

  const indexHtmlPath = path.join(webRoot, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    console.error(`Expected ${indexHtmlPath} to exist. Run \"expo export -p web\" first.`);
    process.exit(1);
  }

  // Fix absolute paths in index.html
  replaceInFile(indexHtmlPath, [
    { from: 'href="/favicon.ico"', to: 'href="./favicon.ico"' },
    { from: 'src="/_expo/', to: 'src="./_expo/' },
  ]);

  // Fix absolute /_expo paths inside JS bundles (worker resolution, assets, etc.)
  const jsDir = path.join(webRoot, '_expo', 'static', 'js', 'web');
  const jsFiles = listFiles(jsDir).filter((f) => f.endsWith('.js'));

  for (const file of jsFiles) {
    replaceInFile(file, [
      { from: '"/_expo/', to: '"./_expo/' },
      { from: "'/_expo/", to: "'./_expo/" },
    ]);
  }

  console.log('Fixed web export paths for root hosting (docs).');
}

main();
