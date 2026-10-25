# ECC audit remediation plan

Base: `a5c00e5` on `main`. Owner of implementation: Antigravity (`agy`). Owner of independent review: Codex. This file contains no credentials.

## Boundaries

- Work only in this Orca child worktree. Inspect current code and callers before editing; the audit was performed on an earlier commit.
- Preserve movie data, cached media, existing services, and public read-only API contracts. Do not deploy, restart production, merge, force-push, or test credentials against production in this task.
- The user supplied a replacement admin password to the coordinator. Do not place it in source, tests, examples, commits, prompts, logs, or this plan. Implement `ADMIN_PASSWORD` as a required secret. Production secret rotation is a separate deployment step after review.
- Use ECC `change-impact`, `security-review`, `rust-testing`, `react-testing`, and `delivery-gate` where relevant. Keep fixes bounded and report evidence and unknowns.

## Phase 1: access and proxy security

1. `backend/src/admin.rs`, `backend/src/lib.rs`, `frontend/src/components/AdminDashboard.tsx`: remove all default and alternate admin passwords, fail startup clearly if the secret is absent, require auth for the public crawler trigger or remove that route, remove offline admin login and fabricated operational data. Preserve the intended admin control flow.
2. Require a bounded lifetime for admin sessions and a server-side logout/invalidation path if practical. Avoid storing the admin bearer in persistent `localStorage`; document any compatibility choice.
3. `backend/src/proxy.rs`: restrict outgoing proxy requests to required upstream origins; validate URL scheme, host, port, DNS-resolved IPs, and every redirect destination, including IPv4/IPv6 private/link-local/loopback ranges. Prevent DNS rebinding with an appropriate connection strategy. Bound response and request resources. Redact signed URL/token values from logs and errors.
4. Validate the cache-clear `slug` in `backend/src/admin.rs` with the same safe-slug policy as stream routes before joining paths.

Acceptance: unauthorized crawler writes are rejected; old aliases cannot log in; missing admin secret fails startup; valid permitted media still streams; malformed/internal/redirected proxy targets are rejected; safe admin cache clear remains functional. Add focused Rust tests for each security boundary.

## Phase 2: player and subtitle correctness

1. `frontend/src/components/WatchPage.tsx`, `backend/src/playlist_cache.rs`: choose HLS source from the selected episode. Cache entries must distinguish episodes and source identity, with expiration tied to signed URL lifetime. A switch from episode 1 to 2 must load episode 2 media, including auto-next and resume.
2. Refresh expired master and child playlists coherently. Use valid query construction (`?refresh=1`, not string-appended `&` on a path), bounded retries, and a user-visible failure state. Avoid repeated stale playlist reloads.
3. `frontend/src/components/WatchPage.tsx`, `frontend/src/utils/subtitles.ts`: render untrusted VTT cue text safely; show only real language tracks instead of duplicating one cue list under many names.

Acceptance: a series with distinct episode URLs selects the correct URL for episode 2; the retry path reaches refresh and terminates on persistent failure; a VTT cue containing HTML is displayed as text; subtitle labels correspond to actual tracks. Add focused tests or isolated browser evidence. Do not claim sustained playback without a real browser/media check.

## Phase 3: data and delivery

1. `backend/src/db.rs`: replace ignored migration errors with versioned, explicit migration handling; make seed import atomic or resumable. Preserve existing SQLite data and record a rollback/backup path.
2. Review legacy Python/benchmark scripts that disable TLS validation or mention local credentials. Keep them out of the production build and document whether they are still used; do not make broad deletions without evidence.
3. Run `npm run build`, `cargo test --locked` excluding the live upstream test, and targeted lint/security tests. Capture failures separately from pre-existing lint issues. Produce a concise handoff with changed files, commit(s), tests, remaining risks, and deployment steps.

Acceptance: the worktree has reviewable commits and a clean status; the parent `main` remains untouched. Codex reviews the diff before merge or deployment.
