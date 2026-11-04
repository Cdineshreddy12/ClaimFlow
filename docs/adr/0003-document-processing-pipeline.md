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

Classification runs inline on register rather than through a job queue —
see the Decision section below, which this supersedes. OCR has since
landed in front of it and runs inline too, on the same bytes, which is
the case the queue was being held in reserve for.

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

The original decision here was a Postgres-native job queue (pg-boss, or a
`processing_jobs` table polled by a worker) with upload enqueueing a job
and never calling OCR/AI in the request. **What got built runs inline
instead.** The reasoning that ruled out Redis was never the interesting
part; the queue itself turned out to be unnecessary.

- The browser uploads to S3 directly via a pre-signed `PUT`. The register
  call (`POST /claims/:claimId/documents`) then reads the object once, runs
  Textract and the classifier against those same bytes, and returns the
  suggestion in its own response.
- **No queue, and no `src/workers/`.** The pipeline is two external calls
  deep, not the multi-step graph this ADR anticipated, and a desk exec is
  watching the upload when they happen. A queue would buy durability the
  caller cannot use: it would have to poll for a suggestion it is already
  waiting on, and the suggestion is optional anyway.
- Pre-auth extraction is the one AI step that is _not_ inline on upload —
  it reads every confirmed document at once, so it gets its own explicit
  `POST /claims/:claimId/preauth-fields/extract` that the desk triggers.
- Every AI step degrades instead of failing. Textract failing leaves the
  classifier working without OCR text; the classifier failing leaves the
  document stored with no suggestion; the summariser failing leaves the
  query's fields blank. None of them can fail the write they decorate.

"A failed AI call must never require re-uploading the document" still
holds — it is just satisfied by the steps being re-runnable or
hand-correctable rather than by a retrying worker. Pre-auth extraction
can be re-run any number of times (a re-run replaces its own suggestions
and provably never overwrites a value a human confirmed), and a document
that got no suggestion is one dropdown away from being filed by hand,
which is the same control the desk uses to correct a wrong one.

## Consequences

- `src/integrations/{storage,ocr,classifier,preauth,summariser}/` hold the
  external calls, one directory per capability, each behind an interface
  with a null-or-fallback path when no credentials are configured.
  `src/modules/documents/` owns the HTTP-facing upload/register API and
  calls into them; there is no worker tier between the two.
- Register latency includes an S3 read, a Textract call and a model call.
  Acceptable while it is one document at a time with someone watching;
  the first feature that processes documents unattended or in bulk —
  bulk upload, a re-classify-everything admin action — is the point to
  revisit the queue, and it should be Postgres-native when it arrives,
  for the volume reason above (~650 admissions/month) that still holds.
- There is deliberately no re-classify endpoint. Adding one is cheap if
  the desk ever asks; nobody has, because correcting the slot by hand is
  faster than asking the model again.
