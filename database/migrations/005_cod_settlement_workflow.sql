-- COD delivery confirmation and 25-day commission settlement workflow.
ALTER TABLE orders ADD COLUMN buyer_delivery_confirmed_at DATETIME;
ALTER TABLE orders ADD COLUMN buyer_delivery_proof TEXT;
ALTER TABLE orders ADD COLUMN seller_delivery_confirmed_at DATETIME;

CREATE TABLE IF NOT EXISTS cod_payables (
    payable_id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    seller_id INTEGER NOT NULL,
    commission_amount REAL NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
    due_date DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'submitted', 'paid', 'rejected')),
    payment_submission_id INTEGER,
    paid_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id)
);

CREATE TABLE IF NOT EXISTS cod_payment_submissions (
    submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('kpay', 'wavepay', 'ayapay')),
    reference TEXT NOT NULL,
    proof_url TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note TEXT,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id)
);

INSERT OR IGNORE INTO system_config (config_key, config_value)
VALUES ('cod_payment_accounts', '{"kpay":{"phone":"","name":""},"wavepay":{"phone":"","name":""},"ayapay":{"phone":"","name":""}}');
