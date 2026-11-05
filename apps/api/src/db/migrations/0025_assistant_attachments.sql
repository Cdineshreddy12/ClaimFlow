-- Files dropped into the assistant before anyone knows the claim.
--
-- `documents` requires a claim_id and always will — a document that
-- belongs to no claim is not a thing this product has. But the moment a
-- desk can hand the app a pile of scans and ask "where do these go",
-- there is a real window where the claim is genuinely unknown, and
-- that's what this table holds.
--
-- Suggestion columns mirror `documents` on purpose (docs/adr/0005):
-- suggested_claim_id and suggested_slot are what the recogniser thinks,
-- filed_document_id is what a human approved. An attachment nobody
-- approved keeps both halves of that story.
create table if not exists "assistant_attachments" (
  "id" uuid primary key default gen_random_uuid(),
  "file_url" text not null,
  "file_name" text not null,
  "content_type" text not null,
  "uploaded_by" uuid references "members"("id"),
  "suggested_claim_id" uuid references "claims"("id") on delete set null,
  "suggested_slot" text,
  "claim_confidence" numeric(4,3),
  "slot_confidence" numeric(4,3),
  "recognition_reason" text,
  "ocr_confidence" numeric(4,3),
  "filed_document_id" uuid references "documents"("id") on delete set null,
  "filed_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

-- The panel's only query is "what have I dropped that isn't dealt with
-- yet", which is this index.
create index if not exists "assistant_attachments_uploaded_by_idx"
  on "assistant_attachments" ("uploaded_by");
--> statement-breakpoint

-- RLS on, no policy, same as every other table here: this API connects
-- as the owner and authorizes in the route layer (docs/adr/0002). The
-- switch matters for any other connection that is subject to it.
alter table "assistant_attachments" enable row level security;
