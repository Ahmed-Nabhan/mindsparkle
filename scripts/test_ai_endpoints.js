const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

function readAppJsonExtra() {
  try {
    const appJsonPath = path.join(process.cwd(), 'app.json');
    const raw = fs.readFileSync(appJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && parsed.expo && parsed.expo.extra) ? parsed.expo.extra : {};
  } catch {
    return {};
  }
}

function buildOpenAiProxyUrl(supabaseUrl) {
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/openai-proxy`;
}

// Load config from env first, then fallback to app.json expo.extra (recommended for this repo).
const extra = readAppJsonExtra();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || null;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || null;
const OPENAI_PROXY_URL = process.env.OPENAI_PROXY_URL || process.env.EXPO_PUBLIC_OPENAI_PROXY_URL || extra.openaiProxyUrl || buildOpenAiProxyUrl(SUPABASE_URL);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPENAI_PROXY_URL) {
  console.error('Missing config. Provide SUPABASE_URL + SUPABASE_ANON_KEY (or app.json expo.extra), and OPENAI_PROXY_URL if not derivable.');
  process.exit(1);
}

const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
if (!TEST_EMAIL || !TEST_PASSWORD) {
  console.error('Missing TEST_EMAIL/TEST_PASSWORD. Set these env vars for a Supabase test user to obtain a valid JWT for openai-proxy.');
  console.error('Example: TEST_EMAIL="you@test.com" TEST_PASSWORD="..." node scripts/test_ai_endpoints.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getAccessToken() {
  const { data, error } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (error || !data?.session?.access_token) {
    throw new Error(`Supabase sign-in failed: ${error?.message || 'no session returned'}`);
  }
  return data.session.access_token;
}

async function callProxy(accessToken, payload) {
  const res = await fetch(OPENAI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Proxy error (${res.status}): ${JSON.stringify(data)}`);
  }
  // openai-proxy uses { code, message } with 200 sometimes; treat code>=400 as error.
  if (typeof data?.code === 'number' && data.code >= 400) {
    throw new Error(`Proxy application error: ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function containsAny(haystack, needles) {
  const h = String(haystack || '').toLowerCase();
  return needles.some(n => h.includes(String(n).toLowerCase()));
}

async function runAccuracySmoke(accessToken) {
  const sample = [
    'CCNA 200-301 Study Notes',
    'Router configuration example:',
    'Router# configure terminal',
    'Router(config)# interface GigabitEthernet0/0',
    'Router(config-if)# ip address 192.168.1.1 255.255.255.0',
    'Router(config-if)# no shutdown',
    'Verification:',
    'show ip route',
    'show running-config',
  ].join('\n');

  console.log('Calling test...');
  const health = await callProxy(accessToken, { action: 'test' });
  console.log('Test response:', health);

  console.log('Calling summarize...');
  const sum = await callProxy(accessToken, { action: 'summarize', content: sample, language: 'en' });
  console.log('Summarize keys:', Object.keys(sum));
  assert(typeof sum.summary === 'string' && sum.summary.length > 120, 'Expected a non-trivial summary string');
  assert(containsAny(sum.summary, ['router', 'interface', 'ip address', 'ccna']), 'Summary does not appear grounded in input content');

  console.log('Calling quiz...');
  const quiz = await callProxy(accessToken, { action: 'quiz', content: sample, count: 5, difficulty: 'medium', language: 'en' });
  assert(Array.isArray(quiz.questions), 'Expected quiz.questions array');
  assert(quiz.questions.length > 0, 'Expected at least 1 quiz question');
  console.log('Quiz questions:', quiz.questions.length);

  console.log('Calling flashcards...');
  const cards = await callProxy(accessToken, { action: 'flashcards', content: sample, count: 8, language: 'en' });
  assert(Array.isArray(cards.flashcards), 'Expected flashcards.flashcards array');
  assert(cards.flashcards.length > 0, 'Expected at least 1 flashcard');
  console.log('Flashcards:', cards.flashcards.length);

  console.log('Calling interview...');
  const interview = await callProxy(accessToken, { action: 'interview', content: sample, count: 5, language: 'en' });
  assert(Array.isArray(interview.questions), 'Expected interview.questions array');
  assert(interview.questions.length > 0, 'Expected at least 1 interview question');
  console.log('Interview questions:', interview.questions.length);

  console.log('Calling detectVendor...');
  const vendor = await callProxy(accessToken, { action: 'detectVendor', content: sample });
  console.log('Vendor:', vendor);

  console.log('Calling summarizeModuleJSON...');
  const moduleResp = await callProxy(accessToken, {
    action: 'summarizeModule',
    content: sample,
    title: 'Network Fundamentals (Test Module)',
    source: { pageStart: 1, pageEnd: 1, inputChars: sample.length },
    language: 'en',
  });
  assert(moduleResp && typeof moduleResp === 'object', 'Expected object response from summarizeModuleJSON');
  assert(moduleResp.module && typeof moduleResp.module === 'object', 'Expected moduleResp.module object');
  const mod = moduleResp.module;
  assert(typeof mod.moduleId === 'string' && mod.moduleId.length > 0, 'Expected module.moduleId string');
  assert(typeof mod.title === 'string' && mod.title.length > 0, 'Expected module.title string');
  assert(['LOW', 'MEDIUM', 'HIGH'].includes(mod.confidence), 'Expected module.confidence to be LOW|MEDIUM|HIGH');
  assert(mod.content && typeof mod.content === 'object', 'Expected module.content object');
  assert(Array.isArray(mod.content.executiveSummary), 'Expected content.executiveSummary array');
  assert(Array.isArray(mod.content.textBlocks), 'Expected content.textBlocks array');
  assert(Array.isArray(mod.content.tables), 'Expected content.tables array');
  assert(Array.isArray(mod.content.diagrams), 'Expected content.diagrams array');
  assert(Array.isArray(mod.content.equations), 'Expected content.equations array');
  assert(Array.isArray(mod.content.visuals), 'Expected content.visuals array');
  console.log('Module summary OK:', { moduleId: mod.moduleId, title: mod.title, confidence: mod.confidence });
}

(async function() {
  try {
    const token = await getAccessToken();
    await runAccuracySmoke(token);
    console.log('\n✅ AI output smoke checks passed.');
  } catch (e) {
    console.error('Test failed:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
