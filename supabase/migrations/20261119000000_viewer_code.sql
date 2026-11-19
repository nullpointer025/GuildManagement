-- View-only access: a second, optional code per guild. Whoever enters it can look
-- at the roster, raid teams and guild league history but can't change anything.
-- viewer_session_version is bumped whenever the viewer code changes, which signs
-- out the viewers only (officers keep their session).
--
-- Run once in the Supabase SQL editor after 20261118020000_league_session.sql.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS viewer_code TEXT UNIQUE;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS viewer_session_version INTEGER NOT NULL DEFAULT 1;
