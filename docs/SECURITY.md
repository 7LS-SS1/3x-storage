# Security

## Session lifecycle

- Session identifier is an opaque 256-bit CSPRNG token. The browser receives only the token; PostgreSQL stores only its SHA-256 hash.
- A new login always rotates the token and revokes prior active sessions for the account, preventing session fixation and stale privilege retention.
- Sessions enforce both an idle expiry (`SESSION_TTL_SECONDS`, default 1 hour) and an absolute expiry (`SESSION_ABSOLUTE_TTL_SECONDS`, default 8 hours).
- Session validation checks revocation, both expiries, active account status, database role and a keyed User-Agent fingerprint at the data-access layer.
- Middleware is only an optimistic format/presence check. Protected layouts and every sensitive API operation must call the database-backed session verifier.
- Production session cookie must use a `__Host-` name, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, high priority and no Domain attribute.
- Logout revokes the database record, expires both cookies and returns restrictive cache cleanup headers.

## CSRF and request origin

- State-changing browser routes require an exact configured Origin and reject cross-site `Sec-Fetch-Site`.
- CSRF uses a separate 256-bit token. The browser cookie and `X-CSRF-Token` header must match, and a keyed HMAC of the token must match the session record.
- SameSite is defense in depth and is not treated as the sole CSRF control.

## Authentication abuse controls

- Password verification uses Argon2id.
- Login responses are generic to avoid account enumeration; unknown accounts still perform Argon2 work.
- Failed attempts are tracked by a keyed, non-reversible email/IP bucket and by account. Five failures block attempts for 15 minutes.
- Login success/failure and logout are written to AuditLog without passwords, tokens or raw IP addresses.

## Authorization and playback

- Role checks belong in the data/API layer, never only in navigation or middleware.
- Playback authorization ignores client-supplied storage paths and domains. It loads the READY, non-deleted video, playback file and active allowed domains from PostgreSQL.
- Domain matching uses IDNA ASCII normalization and exact label boundaries; substring matching is prohibited.
- Media and play-event signatures use HMAC SHA-256 with short expiries and constant-time/WebCrypto verification.
- Play events are signed, expire with the playback session and are idempotent through a database uniqueness constraint.
- R2 remains private. The edge worker validates every claim, limits expiry to 15 minutes, rejects traversal/control characters, supports only GET/HEAD and never lists objects.

## Headers and deployment

- Admin pages use per-request CSP nonces, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, no-sniff, restrictive permissions and cross-origin policies.
- Private responses use `Cache-Control: no-store`.
- API CORS uses exact configured origins. Swagger is disabled in production unless `ENABLE_API_DOCS=true`.
- Set `TRUST_PROXY=true` only behind a trusted proxy that overwrites `X-Forwarded-For`; otherwise forwarded IP headers are ignored.
- Production startup fails closed when cryptographic secrets are missing, shorter than 32 characters or still contain placeholder values.
- Use a secret manager for session, CSRF, IP salt, media signing, database, Redis and Cloudflare credentials. Never expose them to browser bundles.

Run `pnpm audit --audit-level high` in CI. Dependency overrides in `pnpm-workspace.yaml` pin patched transitive versions for current security advisories.
