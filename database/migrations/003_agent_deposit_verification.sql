-- Apply to an existing Turso database after the complete schema.sql.
CREATE TABLE IF NOT EXISTS agent_deposit_requests (
    deposit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    agent_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    verification_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'verified'
        CHECK (status IN ('pending', 'verified', 'rejected', 'reversed')),
    verified_at DATETIME,
    note TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES sellers(seller_id),
    FOREIGN KEY (buyer_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_deposits_agent ON agent_deposit_requests(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_deposits_buyer ON agent_deposit_requests(buyer_id, created_at);
