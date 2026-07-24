import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpstreamUrl,
  proxyCommunityRequest,
  sendProxyResponse,
} from "../proxy.js";

const UPSTREAM =
  "https://hunt-planner-seo-preview.samuelfbridge.chatgpt.site";

test("buildUpstreamUrl preserves the Community path and query", () => {
  const url = buildUpstreamUrl(
    "/api/community/posts?sort=new&q=elk%20draw",
  );

  assert.equal(
    url.href,
    `${UPSTREAM}/api/community/posts?sort=new&q=elk%20draw`,
  );
});

test("buildUpstreamUrl rejects paths outside the Community API", () => {
  assert.equal(buildUpstreamUrl("/api/account"), null);
  assert.equal(buildUpstreamUrl("/api/community-elsewhere"), null);
  assert.equal(buildUpstreamUrl("/api/community/../account"), null);
});

test("the proxy forwards only approved request headers and the raw POST body", async () => {
  const rawBody = Buffer.from('{"title":"A raw request"}');
  let fetchCall;
  const result = await proxyCommunityRequest(
    {
      method: "POST",
      originalUrl: "/api/community/posts?sort=new",
      rawBody,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-firebase-id-token": "firebase-token",
        authorization: "Bearer must-not-forward",
        cookie: "session=must-not-forward",
        origin: "https://huntplanner-66d5e.web.app",
        "x-forwarded-for": "203.0.113.10",
        "x-arbitrary": "must-not-forward",
      },
    },
    {
      fetchImpl: async (url, init) => {
        fetchCall = { url, init };
        return new Response('{"ok":true}', {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  );

  assert.equal(fetchCall.url.href, `${UPSTREAM}/api/community/posts?sort=new`);
  assert.equal(fetchCall.init.method, "POST");
  assert.strictEqual(fetchCall.init.body, rawBody);
  assert.equal(fetchCall.init.redirect, "error");
  assert.equal(fetchCall.init.headers.get("Accept"), "application/json");
  assert.equal(fetchCall.init.headers.get("Content-Type"), "application/json");
  assert.equal(
    fetchCall.init.headers.get("X-Firebase-ID-Token"),
    "firebase-token",
  );
  assert.equal(fetchCall.init.headers.get("Authorization"), null);
  assert.equal(fetchCall.init.headers.get("Cookie"), null);
  assert.equal(fetchCall.init.headers.get("Origin"), null);
  assert.equal(fetchCall.init.headers.get("X-Forwarded-For"), null);
  assert.equal(fetchCall.init.headers.get("X-Arbitrary"), null);
  assert.equal(result.status, 201);
  assert.equal(result.body.toString(), '{"ok":true}');
});

test("GET and HEAD are accepted without forwarding a body", async () => {
  for (const method of ["GET", "HEAD"]) {
    let init;
    const result = await proxyCommunityRequest(
      {
        method,
        originalUrl: "/api/community",
        rawBody: Buffer.from("ignored"),
        headers: {},
      },
      {
        fetchImpl: async (_url, fetchInit) => {
          init = fetchInit;
          return new Response(method === "HEAD" ? null : "upstream", {
            status: 200,
          });
        },
      },
    );

    assert.equal(init.body, undefined);
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), method === "HEAD" ? "" : "upstream");
  }
});

test("OPTIONS is handled locally without CORS or an upstream request", async () => {
  let calls = 0;
  const result = await proxyCommunityRequest(
    {
      method: "OPTIONS",
      originalUrl: "/api/community/posts",
      headers: { origin: "https://example.invalid" },
    },
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response();
      },
    },
  );

  assert.equal(result.status, 204);
  assert.equal(result.headers.Allow, "GET, POST, OPTIONS, HEAD");
  assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.body.length, 0);
  assert.equal(calls, 0);
});

test("oversized POST bodies are rejected before fetch", async () => {
  let calls = 0;
  const result = await proxyCommunityRequest(
    {
      method: "POST",
      originalUrl: "/api/community/posts",
      rawBody: Buffer.alloc(16_385),
      headers: { "content-type": "application/json" },
    },
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response();
      },
    },
  );

  assert.equal(result.status, 413);
  assert.deepEqual(JSON.parse(result.body), {
    error: "Request body is too large.",
  });
  assert.equal(calls, 0);
});

test("unsupported methods and paths are rejected before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response();
  };

  const methodResult = await proxyCommunityRequest(
    { method: "DELETE", originalUrl: "/api/community/posts", headers: {} },
    { fetchImpl },
  );
  const pathResult = await proxyCommunityRequest(
    { method: "GET", originalUrl: "/api/private", headers: {} },
    { fetchImpl },
  );

  assert.equal(methodResult.status, 405);
  assert.equal(methodResult.headers.Allow, "GET, POST, OPTIONS, HEAD");
  assert.equal(pathResult.status, 404);
  assert.equal(calls, 0);
});

test("only safe upstream response headers are returned and caching is disabled", async () => {
  const result = await proxyCommunityRequest(
    { method: "GET", originalUrl: "/api/community/posts", headers: {} },
    {
      fetchImpl: async () =>
        new Response("rate limited", {
          status: 429,
          headers: {
            "Cache-Control": "public, max-age=3600",
            "Content-Language": "en",
            "Content-Type": "text/plain",
            "Retry-After": "30",
            "Set-Cookie": "secret=never",
            "X-Upstream-Secret": "never",
          },
        }),
    },
  );

  assert.equal(result.status, 429);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.headers["content-language"], "en");
  assert.equal(result.headers["content-type"], "text/plain");
  assert.equal(result.headers["retry-after"], "30");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers["x-upstream-secret"], undefined);
});

test("upstream failures return a generic 502 without leaking details", async () => {
  const result = await proxyCommunityRequest(
    { method: "GET", originalUrl: "/api/community/posts", headers: {} },
    {
      fetchImpl: async () => {
        throw new Error("private upstream details");
      },
    },
  );

  assert.equal(result.status, 502);
  assert.deepEqual(JSON.parse(result.body), {
    error: "Community service is temporarily unavailable.",
  });
  assert.doesNotMatch(result.body.toString(), /private upstream details/);
});

test("upstream timeouts return a generic 504", async () => {
  const result = await proxyCommunityRequest(
    { method: "GET", originalUrl: "/api/community/posts", headers: {} },
    {
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
        }),
    },
  );

  assert.equal(result.status, 504);
  assert.deepEqual(JSON.parse(result.body), {
    error: "Community service timed out.",
  });
});

test("sendProxyResponse applies the proxy result to an Express response", () => {
  const calls = [];
  const response = {
    status(value) {
      calls.push(["status", value]);
      return this;
    },
    set(name, value) {
      calls.push(["set", name, value]);
      return this;
    },
    send(body) {
      calls.push(["send", body.toString()]);
      return this;
    },
  };

  sendProxyResponse(response, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
    body: Buffer.from("{}"),
  });

  assert.deepEqual(calls, [
    ["status", 200],
    ["set", "Cache-Control", "no-store"],
    ["set", "Content-Type", "application/json"],
    ["send", "{}"],
  ]);
});
