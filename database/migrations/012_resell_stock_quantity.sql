-- Add inventory quantity for standalone C2C resell listings.
-- Existing listings remain available with one unit by default.
ALTER TABLE resell_listings ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0);

CREATE INDEX IF NOT EXISTS idx_resell_available_stock
    ON resell_listings(status, stock_quantity, created_at);
