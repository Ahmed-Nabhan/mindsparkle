/**
 * Get Google Credentials Edge Function
 * Returns a short-lived OAuth access token for server-side Google APIs (e.g. Document AI).
 *
 * Security:
 * - Never returns the service account private key.
 * - Intended for INTERNAL server-to-server use only (called by other Edge Functions).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToPkcs8Der(privateKeyPem: string): Uint8Array {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";

  const start = privateKeyPem.indexOf(pemHeader);
  const end = privateKeyPem.indexOf(pemFooter);
  if (start === -1 || end === -1) {
    throw new Error("Invalid private key PEM format");
  }

  const base64 = privateKeyPem
    .slice(start + pemHeader.length, end)
    .replace(/\s+/g, '');

  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function signJwtRs256(unsignedToken: string, privateKeyPem: string): Promise<string> {
  const binaryDer = pemToPkcs8Der(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken),
  );

  const signatureBytes = new Uint8Array(signatureBuffer);
  let binary = '';
  for (const b of signatureBytes) binary += String.fromCharCode(b);
  return base64UrlEncode(binary);
}

async function mintGoogleAccessToken(params: {
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
  scope: string;
}): Promise<{ accessToken: string; tokenType: string; expiresIn: number }>
{
  const { clientEmail, privateKeyPem, tokenUri, scope } = params;
  const nowSec = Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: clientEmail,
    scope,
    aud: tokenUri,
    iat: nowSec,
    exp: nowSec + 3600,
  }));

  const unsigned = `${header}.${claims}`;
  const signature = await signJwtRs256(unsigned, privateKeyPem);
  const assertion = `${unsigned}.${signature}`;

  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.set('assertion', assertion);

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    // Avoid leaking assertion / secrets; return trimmed upstream error text.
    throw new Error(`Failed to mint access token: ${res.status} ${bodyText.slice(0, 500)}`);
  }

  const data = JSON.parse(bodyText);
  if (!data?.access_token) throw new Error('Google token response missing access_token');
  return {
    accessToken: String(data.access_token),
    tokenType: String(data.token_type || 'Bearer'),
    expiresIn: Number(data.expires_in || 3600),
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Internal-only guard: must be called with the service role key.
    const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const auth = req.headers.get('authorization') || '';
    if (!expected || auth !== `Bearer ${expected}`) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    
    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ error: "Google service account not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const credentials = JSON.parse(serviceAccountJson);
    const clientEmail = credentials?.client_email;
    const privateKey = credentials?.private_key;
    const tokenUri = credentials?.token_uri || 'https://oauth2.googleapis.com/token';

    if (!clientEmail || !privateKey) {
      return new Response(
        JSON.stringify({ error: 'Invalid Google service account JSON (missing client_email/private_key)' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Cloud-platform scope covers Document AI and most GCP APIs.
    const scope = 'https://www.googleapis.com/auth/cloud-platform';
    const token = await mintGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKey,
      tokenUri,
      scope,
    });

    return new Response(
      JSON.stringify({
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        expiresIn: token.expiresIn,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
