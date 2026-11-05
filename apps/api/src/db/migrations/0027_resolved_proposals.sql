-- Which proposals in a conversation have already been acted on.
--
-- Conversations outlived the tab (migration 0026), which meant their
-- cards did too: reopening last week's thread offered to file a
-- document that was filed last week. The approval failed honestly with
-- a 409, but a button that exists only to tell you it shouldn't have
-- is how a desk learns to distrust the panel.
--
-- A map keyed by the tool_use id the card already carries, so no new
-- identifier has to be invented or kept in sync.
--
-- Approvals only. "Not now" is not spent — it is a decision to leave
-- the card alone, and a conversation reopened next week should still
-- offer it.
alter table "assistant_conversations"
  add column if not exists "resolved_proposals" jsonb not null default '{}'::jsonb;
