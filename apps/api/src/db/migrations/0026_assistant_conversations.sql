-- Conversations with the desk assistant.
--
-- They lived in the browser and died with the tab, which docs/adr/0017
-- argued for on the grounds that a transcript is scratch and the things
-- worth keeping are written by the services an approval calls. That
-- holds for what the assistant *did*. It does not hold for what it
-- said: "what did it tell me about this claim yesterday" is a fair
-- question, and the answer was being thrown away.
--
-- `turns` is the readable record; `transcript` is the provider's own
-- message blocks, kept only so a conversation can be continued and
-- never parsed here. Separate columns because deriving what a person
-- reads from someone else's wire format means that format changing
-- breaks last month's history.
create table if not exists "assistant_conversations" (
  "id" uuid primary key default gen_random_uuid(),
  "member_id" uuid references "members"("id"),
  "title" text not null,
  "turns" jsonb not null default '[]'::jsonb,
  "transcript" jsonb not null default '[]'::jsonb,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint

-- The history list is "mine, most recent first", which is this index.
create index if not exists "assistant_conversations_member_idx"
  on "assistant_conversations" ("member_id", "updated_at" desc);
--> statement-breakpoint

alter table "assistant_conversations" enable row level security;
