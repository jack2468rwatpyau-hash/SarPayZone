-- Corrected prompt alignment migration for existing Sar Pay Zone databases.
-- Apply once with the Turso SQL console.
PRAGMA foreign_keys = OFF;

ALTER TABLE products ADD COLUMN images TEXT;

CREATE TABLE sellers_new (
    seller_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'publisher', 'bookstore', 'commission_store', 'agent')),
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    store_name TEXT,
    logo TEXT,
    banner TEXT,
    wallet_balance REAL DEFAULT 0,
    monthly_commission_due REAL DEFAULT 0,
    telegram_user_id TEXT,
    is_visible INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sellers_new
    (seller_id, public_id, role, name, phone, password_hash, store_name, logo, banner, wallet_balance, monthly_commission_due, telegram_user_id, is_visible, created_at)
SELECT seller_id, public_id, role, name, phone, password_hash, store_name, logo, banner, wallet_balance, monthly_commission_due, telegram_user_id, is_visible, created_at
FROM sellers;

DROP TABLE sellers;
ALTER TABLE sellers_new RENAME TO sellers;

INSERT OR IGNORE INTO sellers (public_id, role, name, phone, password_hash, store_name, is_visible) VALUES
('ADMIN#0001', 'admin', 'Admin User', '09987654321', '$2a$12$0WuiX4N.eUCLhepOqC7EqeZAFDNlTFP1iisHmYdyfq9aVDS/z1jAu', 'Sar Pay Zone Admin', 1),
('AGENT#0001', 'agent', 'Agent User', '09765432109', '$2a$12$0WuiX4N.eUCLhepOqC7EqeZAFDNlTFP1iisHmYdyfq9aVDS/z1jAu', 'Sar Pay Zone Agent', 1);

DELETE FROM system_config WHERE config_key = 'server_url';
PRAGMA foreign_keys = ON;

ALTER TABLE resell_listings ADD COLUMN markup_percentage REAL DEFAULT 10;
ALTER TABLE resell_listings ADD COLUMN final_price REAL;
