-- Sequence for practitioner application numbers (R1 + zero-padded number).
CREATE SEQUENCE IF NOT EXISTS application_no_seq START 1;

-- A reg. no. must be unique among live practitioners. Legacy duplicates are migrated
-- with the extra rows soft-deleted or flagged (see the duplicates tool), so this is partial.
CREATE INDEX IF NOT EXISTS practitioners_regno_live_idx ON practitioners ("regNo") WHERE "deletedAt" IS NULL;
