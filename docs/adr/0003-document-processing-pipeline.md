# 0003 — Document processing pipeline

**Status: upload (pre-signed S3) and human-confirm are built and verified
against a real bucket. OCR/AI classification is not wired up yet** — no
provider credentials exist for it. Every document today goes straight from
upload to "unclassified, pick a slot manually," which already satisfies
the human-confirm requirement on its own; AI just hasn't arrived to make
that pick a suggestion instead of a cold start. The job-queue decision
below is written for when that lands, not retrofitted after. Same
boundary applies to the query inbox's AI summary field — it's entered by
hand for now, not auto-generated.

## Context

Upload → OCR → AI classification → checklist match → human confirmation →
completeness recalculation is a multi-step pipeline with external calls
(OCR, AI) that can fail independently. Doctors' notes are often handwritten
scans, so OCR confidence varies.

## Decision

- The upload API only validates and stores the file (S3), then enqueues a
  job. It never runs OCR/AI synchronously in the request.
- Background processing uses a **Postgres-native job queue** (e.g. pg-boss,
  or a plain `processing_jobs` table polled by a worker) — deliberately not
  BullMQ/Redis. The stack is already Supabase-only; adding Redis is one more
  managed service for a volume (~650 admissions/month) that doesn't need it.
- Jobs are idempotent, retry-tracked, and their status is persisted. A failed
  AI call must never require re-uploading the document — only a retry of the
  processing step.

## Consequences

- `apps/api/src/workers/` and `src/integrations/{storage,ocr,ai}/` are
  separate from `src/modules/documents/`, which only owns the HTTP-facing
  upload/status API.
- If processing volume ever genuinely outgrows Postgres-polling throughput,
  revisit Redis — not before.
