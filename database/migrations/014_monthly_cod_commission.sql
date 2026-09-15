-- Monthly COD Commission ledger.
-- One row per seller and calendar month. Legacy cod_payables tables remain for historical compatibility.
CREATE TABLE IF NOT EXISTS monthly_cod_commissions (
    monthly_id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    commission_amount REAL NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'submitted', 'paid', 'rejected')),
    payment_method TEXT CHECK (payment_method IN ('external_wallet', 'platform_wallet')),
    payment_submission_id INTEGER,
    paid_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (seller_id, period_start),
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id)
);

CREATE TABLE IF NOT EXISTS monthly_cod_payment_submissions (
    submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    monthly_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL CHECK (payment_method = 'external_wallet'),
    wallet_provider TEXT NOT NULL CHECK (wallet_provider IN ('kpay', 'wavepay', 'ayapay')),
    reference TEXT NOT NULL,
    proof_url TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note TEXT,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
    FOREIGN KEY (monthly_id) REFERENCES monthly_cod_commissions(monthly_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_cod_seller_status ON monthly_cod_commissions(seller_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_monthly_cod_submission_status ON monthly_cod_payment_submissions(status, submitted_at);

-- Existing COD rows become the opening balance for the current month on first deployment.
INSERT OR IGNORE INTO monthly_cod_commissions (seller_id, period_start, period_end, commission_amount, due_date)
SELECT seller_id, date('now', 'start of month'), date('now', 'start of month', '+1 month', '-1 day'),
       SUM(commission_amount), date('now', 'start of month', '+1 month')
FROM cod_payables WHERE status IN ('unpaid', 'rejected') GROUP BY seller_id;

INSERT OR IGNORE INTO system_config (config_key, config_value)
VALUES ('monthly_cod_commission_enabled', 'true');
