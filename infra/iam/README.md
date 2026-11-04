# IAM policy for the `claimflow-api` user

The exact inline policy attached to the `claimflow-api` IAM user, kept
here so the API's blast radius is reviewable in the repo rather than
only visible in the AWS console.

Apply with:

```sh
aws iam put-user-policy \
  --user-name claimflow-api \
  --policy-name claimflow-documents-bucket-only \
  --policy-document file://infra/iam/claimflow-api-policy.json
```

## Why each grant exists

**S3, scoped to one bucket ARN.** This key lives in developer `.env`
files, so it is never a broad deployment credential. Object-level
actions are limited to `zopkit-staging-claimflow-documents/*`.

**`textract:DetectDocumentText`, and nothing else.** OCR for handwritten
doctors' notes (docs/adr/0003). Deliberately the narrowest Textract
grant that does the job:

- Not `AnalyzeDocument` — forms/tables extraction we don't use and which
  costs several times more per page.
- Not `StartDocumentTextDetection` / `GetDocumentTextDetection` — the
  async API, which would also require granting Textract its own read
  access into the bucket. The sync call takes the bytes inline, so
  Textract never touches S3 and that grant isn't needed.
- Not `AnalyzeID` or `AnalyzeExpense` — different APIs for identity
  documents and receipts, neither of which this product calls.

`Resource: "*"` is not laziness: `textract:DetectDocumentText` has no
resource-level permissions, so AWS rejects any ARN other than `*` for
this action. The narrowing here is in the action list.
