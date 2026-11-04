CREATE TABLE IF NOT EXISTS "claim_preauth_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" text,
	"ai_value" text,
	"confidence" numeric(4, 3),
	"source_snippet" text,
	"source_document_id" uuid,
	"extracted_by" text,
	"extracted_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_preauth_fields_claim_id_field_key_key" UNIQUE("claim_id","field_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_preauth_fields" ADD CONSTRAINT "claim_preauth_fields_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- set null, not cascade: discarding the document a value was read out of
-- must not silently delete a figure a human already confirmed.
DO $$ BEGIN
 ALTER TABLE "claim_preauth_fields" ADD CONSTRAINT "claim_preauth_fields_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_preauth_fields" ADD CONSTRAINT "claim_preauth_fields_confirmed_by_org_members_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_preauth_fields_claim_id_idx" ON "claim_preauth_fields" USING btree ("claim_id");
