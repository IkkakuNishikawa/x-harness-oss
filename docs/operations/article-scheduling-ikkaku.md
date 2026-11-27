# Scheduled X Articles (custom deployment)

Upstream base: `Shudesu/x-harness-oss` main `107da8b` (2026-11-27), v0.10.0.
This deployment retains cloud Article scheduling from the previous fork.

- POST `/api/articles/:articleId/schedule`: `{ xAccountId, scheduledAt }`, with an explicit ISO timezone; dates must be at least one minute in the future.
- GET `/api/articles/scheduled?xAccountId=...&status=...`: list pending schedules and history.
- DELETE `/api/articles/scheduled/:id?xAccountId=...`: cancel a pending schedule; keep its history and the X draft.
- MCP: `schedule_article`, `list_scheduled_articles`, `cancel_scheduled_article`. Use this source build: these tools are not in the upstream npm build.
- Dashboard Articles: choose a saved article and Japan time, or supply an existing X Article draft ID. Creating an X draft consumes X's draft quota. Unsaved changes must be saved first. Image warnings leave a draft for review without scheduling it.
- Cloudflare Cron runs every five minutes, independently of broad automation settings. Publication normally happens within five minutes after the chosen time. Monthly budget refusals and X rate limits leave the item queued. Provider failures can delay publication.
- Conditional D1 claim and unique active-article index prevent duplicate scheduled sends. Ambiguous failures are stopped for operator review. Never requeue an uncertain publish without checking X.
- Scheduled publication updates the associated article studio record. Immediate publication is blocked while a schedule is active.

## Database compatibility

Migration `025-scheduled-articles.sql` (both bootstrap and historical migrations) uses IF NOT EXISTS, preserving the old fork's `scheduled_articles` table and data. The original custom migration was named 019; upstream independently used 019 for security/cost features, so it must not be treated as already applied based on its number alone.

Existing installs require a schema audit and backup. Apply only missing historical migrations; never overwrite a populated DB with the fresh baseline. Keep the encryption key stable and backed up securely. Production Wrangler settings are in a gitignored `wrangler.production.local.toml` file.

## Validation

Unit/SQLite integration coverage includes instant comparisons across timezones, account filtering, uniqueness, overlapping claims, cancellation guards, authentication/roles, budget refusal, ambiguous send failures, usage-accounting failure and immediate-publication guards. Production smoke checks register a fictitious draft for 2099, confirm duplicate rejection/listing, then cancel it. No real X article is created or published by these checks.

## Idle cost control

Daily follower snapshot polling is opt-in (`follower_snapshots_enabled`, default false). With no due schedules, active gates, enrolled steps, or queued integrations, Cron makes no external X/AI/LINE calls. The settings screen labels follower polling as billable and unnecessary for scheduling. Grok digest remains opt-in and no AI key is provisioned by this upgrade. The application monthly X budget is a stop threshold, not a subscription fee or a provider-enforced hard cap.
