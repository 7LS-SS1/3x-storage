# Iframe domain access debug

## Confirmed cause
The stored `SystemConfig.allowAllDomains` policy controls authorization, poster access, and playback refresh. Previously its schema default and missing-config fallbacks were false, requiring an active assigned domain. Existing false policies require the new migration or enabling Allow all domains in the admin UI.

## Fix
- Default new configurations and missing-config fallbacks to allow all domains.
- Migration `20260916090000_default_allow_all_domains` enables the existing singleton policy and changes the database default.
- Existing explicit restricted-mode controls remain available.
- Signed media URLs, session tokens, video availability checks, and rate limits remain enforced.

## Observed runtime error
Attempting to enable the current database policy from the development machine failed:

```text
PrismaClientInitializationError
Can't reach database server at [configured database host]:5432
```

The connection did not succeed; the database update was not applied. The configured host is an internal-looking service hostname; reachability from the deployment network has not been tested. Credentials are omitted.

## Validation
- API suite: 10 test files, 37 tests passed in the original workspace.
- API TypeScript check: passed.
- Added coverage for an unregistered HTTPS domain with no SystemConfig row.
- Existing coverage includes HTTP origins, absent Referer, and restricted mode.
- Production deployment, SQL migration execution, and browser playback are not yet verified.

## Deployment
Deploy the commit and run Prisma migrate deploy in the deployment database network. The repository Dockerfile includes a migrate target; verify that the deployment executes it successfully. Pushing Git alone does not confirm migration execution.

## Follow-up: playback stops around 330 seconds
The user screenshot confirms `allowAllDomains: true` was saved on the server. Domain registration alone does not explain the remaining playback failure.

Confirmed source-level defect: refreshing authorization replaces the media URL, but the player previously did not restore currentTime or resume playback after reloading the source. The fix captures position and paused state before replacement and restores them on loadedmetadata for HLS and direct media. Pending listeners are removed on replacement/unmount.

Refresh failures now log `[playback-refresh]` with the HTTP status and endpoint path, without tokens or signed media URLs. The exact production failure is still unconfirmed pending the affected embed URL and browser network evidence. About 330 seconds is a reported symptom, not a confirmed fixed timeout.

Validation: player tests 14/14 passed, including position restoration at 330 seconds, preserving pause, and listener cleanup. Player TypeScript passed. Full browser playback beyond expiry and production deployment remain unverified.

## Confirmed HTTP 429 on embed authorization
The user screenshot now shows HTTP 429. The authorize endpoint permits 30 requests/minute per request IP; server-rendered embed pages call it from the admin server without a viewer identifier, pooling viewers behind the admin IP.

Fix: admin signs a short-lived, hashed viewer identifier using SESSION_SECRET, from the nearest proxy-appended X-Forwarded-For address when TRUST_PROXY=true. API verifies the signature and timestamp before selecting a per-viewer authorization bucket. Missing/invalid identifiers retain IP limiting. No arbitrary client header is trusted as a tracker. Both admin and API must deploy together with matching SESSION_SECRET. The actual proxy chain must append the visitor address for correct granularity; missing/unusable proxy data falls back to the original IP bucket.

API suite: 39 tests passed. API/admin TypeScript passed after correcting the tracker callback type. Live deployment and viewer separation on the production proxy remain unverified. This patch addresses initial authorization 429, not a verified fix for long-duration refresh failures.
