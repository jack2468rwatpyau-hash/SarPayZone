-- Wallet withdrawal workflow: funds are reserved at request time and returned on rejection.
CREATE TABLE IF NOT EXISTS withdrawal_requests (
    withdrawal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'seller')),
    owner_id INTEGER NOT NULL,
    source_balance TEXT NOT NULL CHECK (source_balance IN ('wallet_balance', 'resell_balance')),
    amount REAL NOT NULL CHECK (amount > 0),
    fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
    net_amount REAL NOT NULL CHECK (net_amount > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('kpay', 'wavepay', 'ayapay')),
    account_name TEXT NOT NULL,
    account_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
    admin_note TEXT,
    admin_reference TEXT,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    paid_at DATETIME,
    rejected_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawal_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_withdrawal_owner ON withdrawal_requests(owner_type, owner_id, requested_at);
