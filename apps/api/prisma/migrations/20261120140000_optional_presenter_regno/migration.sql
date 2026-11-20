-- Presenters and moderators may be added without a registration number (they then earn no bonus).
ALTER TABLE activity_presenters ALTER COLUMN "regNo" DROP NOT NULL;
ALTER TABLE activity_moderators ALTER COLUMN "regNo" DROP NOT NULL;
