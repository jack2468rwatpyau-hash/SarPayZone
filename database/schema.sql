-- ============================================================================
-- SAR PAY ZONE (စာပေဇုန်) - COMPLETE TURSO / LIBSQL SCHEMA
-- ============================================================================
-- Apply this file to a fresh Turso database.
-- For an existing database, back up first and apply the numbered migrations.
-- All timestamps are stored as UTC-compatible SQLite datetime values.

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------------
-- System configuration
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_config (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_config (config_key, config_value) VALUES
    ('current_password_code', 'SPZ2024'),
    ('markup_percentage', '10'),
    ('agent_cash_in_limit', '500000'),
    ('commission_settings', '{"publisher_tiers":{"10000":0.06,"20000":0.05,"50000":0.04,"above":0.03},"bookstore_rate":0.02,"commission_store_rate":0,"resell_rate":0.08}');

-- --------------------------------------------------------------------------
-- Buyers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'banned', 'soft_deleted')),
    wallet_balance REAL NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
    resell_balance REAL NOT NULL DEFAULT 0 CHECK (resell_balance >= 0),
    profile_image_id TEXT,
    city TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------------------------------------
-- Stores / platform accounts
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sellers (
    seller_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL
        CHECK (role IN ('admin', 'publisher', 'bookstore', 'commission_store', 'agent')),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    store_name TEXT,
    logo TEXT,
    banner TEXT,
    commission_rate REAL,
    wallet_balance REAL NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
    monthly_commission_due REAL NOT NULL DEFAULT 0 CHECK (monthly_commission_due >= 0),
    last_commission_notified_at DATETIME,
    telegram_user_id TEXT,
    is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
    is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
    accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK (accepting_orders IN (0, 1)),
    reply_time_minutes INTEGER NOT NULL DEFAULT 60 CHECK (reply_time_minutes >= 0),
    reply_time_text TEXT DEFAULT 'Usually replies within 1 hour',
    closed_message TEXT DEFAULT 'ဆိုင်ခေတ္တပိတ်ထားပါတယ်။ ပြန်ဖွင့်ချိန်တွင် အော်ဒါလက်ခံပါမယ်။',
    auto_reply_message TEXT DEFAULT 'မင်္ဂလာပါ။ စာပေဇုန်ဆိုင်မှ မကြာမီ ပြန်လည်ဖြေကြားပေးပါမယ်။',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The supplied bootstrap hash is intentionally the same one specified in the
-- corrected project prompt. Change these credentials after first deployment.
INSERT OR IGNORE INTO sellers
    (public_id, role, name, phone, password_hash, store_name, is_visible)
VALUES
    ('ADMIN#0001', 'admin', 'Admin User', '09987654321',
     '$2a$12$0WuiX4N.eUCLhepOqC7EqeZAFDNlTFP1iisHmYdyfq9aVDS/z1jAu',
     'Sar Pay Zone Admin', 1),
    ('AGENT#0001', 'agent', 'Agent User', '09765432109',
     '$2a$12$0WuiX4N.eUCLhepOqC7EqeZAFDNlTFP1iisHmYdyfq9aVDS/z1jAu',
     'Sar Pay Zone Agent', 1);

-- --------------------------------------------------------------------------
-- Categories
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO categories (name, slug, sort_order) VALUES
    ('BL', 'bl', 1),
    ('GL', 'gl', 2),
    ('LGBTQ+', 'lgbtq', 3),
    ('History', 'history', 4),
    ('Romance', 'romance', 5),
    ('Fantasy', 'fantasy', 6),
    ('Thriller', 'thriller', 7);

-- --------------------------------------------------------------------------
-- Products and variations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    book_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    seller_id INTEGER NOT NULL,
    product_type TEXT NOT NULL DEFAULT 'store_book'
        CHECK (product_type IN ('store_book', 'resell_book')),
    title TEXT NOT NULL,
    author_name TEXT,
    category_id INTEGER,
    original_price REAL NOT NULL CHECK (original_price >= 0),
    discounted_price REAL CHECK (discounted_price IS NULL OR discounted_price >= 0),
    images TEXT DEFAULT '[]',
    page_count INTEGER,
    size TEXT,
    description TEXT,
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
    view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
    FOREIGN KEY (category_id) REFERENCES categories(category_id)
);

