const fs = require('fs');
// Use global fetch when available (Node 18+). Fallback to node-fetch if necessary.
let fetchFunc = globalThis.fetch;
if (!fetchFunc) {
  try {
    fetchFunc = require('node-fetch');
  } catch (e) {
    console.error('fetch is not available. Please run on Node 18+ or install node-fetch.');
    process.exit(1);
  }
}
const fetch = fetchFunc;
// Load config from env first, then fallback to reading the TypeScript config file
let SUPABASE_URL = process.env.SUPABASE_URL || null;
let SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || null;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  try {
    const cfgText = fs.readFileSync('src/services/config.ts', 'utf8');
    if (!SUPABASE_URL) {
      const m = cfgText.match(/SUPABASE_URL:\s*'([^']+)'/);
      if (m) SUPABASE_URL = m[1];
    }
    if (!SUPABASE_ANON_KEY) {
      const k = cfgText.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/);
      if (k) SUPABASE_ANON_KEY = k[1];
    }
  } catch (e) {
    console.error('Could not read src/services/config.ts; please set SUPABASE_URL and SUPABASE_ANON_KEY in environment.');
    process.exit(1);
  }
}
const Config = { SUPABASE_URL, SUPABASE_ANON_KEY };

async function testSummarize() {
  const url = Config.SUPABASE_URL;
  const payload = {
    action: 'summarize',
    content: 'This is a test document.\n\nSection 1: Introduction to testing.\nSection 2: Implementation details.\nSection 3: Conclusion.',
    includePageRefs: false,
  };

  console.log('Calling summarize...');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: Config.SUPABASE_ANON_KEY, Authorization: `Bearer ${Config.SUPABASE_ANON_KEY}` }, body: JSON.stringify(payload) });
  const data = await res.json();
  console.log('Summarize response:', data);
}

async function testVideo() {
  const url = Config.SUPABASE_URL;
  const pages = [
    { pageNum: 1, text: '=== PAGE 1 ===\nIntroduction to testing and unit tests', imageUrl: undefined },
    { pageNum: 2, text: '=== PAGE 2 ===\nBest practices and examples', imageUrl: undefined }
  ];
  const payload = {
    action: 'videoWithSlides',
    content: pages.map(p => p.text).join('\n\n'),
    pageCount: pages.length,
    totalPages: pages.length,
    language: 'en',
    style: 'educational',
    useAnimations: true,
  };

  console.log('Calling videoWithSlides...');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: Config.SUPABASE_ANON_KEY, Authorization: `Bearer ${Config.SUPABASE_ANON_KEY}` }, body: JSON.stringify(payload) });
  const data = await res.json();
  console.log('Video response:', data);
}

(async function() {
  try {
    await testSummarize();
    await testVideo();
  } catch (e) {
    console.error('Test failed:', e);
  }
})();
