-- Migration 62: Rename messages.indexed_page_display → scraped_page_display (clearer: page that was scraped for follow-up)
ALTER TABLE messages RENAME COLUMN indexed_page_display TO scraped_page_display;
