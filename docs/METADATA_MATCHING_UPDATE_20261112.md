# Metadata matching update — 2026-11-12

- Changed-batch CSV adds old_embed from the stored original record's video_embed_code_raw entry whose source_field is embed. Missing/ambiguous original fields remain empty and are reported in the export UI. Every changed source row is retained, including shared destination videos.
- WordPress plugin 1.1.4 matches decoded iframe src exactly, independent of title/HTML formatting. All posts sharing that source URL within the selected post type are listed for approval. Identical duplicate input mappings merge; conflicting destination embeds are blocked. Four-column legacy CSV retains strict title matching. New-format missing old_embed does not fall back to title.
- Video matching threshold is selectable 0–100, default 80. Zero explicitly accepts unrelated candidates; a valid readable source image/video is still required. Existing jobs retain their threshold. Start a new round to use changed settings.
- Several source posts can share a video. Each source updates once; later committed nonblank title/description wins. Rows retain individual audit records and rollback requires reverse order when a shared video changed subsequently. Explicit source target IDs remain enforced.

## Local verification
- WordPress/PHP with real isolated InnoDB fixture tables: 25 checks including shared embeds, renamed titles, entity decoding, replay, rollback and failed-write atomicity.
- PostgreSQL isolated fixture database: 19 integration tests including 0/70/90/100 thresholds, many-to-one mapping, per-source CSV export, restart, concurrency, permission revocation and rollback.
- API export: 5 tests. Admin CSV and video scan: 6 tests.
- API and admin TypeScript: passed.
- Chromium actual React UI, mocked API: score 0 request, reload, pause/resume and applied result passed.

## Deployment and impact
No schema changes; no additional migration. Deploy admin/API/metadata-worker together and install plugin ZIP 1.1.4. Pause/drain in-flight matching before replacing worker; checkpoints and audits remain. Rollback code using previous release; revert metadata in reverse order through audited rollback where required. R2 files, IDs, ownership and media access remain unchanged. WordPress embed updates occur only through the existing explicit approval flow.
Production deployment, live R2 behavior and production WordPress import were not verified or performed in this turn.
