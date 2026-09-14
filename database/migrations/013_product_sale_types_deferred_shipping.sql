-- Product sale types, preorder windows, optional deposits, and nationwide shipping estimates.
ALTER TABLE products ADD COLUMN sale_type TEXT NOT NULL DEFAULT 'prepaid' CHECK (sale_type IN ('preorder', 'prepaid', 'cod'));
ALTER TABLE products ADD COLUMN preorder_start_at DATETIME;
ALTER TABLE products ADD COLUMN preorder_end_at DATETIME;
ALTER TABLE products ADD COLUMN preorder_deposit_amount REAL NOT NULL DEFAULT 0 CHECK (preorder_deposit_amount >= 0);
ALTER TABLE products ADD COLUMN cod_deposit_amount REAL NOT NULL DEFAULT 0 CHECK (cod_deposit_amount >= 0);
ALTER TABLE products ADD COLUMN estimated_delivery_time TEXT;
ALTER TABLE products ADD COLUMN free_shipping INTEGER NOT NULL DEFAULT 0 CHECK (free_shipping IN (0, 1));
ALTER TABLE products ADD COLUMN estimated_shipping_fee REAL NOT NULL DEFAULT 5000 CHECK (estimated_shipping_fee >= 0);

ALTER TABLE orders ADD COLUMN shipping_estimate REAL NOT NULL DEFAULT 0 CHECK (shipping_estimate >= 0);
ALTER TABLE orders ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);

CREATE INDEX IF NOT EXISTS idx_products_sale_type_window
    ON products(sale_type, preorder_end_at, is_active, approved);
