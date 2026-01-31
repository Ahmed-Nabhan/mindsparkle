const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

function buildEdgeUrl(supabaseUrl, fnName) {
  return `${String(supabaseUrl).replace(/\/$/, '')}/functions/v1/${fnName}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const extra = readAppJsonExtra();
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey;

  const TEST_EMAIL = process.env.TEST_EMAIL;
  const TEST_PASSWORD = process.env.TEST_PASSWORD;
  const DOCUMENT_ID = process.env.DOCUMENT_ID || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY (can be sourced from app.json expo.extra).');
  }
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error('Missing TEST_EMAIL/TEST_PASSWORD env vars.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signInErr || !signIn?.session?.access_token) {
    throw new Error(`Supabase sign-in failed: ${signInErr?.message || 'no session'}`);
  }

  const accessToken = signIn.session.access_token;

  let documentId = DOCUMENT_ID.trim();
  if (!documentId) {
    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('id,title,extraction_status,has_text,updated_at')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (docsErr) throw new Error(`Failed to list documents: ${docsErr.message}`);

    const usable = (docs || []).find((d) => d && d.has_text);
    if (!usable) {
      throw new Error('No documents with has_text=true found for this user. Set DOCUMENT_ID env var explicitly.');
    }

    documentId = usable.id;
    console.log('Auto-selected document:', { id: usable.id, title: usable.title, extraction_status: usable.extraction_status, updated_at: usable.updated_at });
  }

  const generateUrl = buildEdgeUrl(SUPABASE_URL, 'generate-output');

  async function callGenerateOutput() {
    const res = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ documentId, outputType: 'deep_explain', options: {} }),
    });

    const txt = await res.text();
    let json;
    try { json = JSON.parse(txt); } catch { json = { raw: txt }; }

    if (!res.ok) {
      throw new Error(`generate-output failed (${res.status}): ${JSON.stringify(json)}`);
    }

    if (!json?.success || !json?.outputId || !json?.jobId || !json?.requestId) {
      throw new Error(`Unexpected generate-output response: ${JSON.stringify(json)}`);
    }

    return json;
  }

  async function waitForOutput(outputId, requestId, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const { data: row, error } = await supabase
        .from('document_outputs')
        .select('id,status,updated_at,input_snapshot,content')
        .eq('id', outputId)
        .maybeSingle();

      if (error) throw new Error(`Failed to poll document_outputs: ${error.message}`);
      if (!row) throw new Error('Output row not found while polling');

      const snap = row.input_snapshot || {};
      const currentRequestId = snap.request_id;

      // Only consider completion for the request we triggered.
      if (currentRequestId === requestId && (row.status === 'succeeded' || row.status === 'failed')) {
        return { status: row.status, updated_at: row.updated_at };
      }

      await sleep(1500);
    }
    throw new Error(`Timed out waiting for outputId=${outputId} requestId=${requestId}`);
  }

  async function runOnce(label) {
    console.log(`\n== ${label} ==`);
    const t0 = Date.now();
    const { outputId, jobId, requestId } = await callGenerateOutput();
    console.log('Enqueued:', { documentId, outputId, jobId, requestId });

    const done = await waitForOutput(outputId, requestId, 10 * 60 * 1000);
    const dt = Date.now() - t0;
    console.log('Done:', { status: done.status, elapsedMs: dt, updated_at: done.updated_at });
    return { outputId, jobId, requestId, elapsedMs: dt, status: done.status };
  }

  const r1 = await runOnce('RUN 1 (expected: embeddings upsert + cache miss)');
  const r2 = await runOnce('RUN 2 (expected: cache hit, faster)');

  console.log('\nSummary:');
  console.log({
    documentId,
    run1: { elapsedMs: r1.elapsedMs, status: r1.status },
    run2: { elapsedMs: r2.elapsedMs, status: r2.status },
  });

  console.log('\nNext: verify Cloud Run logs for cache hits:');
  console.log('  Look for jsonPayload.msg=deep_explain_cache_hit and deep_explain_cache_miss');
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
