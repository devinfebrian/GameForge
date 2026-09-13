-- GameForge AI: a monotonic ordering key for the chat transcript (Phase 4)
--
-- persist_generation writes the user turn and the assistant turn inside one
-- transaction, and Postgres `now()` is transaction_timestamp(), so both rows get
-- an identical created_at. Measured on the linked project: both rows of a run
-- carry 2026-09-11T17:41:49.708047+00:00.
--
-- Ordering the chat by created_at is therefore not a total order. It currently
-- looks correct only because the database happens to return the user row first
-- by physical row order, which no VACUUM, different index choice, or concurrent
-- insert is obliged to preserve. Phase 4 pairs turns with versions by position,
-- so an unstable order would misattribute versions as well as render the
-- conversation out of sequence.
--
-- This is an ordering key, not a version link: game_messages still records no
-- version_id, and turns are still associated with versions by position.
--
-- seq is supplied by a column default, so persist_generation needs no change and
-- no caller can influence the value.

-- Named as `serial` would name it for a column called seq.
create sequence if not exists public.game_messages_seq_seq;

alter table public.game_messages
  add column if not exists seq bigint not null
    default nextval('public.game_messages_seq_seq');

alter sequence public.game_messages_seq_seq
  owned by public.game_messages.seq;

create index if not exists game_messages_game_id_seq_idx
  on public.game_messages (game_id, seq);

-- The default is evaluated as the inserting role, so that role needs USAGE on the
-- sequence. matched to the table-level grants: service_role writes transcripts,
-- and authenticated holds an insert grant it does not currently use.
grant usage, select on sequence public.game_messages_seq_seq to service_role;
grant usage, select on sequence public.game_messages_seq_seq to authenticated;
