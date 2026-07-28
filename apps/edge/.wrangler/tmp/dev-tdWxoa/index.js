var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var noStoreHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
var encoder = new TextEncoder();
function fromHex(value) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index++) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}
__name(fromHex, "fromHex");
async function verifySignature(secret, value, supplied) {
  const signature = fromHex(supplied);
  if (!signature || secret.length < 32) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(value));
}
__name(verifySignature, "verifySignature");
function validStorageKey(path) {
  if (!path || path.length > 1024 || path.includes("\\") || path.includes("//") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every((segment) => segment && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
}
__name(validStorageKey, "validStorageKey");
function reject(message, status) {
  return new Response(message, { status, headers: noStoreHeaders });
}
__name(reject, "reject");
var src_default = {
  async fetch(request, env, ctx) {
    if (!["GET", "HEAD"].includes(request.method)) return reject("Method Not Allowed", 405);
    if (!env.MEDIA_SIGNING_SECRET || env.MEDIA_SIGNING_SECRET.length < 32 || !env.PLAYER_ORIGIN) return reject("\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19", 503);
    const origin = request.headers.get("origin");
    if (origin && origin !== env.PLAYER_ORIGIN) return reject("\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E2D\u0E19\u0E38\u0E0D\u0E32\u0E15", 403);
    const url = new URL(request.url);
    let path;
    try {
      path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return reject("\u0E04\u0E33\u0E02\u0E2D\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07", 400);
    }
    const expiresRaw = url.searchParams.get("expires") || "";
    const expires = Number(expiresRaw);
    const sessionId = url.searchParams.get("sessionId") || "";
    const videoId = url.searchParams.get("videoId") || "";
    const fileId = url.searchParams.get("fileId") || "";
    const supplied = url.searchParams.get("signature") || "";
    const now = Math.floor(Date.now() / 1e3);
    if (!validStorageKey(path) || !/^\d{10}$/.test(expiresRaw) || !Number.isSafeInteger(expires) || expires < now || expires > now + 900 || !/^[0-9a-f-]{36}$/i.test(sessionId) || !/^[A-Za-z0-9_-]{10,128}$/.test(videoId) || !/^[A-Za-z0-9_-]{10,128}$/.test(fileId)) return reject("\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E23\u0E31\u0E1A\u0E0A\u0E21\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E2B\u0E23\u0E37\u0E2D\u0E2B\u0E21\u0E14\u0E2D\u0E32\u0E22\u0E38", 403);
    const signedValue = [path, expires, sessionId, videoId, fileId].join("\n");
    if (!await verifySignature(env.MEDIA_SIGNING_SECRET, signedValue, supplied)) return reject("\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E2D\u0E19\u0E38\u0E0D\u0E32\u0E15", 403);
    const range = request.headers.get("range");
    if (range && !/^bytes=\d*-\d*$/.test(range)) return reject("\u0E0A\u0E48\u0E27\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07", 416);
    let object;
    try {
      object = await env.VIDEOS.get(path, range ? { range: request.headers } : void 0);
    } catch {
      return reject("\u0E0A\u0E48\u0E27\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07", 416);
    }
    if (!object) return reject("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D", 404);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300, no-transform",
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "cross-origin"
    });
    if (origin === env.PLAYER_ORIGIN) {
      headers.set("Access-Control-Allow-Origin", env.PLAYER_ORIGIN);
      headers.set("Vary", "Origin");
    }
    const servedRange = object.range;
    if (servedRange && "offset" in servedRange && typeof servedRange.offset === "number" && typeof servedRange.length === "number") {
      headers.set("Content-Range", `bytes ${servedRange.offset}-${servedRange.offset + servedRange.length - 1}/${object.size}`);
    }
    const bytes = servedRange && "length" in servedRange && typeof servedRange.length === "number" ? servedRange.length : object.size;
    headers.set("Content-Length", String(bytes));
    const status = range ? 206 : 200;
    if (env.MEDIA_ANALYTICS) {
      ctx.waitUntil(Promise.resolve(env.MEDIA_ANALYTICS.writeDataPoint({
        blobs: [videoId, fileId],
        doubles: [status, bytes],
        indexes: [sessionId]
      })));
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  }
};

// ../../node_modules/.pnpm/wrangler@4.114.0_@cloudflare+workers-types@4.20260702.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@4.114.0_@cloudflare+workers-types@4.20260702.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-qXxLWe/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@4.114.0_@cloudflare+workers-types@4.20260702.1/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-qXxLWe/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
