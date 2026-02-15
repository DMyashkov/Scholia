-- Migration 18: Follow-up assistant messages (add page + re-answer flow)
-- Instead of a continuation column, we use a separate message with a link to the previous one.
-- When user clicks "Yes" on suggested page, we insert a new assistant message (no user in between)
-- with follows_message_id pointing to the "can't answer" message.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS follows_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS indexed_page_display TEXT DEFAULT NULL;
-- indexed_page_display: e.g. "American Quarter Horse Hall of Fame - Wikipedia" shown below divider
