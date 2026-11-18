-- Guild League imports from the battle-record .xlsx export.
--
-- Run once in the Supabase SQL editor after 20261114000000_multi_guild.sql.
--
-- Each uploaded battle record belongs to one field: the Main field or the Sub
-- field. A player can fight Main one week and Sub the next, and their stats are
-- tracked separately per field. Leagues saved before this change count as Main.
ALTER TABLE guild_leagues ADD COLUMN IF NOT EXISTS field TEXT NOT NULL DEFAULT 'main';
ALTER TABLE guild_leagues DROP CONSTRAINT IF EXISTS guild_leagues_field_check;
ALTER TABLE guild_leagues ADD CONSTRAINT guild_leagues_field_check CHECK (field IN ('main', 'sub'));

-- The other guild in the battle record.
ALTER TABLE guild_leagues ADD COLUMN IF NOT EXISTS opponent TEXT;

-- The extra columns of the export. NULL means "not recorded" (leagues imported
-- before this change), so it's left out of averages instead of counting as 0.
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS job TEXT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS heal BIGINT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS endure BIGINT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS deaths BIGINT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS revives BIGINT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS monsters BIGINT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS flag_repairs BIGINT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS boss_kills BIGINT;
ALTER TABLE guild_league_stats ADD COLUMN IF NOT EXISTS boss_damage BIGINT;
