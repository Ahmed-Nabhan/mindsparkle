#!/usr/bin/env node
// Basic static QA checks for MindSparkle project
// Run: node scripts/qa/static_checks.js
const fs = require('fs');
const path = require('path');

function readJSON(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const root = path.resolve(__dirname, '..', '..');
const appJson = readJSON(path.join(root, 'app.json')) || {};
const pkg = readJSON(path.join(root, 'package.json')) || {};

console.log('== MindSparkle Static QA Checks ==');

// debug info available when needed

// 1. Check RevenueCat keys in app.json extras
const extras = (appJson.expo && appJson.expo.extra) || {};
const rcIos = extras.revenueCatIosKey || process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const rcAndroid = extras.revenueCatAndroidKey || process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
console.log('- RevenueCat iOS key:', rcIos ? 'FOUND' : 'MISSING');
console.log('- RevenueCat Android key:', rcAndroid ? 'FOUND' : 'MISSING');

// 2. Check product ids in source (supports different declaration styles)
const revenueCatSrc = path.join(root, 'src', 'services', 'revenueCat.ts');
let productIds = [];
if (fs.existsSync(revenueCatSrc)) {
  const src = fs.readFileSync(revenueCatSrc, 'utf8');
  // Try multiple patterns: export const PRODUCT_IDS = { ... } or PRODUCT_IDS = { ... }
  const m = src.match(/export\s+const\s+PRODUCT_IDS\s*=\s*\{([\s\S]*?)\}/m) || src.match(/PRODUCT_IDS\s*[:=]\s*\{([\s\S]*?)\}/m);
  if (m) {
    const block = m[1];
    const ids = Array.from(block.matchAll(/['\"]?([^'\":\s]+)['\"]?\s*[:=]\s*['\"]([^'\"]+)['\"]/g));
    ids.forEach(x => productIds.push(x[2]));
  }
}
console.log('- Product IDs found in code:', productIds.length ? productIds.join(', ') : 'NONE');

// 3. Presentation AI URL
const configSrc = path.join(root, 'src', 'services', 'config.ts');
let presentationUrl = null;
if (fs.existsSync(configSrc)) {
  const cfg = fs.readFileSync(configSrc, 'utf8');
  const m = cfg.match(/PRESENTATION_AI_URL:\s*'([^']+)'/);
  if (m) presentationUrl = m[1];
}
console.log('- Presentation AI URL:', presentationUrl || 'NOT CONFIGURED');

// 4. Canva key
const canvaKey = extras.CANVA_API_KEY || process.env.CANVA_API_KEY;
console.log('- Canva API Key:', canvaKey ? 'FOUND' : 'MISSING (optional)');

// 5. Check that expo-dev-client is listed in package.json devDependencies
const devDeps = pkg.devDependencies || {};
console.log('- expo-dev-client in devDependencies:', devDeps['expo-dev-client'] ? 'yes' : 'no');

console.log('\nStatic checks complete. For dynamic checks run the app and use the runtime validators (revenueCat.validateRevenueCatConfiguration).');
