-- Cloudflare rotates data-cfemail on every response, which made posts with
-- obfuscated email addresses look edited after each re-sync. Clear those
-- false positives; the next sync will store normalized HTML.
UPDATE posts
   SET edited_at = NULL
 WHERE edited_at IS NOT NULL
   AND (
     body_html LIKE '%data-cfemail%'
     OR body_html LIKE '%/cdn-cgi/l/email-protection%'
   );