CREATE TABLE IF NOT EXISTS product_variations (
    variation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    variation_name TEXT NOT NULL,
    price REAL NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    images TEXT DEFAULT '[]',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(book_id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- C2C resell listings
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resell_listings (
    listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    seller_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    condition_images TEXT DEFAULT '[]',
    condition_note TEXT,
    asking_price REAL NOT NULL CHECK (asking_price >= 0),
    markup_percentage REAL NOT NULL DEFAULT 10 CHECK (markup_percentage >= 0),
    final_price REAL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'sold')),
    approved_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES users(user_id),
    FOREIGN KEY (product_id) REFERENCES products(book_id),
    FOREIGN KEY (approved_by) REFERENCES sellers(seller_id)
);

-- --------------------------------------------------------------------------
-- Orders and escrow/payment state
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    order_id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    buyer_id INTEGER NOT NULL,
    seller_id INTEGER,
    product_id INTEGER,
    variation_id INTEGER,
    resell_listing_id INTEGER,
    resell_seller_id INTEGER,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    shipping_fee REAL NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
    commission_amount REAL NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
    markup_amount REAL NOT NULL DEFAULT 0 CHECK (markup_amount >= 0),
    payment_method TEXT NOT NULL DEFAULT 'cod'
        CHECK (payment_method IN ('cod', 'pre_order', 'wallet')),
    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed')),
    order_status TEXT NOT NULL DEFAULT 'new'
        CHECK (order_status IN ('new', 'approved', 'shipping', 'delivered', 'cancelled', 'disputed')),
    shipping_address TEXT NOT NULL,
    p2p_friend_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users(user_id),
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
    FOREIGN KEY (product_id) REFERENCES products(book_id),
    FOREIGN KEY (variation_id) REFERENCES product_variations(variation_id),
    FOREIGN KEY (resell_listing_id) REFERENCES resell_listings(listing_id),
    FOREIGN KEY (resell_seller_id) REFERENCES users(user_id),
    FOREIGN KEY (p2p_friend_id) REFERENCES users(user_id)
);

-- --------------------------------------------------------------------------
-- Chat
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_type TEXT NOT NULL
        CHECK (conversation_type IN ('buyer_shop', 'buyer_platform', 'shop_platform', 'buyer_buyer', 'group')),
    participants TEXT NOT NULL DEFAULT '[]',
    related_order_id INTEGER,
    last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (related_order_id) REFERENCES orders(order_id)
);

