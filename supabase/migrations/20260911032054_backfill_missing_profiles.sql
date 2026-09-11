-- Backfills profiles for auth users that predate the on_auth_user_created
-- trigger.
--
-- The trigger only fires on INSERT into auth.users, so accounts that already
-- existed when the Phase 1 migrations were applied never received a profiles
-- row. loadProfile() then returns null for a valid session, and requireUser()
-- redirects to /login, which the browser bounces back from: an infinite
-- sign-in loop. The reconciliation migration removed the legacy tables but left
-- these auth users in place.
--
-- Idempotent: on conflict (id) do nothing makes this a no-op for users that
-- already have a profile, and safe to re-run.

insert into public.profiles (id, email)
select users.id, coalesce(users.email, '')
from auth.users as users
on conflict (id) do nothing;
