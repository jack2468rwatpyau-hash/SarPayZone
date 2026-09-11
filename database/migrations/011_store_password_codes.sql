-- Per-store six-digit access code, automatically rotated every 15 days.
ALTER TABLE sellers ADD COLUMN store_password_code TEXT;
ALTER TABLE sellers ADD COLUMN store_password_code_changed_at DATETIME;
