const DEFAULT_UPSTREAM_ORIGIN =
  "https://hunt-planner-seo-preview.samuelfbridge.chatgpt.site";
const DEFAULT_TIMEOUT_MS = 10_000;
const COMMUNITY_PATH_PREFIX = "/api/community";
const MAX_POST_BODY_BYTES = 16_384;
const ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS", "HEAD"]);
const FORWARDED_REQUEST_HEADERS = [
  ["accept", "Accept"],
  ["content-type", "Content-Type"],
  ["x-firebase-id-token", "X-Firebase-ID-Token"],
];
const FORWARDED_RESPONSE_HEADERS = new Set([
  "allow",
  "content-language",
  "content-type",
  "retry-after",
]);

export async function proxyCommunityRequest(
  request,
  {
    fetchImpl = globalThis.fetch,
    upstreamOrigin = DEFAULT_UPSTREAM_ORIGIN,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  const method = String(request.method || "").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return jsonProxyResponse(
      405,
      "Method not allowed.",
      { Allow: [...ALLOWED_METHODS].join(", ") },
    );
  }

  const target = buildUpstreamUrl(request.originalUrl || request.url, upstreamOrigin);
  if (!target) {
    return jsonProxyResponse(404, "Community API route not found.");
  }

  if (method === "OPTIONS") {
    return emptyProxyResponse(204, {
      Allow: [...ALLOWED_METHODS].join(", "),
    });
  }

  if (
    method === "POST" &&
    request.rawBody &&
    request.rawBody.byteLength > MAX_POST_BODY_BYTES
  ) {
    return jsonProxyResponse(413, "Request body is too large.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Upstream request timed out.", "TimeoutError")),
    timeoutMs,
  );
  timeout.unref?.();

  try {
    const upstreamResponse = await fetchImpl(target, {
      method,
      headers: buildUpstreamHeaders(request.headers),
      body: method === "POST" ? request.rawBody : undefined,
      redirect: "error",
      signal: controller.signal,
    });

    const headers = safeResponseHeaders(upstreamResponse.headers);
    const hasBody =
      method !== "HEAD" &&
      upstreamResponse.status !== 204 &&
      upstreamResponse.status !== 304;
    const body = hasBody
      ? Buffer.from(await upstreamResponse.arrayBuffer())
      : Buffer.alloc(0);

    return {
      status: upstreamResponse.status,
      headers,
      body,
    };
  } catch {
    if (controller.signal.aborted) {
      return jsonProxyResponse(504, "Community service timed out.");
    }
    return jsonProxyResponse(502, "Community service is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}

export function sendProxyResponse(response, proxied) {
  response.status(proxied.status);
  for (const [name, value] of Object.entries(proxied.headers)) {
    response.set(name, value);
  }
  response.send(proxied.body);
}

export function buildUpstreamUrl(requestUrl, upstreamOrigin = DEFAULT_UPSTREAM_ORIGIN) {
  if (typeof requestUrl !== "string" || requestUrl.length === 0) return null;

  let incoming;
  try {
    incoming = new URL(requestUrl, "https://firebase.invalid");
  } catch {
    return null;
  }

  const pathname = incoming.pathname;
  if (
    pathname !== COMMUNITY_PATH_PREFIX &&
    !pathname.startsWith(`${COMMUNITY_PATH_PREFIX}/`)
  ) {
    return null;
  }

  const upstream = new URL(upstreamOrigin);
  upstream.pathname = pathname;
  upstream.search = incoming.search;
  upstream.hash = "";
  return upstream;
}

function buildUpstreamHeaders(sourceHeaders = {}) {
  const headers = new Headers();
  for (const [lowercaseName, outgoingName] of FORWARDED_REQUEST_HEADERS) {
    const value = headerValue(sourceHeaders, lowercaseName);
    if (value !== null) headers.set(outgoingName, value);
  }
  return headers;
}

function headerValue(headers, lowercaseName) {
  if (headers instanceof Headers) return headers.get(lowercaseName);

  for (const [name, rawValue] of Object.entries(headers)) {
    if (name.toLowerCase() !== lowercaseName || rawValue == null) continue;
    return Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
  }
  return null;
}

function safeResponseHeaders(upstreamHeaders) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  for (const [name, value] of upstreamHeaders.entries()) {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  }
  return headers;
}

function jsonProxyResponse(status, message, additionalHeaders = {}) {
  return {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
    body: Buffer.from(JSON.stringify({ error: message })),
  };
}

function emptyProxyResponse(status, additionalHeaders = {}) {
  return {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
    body: Buffer.alloc(0),
  };
}