CREATE TABLE IF NOT EXISTS messages (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'seller', 'admin')),
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image')),
    content TEXT NOT NULL,
    is_flagged INTEGER NOT NULL DEFAULT 0 CHECK (is_flagged IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- Voting
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voting_festivals (
    festival_id INTEGER PRIMARY KEY AUTOINCREMENT,
    festival_name TEXT NOT NULL,
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS festival_books (
    festival_book_id INTEGER PRIMARY KEY AUTOINCREMENT,
    festival_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (festival_id, book_id),
    FOREIGN KEY (festival_id) REFERENCES voting_festivals(festival_id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES products(book_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS votes (
    vote_id INTEGER PRIMARY KEY AUTOINCREMENT,
    festival_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    voted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (festival_id, user_id),
    FOREIGN KEY (festival_id) REFERENCES voting_festivals(festival_id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES products(book_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- Marketplace content and reviews
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS banners (
    banner_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    subtitle TEXT,
    image_url TEXT NOT NULL,
    target_link TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_views (
    view_id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    user_id INTEGER,
    viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES products(book_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reviews (
    review_id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL UNIQUE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES products(book_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wishlist (
    wishlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, book_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES products(book_id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- Push, shipping, and wallet transactions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
    subscription_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    seller_id INTEGER,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((user_id IS NOT NULL AND seller_id IS NULL) OR (user_id IS NULL AND seller_id IS NOT NULL)),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipping_rates (
    rate_id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    district TEXT,
    city TEXT,
    township TEXT NOT NULL,
    is_no_shipping INTEGER NOT NULL DEFAULT 0 CHECK (is_no_shipping IN (0, 1)),
    is_cod_allowed INTEGER NOT NULL DEFAULT 1 CHECK (is_cod_allowed IN (0, 1)),
    is_prepay_allowed INTEGER NOT NULL DEFAULT 1 CHECK (is_prepay_allowed IN (0, 1)),
    prepay_shipping_fee REAL NOT NULL DEFAULT 5000 CHECK (prepay_shipping_fee >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (seller_id, state, district, city, township),
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_owner_type TEXT NOT NULL CHECK (wallet_owner_type IN ('user', 'seller')),
    wallet_owner_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('cash_in', 'purchase', 'withdrawal', 'p2p', 'commission_paid', 'refund', 'resell_payout')),
    amount REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    balance_after REAL NOT NULL,
    reference_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_deposit_requests (
    deposit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    agent_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    verification_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'verified'
        CHECK (status IN ('pending', 'verified', 'rejected', 'reversed')),
    verified_at DATETIME,
    note TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES sellers(seller_id),
    FOREIGN KEY (buyer_id) REFERENCES users(user_id)
);

-- --------------------------------------------------------------------------
-- Retention triggers
-- --------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS enforce_buyer_order_limit
AFTER INSERT ON orders
WHEN NEW.buyer_id IS NOT NULL
 AND (SELECT COUNT(*) FROM orders WHERE buyer_id = NEW.buyer_id) > 100
BEGIN
    DELETE FROM orders
    WHERE order_id = (
        SELECT order_id FROM orders
        WHERE buyer_id = NEW.buyer_id
        ORDER BY datetime(created_at) ASC, order_id ASC
        LIMIT 1
    );
END;

CREATE TRIGGER IF NOT EXISTS enforce_seller_order_limit
AFTER INSERT ON orders
WHEN NEW.seller_id IS NOT NULL
 AND (SELECT COUNT(*) FROM orders WHERE seller_id = NEW.seller_id) > 100
BEGIN
    DELETE FROM orders
    WHERE order_id = (
        SELECT order_id FROM orders
        WHERE seller_id = NEW.seller_id
        ORDER BY datetime(created_at) ASC, order_id ASC
        LIMIT 1
    );
END;

CREATE TRIGGER IF NOT EXISTS enforce_transaction_limit
AFTER INSERT ON transactions
WHEN (SELECT COUNT(*) FROM transactions
      WHERE wallet_owner_id = NEW.wallet_owner_id
        AND wallet_owner_type = NEW.wallet_owner_type) > 20
BEGIN
    DELETE FROM transactions
    WHERE transaction_id = (
        SELECT transaction_id FROM transactions
        WHERE wallet_owner_id = NEW.wallet_owner_id
          AND wallet_owner_type = NEW.wallet_owner_type
        ORDER BY datetime(created_at) ASC, transaction_id ASC
        LIMIT 1
    );
END;

CREATE TRIGGER IF NOT EXISTS auto_delete_old_messages
AFTER INSERT ON messages
BEGIN
    DELETE FROM messages
    WHERE conversation_id IN (
        SELECT conversation_id FROM conversations WHERE conversation_type = 'group'
    )
    AND datetime(created_at) < datetime('now', '-2 days');

    DELETE FROM messages
    WHERE conversation_id IN (
        SELECT conversation_id FROM conversations WHERE conversation_type <> 'group'
    )
    AND datetime(created_at) < datetime('now', '-15 days');
END;

-- --------------------------------------------------------------------------
-- Performance indexes
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status);
CREATE INDEX IF NOT EXISTS idx_sellers_role ON sellers(role);
CREATE INDEX IF NOT EXISTS idx_sellers_visible ON sellers(is_visible);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_public ON products(is_active, approved, created_at);
CREATE INDEX IF NOT EXISTS idx_product_variations_product ON product_variations(product_id);
CREATE INDEX IF NOT EXISTS idx_resell_status ON resell_listings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_resell_seller ON resell_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status, payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_resell ON orders(resell_listing_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_product_views_book ON product_views(book_id, viewed_at);
CREATE INDEX IF NOT EXISTS idx_reviews_book ON reviews(book_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shipping_rates_seller ON shipping_rates(seller_id, state, district, city, township);
CREATE INDEX IF NOT EXISTS idx_transactions_owner ON transactions(wallet_owner_type, wallet_owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_deposits_agent ON agent_deposit_requests(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_deposits_buyer ON agent_deposit_requests(buyer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id, created_at);
