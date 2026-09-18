# Multipart upload fix — 2026-09-18

## Verified

- The installed AWS SDK signs `x-amz-checksum-crc32=AAAAAA==` for a bodyless UploadPart command with default configuration. `requestChecksumCalculation: WHEN_REQUIRED` removes this empty-body checksum from browser upload URLs.
- Initial live CORS inspection returned the production origin with a trailing slash. A subsequent inspection found the exact origin already present; the apply script therefore required no change in that run.
- Live R2 probe with the corrected signer: OPTIONS 204, PUT 200, matching Allow-Origin, ETag present and exposed. The temporary multipart upload was aborted afterwards. No application video or database record was created.
- API: 40 tests passed. Admin: 19 tests passed. Both TypeScript checks passed.

## Changes

- StorageService configures checksum calculation only when required, since the browser supplies multipart bytes after signing.
- Only multipart presign and record handlers skip the generic IP throttle. Admin authentication, CSRF, session ownership and part validation remain active. Initiate and other handlers retain throttling.
- Browser retries honor Retry-After. Idempotent part recording retries transient failures without uploading the bytes again. Permanent API errors are not retried by the part loop.
- CORS templates retain the previous origin and add `https://3x-storage.206.189.129.122.sslip.io` without a trailing slash.

## Deployment remaining

The upload fix is prepared on top of production `origin/main` in an isolated checkout. Unrelated local edits and `.env` are excluded. Browser access to the Coolify HTTP URL was denied by the browser URL policy. Git delivery does not verify production deployment.

Deploy the reviewed upload fix to the application's configured production branch, then redeploy API and admin in Coolify. Merely redeploying the old commit does not deploy these changes.

Recommended initial runtime values:

```env
UPLOAD_MAX_CONCURRENT_FILES=1
UPLOAD_MAX_CONCURRENT_PARTS=2
UPLOAD_PART_SIZE_BYTES=67108864
```

After deployment, reload the upload page and retry a small file. Verify presign returns a URL without the empty-body CRC32, PUT returns 200, record succeeds, and complete succeeds. Then verify a larger queue. Existing in-progress sessions retain their original part size.

To inspect live storage without modifying it:

```powershell
node scripts/verify-r2-upload.cjs
```

To run the bounded live storage probe (creates and aborts only its own temporary multipart upload):

```powershell
node scripts/verify-r2-upload.cjs --probe
```

Full browser upload, multipart completion, and subsequent video processing have not been verified by this run.

References:
- https://developers.cloudflare.com/r2/buckets/cors/
- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html
