CREATE TABLE IF NOT EXISTS "doctor_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"token" text NOT NULL,
	"doctor_name" text NOT NULL,
	"requested_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_approvals_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_approvals" ADD CONSTRAINT "doctor_approvals_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_approvals" ADD CONSTRAINT "doctor_approvals_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_approvals_claim_id_idx" ON "doctor_approvals" USING btree ("claim_id");