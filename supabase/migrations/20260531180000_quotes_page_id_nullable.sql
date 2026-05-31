-- Allow quotes to survive page deletion (e.g. after recrawl).
-- snippet, page_url, page_title, domain are stored on the quote row itself,
-- so display still works even when the live page is gone.

ALTER TABLE "public"."quotes" ALTER COLUMN "page_id" DROP NOT NULL;

ALTER TABLE "public"."quotes"
  DROP CONSTRAINT "quotes_page_id_fkey",
  ADD CONSTRAINT "quotes_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE SET NULL;
