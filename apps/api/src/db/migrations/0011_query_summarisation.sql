ALTER TABLE "queries" ADD COLUMN "summarised_by" text;--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "deadline_inferred" boolean DEFAULT false NOT NULL;