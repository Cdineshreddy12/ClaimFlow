# 0003 — Document processing pipeline

**Status: upload, classification and human-confirm are built and
verified against a real bucket. OCR is not.**

Document sorting runs behind a `DocumentClassifier` interface with two
implementations:

- **`claude`** — reads the document itself (vision for scans, PDF input
  for forms) and returns a slot, a confidence and a source snippet. Used
  whenever `ANTHROPIC_API_KEY` is set. Messages API with a forced tool
  call for structured output. Verified against the live API on a
  synthetic scanned ultrasound report: classified correctly at 0.98 from
  the image alone, under the filename `IMG_0423.png` that gives the
  heuristic nothing. Also verified it abstains — a cafeteria menu named
  `treating-doctors-note-ultrasound-report.png` returned null and named
  the filename mismatch in its reason, where the heuristic would have
  filed it confidently and wrongly.
- **`heuristic`** — matches filename tokens against the claim's
  checklist slots. No credentials, no network. The fallback when no key
  is configured.

Falling back rather than failing is deliberate: a hospital without AI
credentials still gets useful sorting on the common case
(`ultrasound_report_0423.jpg`), and every downstream path is identical
because a human confirms either way. The suggestion carries
`classifiedBy` end to end so the UI says "Matched by filename" rather
than implying a model ran — a classifier that overstates itself is worse
than one that abstains.

Classification runs inline on register, not through the job queue below.
One call while a desk exec watches the upload doesn't need a queue; the
queue was reserved for the multi-step OCR pipeline, and that reasoning
still holds for when OCR lands in front of this.

Still not built: OCR for handwritten notes. The scoped `claimflow-api`
IAM user is S3-only, and Textract access is a permissions decision that
hasn't been made. The query inbox's summary field is also still typed by
hand.

The browser uploads straight to S3 using the pre-signed URL, same as any
other client of this API — that only works cross-origin because the
bucket has a CORS rule allowing `PUT`/`GET` from `http://localhost:*`.
That rule lives on the bucket itself (not in this repo, set via `aws
s3api put-bucket-cors`) and needs a matching entry for the real web app's
origin before this works outside local dev.

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
