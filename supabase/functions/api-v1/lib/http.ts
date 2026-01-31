export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function textResponse(body: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }
  return new Response(body, { ...init, headers });
}

export function corsHeaders(origin?: string): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", origin ?? "*");
  headers.set("access-control-allow-headers", "authorization, x-client-info, apikey, content-type, x-request-id");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-max-age", "86400");
  return headers;
}

export function withCors(resp: Response, origin?: string): Response {
  const headers = new Headers(resp.headers);
  for (const [k, v] of corsHeaders(origin).entries()) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}
