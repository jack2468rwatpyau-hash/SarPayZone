-- Update the administrator password using a bcrypt hash.
-- The plain-text password is intentionally not stored in this migration.
UPDATE sellers
SET password_hash = '$2a$12$/13Klzm/CpUIOF8vKZ5aeuvHWw8SgzBHgX.hjVocriPnjh7B4ViZ6',
    updated_at = CURRENT_TIMESTAMP
WHERE public_id = 'ADMIN#0001' AND role = 'admin' AND phone = '09987654321';
