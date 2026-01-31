/**
 * Sign JWT Edge Function
 * Signs an unsigned JWT with the Google service account private key from env.
 * Intended for INTERNAL server-to-server use only.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Base64url encode a string
 */
function b64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

    const { unsignedToken } = await req.json();
    
    if (!unsignedToken) {
      return new Response(
        JSON.stringify({ error: "Missing unsignedToken" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'Google service account not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const credentials = JSON.parse(serviceAccountJson);
    const privateKey = credentials?.private_key;
    if (!privateKey) {
      return new Response(
        JSON.stringify({ error: 'Invalid Google service account JSON (missing private_key)' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Parse the private key
    const binaryDer = pemToPkcs8Der(String(privateKey));
    
    // Import the private key
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    // Sign the token
    const encoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      encoder.encode(unsignedToken)
    );
    
    const signature = b64url(String.fromCharCode(...new Uint8Array(signatureBuffer)));
    
    return new Response(
      JSON.stringify({ signature }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Sign JWT error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
