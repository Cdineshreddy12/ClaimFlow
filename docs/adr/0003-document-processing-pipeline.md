# 0003 — Document processing pipeline

**Status: upload, OCR, classification and human-confirm are all built
and verified against real infrastructure.**

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

The query inbox is summarised the same way — Claude reads a pasted TPA
email and returns a summary, the list of requested items, and the reply
deadline resolved to an absolute time. It only fills fields the desk
left blank: someone who typed their own summary has already read the
email, and overwriting that would be the model second-guessing a human
who was there. A generated summary is labelled as such, and a deadline
calculated from "within 48 hours" is flagged as calculated rather than
read. The original email always renders underneath (adr 0005).

## OCR

Textract `DetectDocumentText` runs **in front of** the classifier for
image uploads, and its text is passed alongside the image rather than
instead of it. The two are good at different things: Textract gets
characters out of messy handwriting, the model works out what the
document actually is. Giving both beats either alone.

Verified on a simulated handwritten ward note — jittered baseline,
slight page rotation, handwriting face. Textract read 13 lines at 0.955
mean confidence, and the classifier then placed it as "Treating
doctor's note" at 0.98 from a file named `scan0091.png`, which tells
you nothing.

Deliberately the synchronous API only. The async one
(`StartDocumentTextDetection`) would additionally require granting
Textract its own read access into the documents bucket; passing bytes
inline keeps that grant unnecessary. The cost is that PDFs don't go
through OCR — the sync call won't take one — but the model reads PDF
text natively anyway, so OCR adds nothing there.

OCR never breaks anything. It enhances a suggestion that is itself
optional, so a Textract outage leaves the classifier working without
it, and a classifier failure still leaves the upload intact.

The `claimflow-api` IAM user was granted `textract:DetectDocumentText`
and nothing else — see `infra/iam/README.md`, which now holds the full
policy and the reasoning for each grant.

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
