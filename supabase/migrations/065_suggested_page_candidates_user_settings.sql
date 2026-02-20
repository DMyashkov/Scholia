-- Suggested page candidates: 5 or 10 (how many candidate pages the model sees when choosing expand_corpus)
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS suggested_page_candidates INTEGER NOT NULL DEFAULT 5
  CHECK (suggested_page_candidates IN (5, 10));
