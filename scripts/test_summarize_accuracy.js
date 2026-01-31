// Summarize accuracy smoke test (calls Supabase Edge Function openai-proxy)
// Usage:
//   TEST_EMAIL="..." TEST_PASSWORD="..." node scripts/test_summarize_accuracy.js
// Optional:
//   SUMMARY_INPUT_FILE=path/to/text.txt
//   SUMMARY_KEYWORDS="router,interface,ip address"   (comma-separated)

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let fetchFunc = globalThis.fetch;
if (!fetchFunc) {
  try {
    fetchFunc = require('node-fetch');
  } catch {
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
    return parsed?.expo?.extra || {};
  } catch {
    return {};
  }
}

function buildOpenAiProxyUrl(supabaseUrl) {
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/openai-proxy`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function containsAny(haystack, needles) {
  const h = String(haystack || '').toLowerCase();
  return needles.some((n) => h.includes(String(n).toLowerCase()));
}

async function callProxy(openaiProxyUrl, anonKey, accessToken, payload) {
  const res = await fetch(openaiProxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
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

  if (!res.ok) throw new Error(`Proxy error (${res.status}): ${JSON.stringify(data)}`);
  if (typeof data?.code === 'number' && data.code >= 400) throw new Error(`Proxy application error: ${JSON.stringify(data)}`);

  return data;
}

(async function main() {
  try {
    const extra = readAppJsonExtra();

    const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey;
    const openaiProxyUrl = process.env.OPENAI_PROXY_URL || process.env.EXPO_PUBLIC_OPENAI_PROXY_URL || extra.openaiProxyUrl || buildOpenAiProxyUrl(supabaseUrl);

    assert(supabaseUrl, 'Missing SUPABASE_URL (or app.json expo.extra.supabaseUrl)');
    assert(anonKey, 'Missing SUPABASE_ANON_KEY (or app.json expo.extra.supabaseAnonKey)');
    assert(openaiProxyUrl, 'Missing OPENAI_PROXY_URL and could not derive it');

    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;
    assert(email && password, 'Missing TEST_EMAIL/TEST_PASSWORD (use a Supabase test user)');

    const supabase = createClient(supabaseUrl, anonKey);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.session?.access_token) throw new Error(`Supabase sign-in failed: ${error?.message || 'no session returned'}`);

    const accessToken = data.session.access_token;

    let content = [
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

    const inputFile = process.env.SUMMARY_INPUT_FILE;
    if (inputFile) {
      content = fs.readFileSync(path.resolve(process.cwd(), inputFile), 'utf8');
    }

    const keywordEnv = process.env.SUMMARY_KEYWORDS;
    const keywords = keywordEnv ? keywordEnv.split(',').map((s) => s.trim()).filter(Boolean) : ['router', 'interface', 'ip address', 'ccna', 'show ip route'];

    console.log('Calling summarize...');
    const result = await callProxy(openaiProxyUrl, anonKey, accessToken, { action: 'summarize', content, language: 'en' });

    const summary = result?.summary;
    assert(typeof summary === 'string', `Expected result.summary to be string, got: ${typeof summary}`);

    // Simple quality checks (smoke-level)
    assert(summary.length > 150, 'Summary is too short; likely failed or ungrounded');
    assert(!containsAny(summary, ['as an ai', "i can't", 'i cannot']), 'Summary looks like a refusal/help message');
    assert(containsAny(summary, keywords), `Summary not grounded enough. Expected it to include at least one of: ${keywords.join(', ')}`);

    console.log('\n✅ Summarize smoke accuracy checks passed.');
    console.log('\n--- Summary output ---\n');
    console.log(summary);
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
