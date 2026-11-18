-- Up to two guild leagues are fought on one day. "session" says which one (1st or
-- 2nd) a battle record belongs to, so attendance counts guild leagues rather than
-- days: attending one of a day's two leagues is 1/2. Records saved before this
-- change count as the day's 1st league.
--
-- Run once in the Supabase SQL editor after 20261118010000_league_pending.sql.
ALTER TABLE guild_leagues ADD COLUMN IF NOT EXISTS session SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE guild_leagues DROP CONSTRAINT IF EXISTS guild_leagues_session_check;
ALTER TABLE guild_leagues ADD CONSTRAINT guild_leagues_session_check CHECK (session IN (1, 2));
