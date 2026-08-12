ALTER TABLE member_profiles ADD COLUMN member_type TEXT NOT NULL DEFAULT 'general'
  CHECK (member_type IN ('', 'general', 'association', 'vendor'));
ALTER TABLE member_profiles ADD COLUMN roster_member_number TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN roster_verified_name TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN roster_verified_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_profiles_roster_identity
ON member_profiles(member_type, roster_member_number)
WHERE member_type IN ('association', 'vendor') AND roster_member_number <> '';
