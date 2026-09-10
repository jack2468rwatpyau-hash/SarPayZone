-- ============================================
-- SAR PAY ZONE (စာပေဇုန်) - TURSO DB SCHEMA
-- ============================================

-- System Configuration
CREATE TABLE system_config (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_config (config_key, config_value) VALUES
('current_password_code', 'SPZ2024'),
('markup_percentage', '10'),
('agent_cash_in_limit', '500000');

-- Users (Buyers)
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    wallet_balance REAL DEFAULT 0,
    resell_balance REAL DEFAULT 0,
    profile_image_id TEXT,
    city TEXT,
    account_status TEXT DEFAULT 'active' CHECK(account_status IN ('active', 'banned', 'soft_deleted')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sellers (Publisher, Bookstore, Commission Store, Agent)
CREATE TABLE sellers (
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

-- Categories
-- Default platform accounts. Replace the seeded password after first deployment.
INSERT INTO sellers (public_id, role, name, phone, password_hash, store_name, is_visible) VALUES
('ADMIN#0001', 'admin', 'Admin User', '09987654321', '$2a$12$0WuiX4N.eUCLhepOqC7EqeZAFDNlTFP1iisHmYdyfq9aVDS/z1jAu', 'Sar Pay Zone Admin', 1),
('AGENT#0001', 'agent', 'Agent User', '09765432109', '$2a$12$0WuiX4N.eUCLhepOqC7EqeZAFDNlTFP1iisHmYdyfq9aVDS/z1jAu', 'Sar Pay Zone Agent', 1);

-- Categories
CREATE TABLE categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon TEXT,
    sort_order INTEGER DEFAULT 0
);

INSERT INTO categories (name, slug) VALUES
('BL', 'bl'), ('GL', 'gl'), ('LGBTQ+', 'lgbtq'), ('History', 'history'),
('Romance', 'romance'), ('Fantasy', 'fantasy'), ('Thriller', 'thriller');

-- Products
CREATE TABLE products (
    book_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    seller_id INTEGER NOT NULL,
    product_type TEXT NOT NULL CHECK(product_type IN ('store_book', 'resell_book')),
    title TEXT NOT NULL,
    author_name TEXT,
    category_id INTEGER,
    original_price REAL NOT NULL,
    discounted_price REAL,
    images TEXT, -- JSON array max 5
    page_count INTEGER,
    size TEXT,
    description TEXT,
    stock_quantity INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    approved INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
    FOREIGN KEY (category_id) REFERENCES categories(category_id)
);

-- Product Variations
CREATE TABLE product_variations (
    variation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    variation_name TEXT NOT NULL,
    price REAL NOT NULL,
    stock_quantity INTEGER DEFAULT 0,
    images TEXT, -- JSON array max 5
    FOREIGN KEY (product_id) REFERENCES products(book_id) ON DELETE CASCADE
);

-- Resell Listings
CREATE TABLE resell_listings (
    listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    seller_id INTEGER NOT NULL, -- buyer/user who owns the resell listing
    product_id INTEGER NOT NULL,
    condition_images TEXT, -- JSON array
    asking_price REAL NOT NULL,
    markup_percentage REAL DEFAULT 10,
    final_price REAL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'sold')),
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(book_id),
    FOREIGN KEY (approved_by) REFERENCES sellers(seller_id)
);

-- Orders
CREATE TABLE orders (
    order_id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    buyer_id INTEGER,
    seller_id INTEGER,
    product_id INTEGER,
    variation_id INTEGER,
    quantity INTEGER DEFAULT 1,
    total_amount REAL NOT NULL,
    shipping_fee REAL DEFAULT 0,
    commission_amount REAL DEFAULT 0,
    markup_amount REAL DEFAULT 0,
    payment_method TEXT CHECK(payment_method IN ('wallet', 'cod', 'agent')),
    payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'paid', 'refunded')),
    order_status TEXT DEFAULT 'new' CHECK(order_status IN ('new', 'approved', 'shipping', 'delivered', 'cancelled', 'disputed')),
    shipping_address TEXT,
    p2p_friend_id INTEGER, -- for Pay a Friend
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users(user_id),
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id),
    FOREIGN KEY (product_id) REFERENCES products(book_id),
    FOREIGN KEY (variation_id) REFERENCES product_variations(variation_id)
);

-- Order Retention Trigger (FIFO 100)
CREATE TRIGGER enforce_order_limit 
AFTER INSERT ON orders
WHEN (SELECT COUNT(*) FROM orders WHERE buyer_id = NEW.buyer_id) > 100
BEGIN
    DELETE FROM orders 
    WHERE buyer_id = NEW.buyer_id 
    AND order_id = (SELECT order_id FROM orders WHERE buyer_id = NEW.buyer_id ORDER BY created_at ASC LIMIT 1);
END;

CREATE TRIGGER enforce_seller_order_limit
AFTER INSERT ON orders
WHEN NEW.seller_id IS NOT NULL AND (SELECT COUNT(*) FROM orders WHERE seller_id = NEW.seller_id) > 100
BEGIN
    DELETE FROM orders
    WHERE seller_id = NEW.seller_id
    AND order_id = (SELECT order_id FROM orders WHERE seller_id = NEW.seller_id ORDER BY created_at ASC LIMIT 1);
END;

-- Conversations
CREATE TABLE conversations (
    conversation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_type TEXT NOT NULL CHECK(conversation_type IN ('buyer_shop', 'buyer_platform', 'shop_platform', 'buyer_buyer', 'group')),
    participants TEXT NOT NULL, -- JSON array of user/seller IDs
    related_order_id INTEGER,
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Messages
CREATE TABLE messages (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL, -- user_id or seller_id with prefix
    sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'seller', 'admin')),
    message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image')),
    content TEXT NOT NULL,
    is_flagged INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

-- Auto-delete old messages
CREATE TRIGGER auto_delete_old_messages
AFTER INSERT ON messages
BEGIN
    DELETE FROM messages 
    WHERE conversation_id IN (
        SELECT conversation_id FROM conversations WHERE conversation_type = 'group'
    ) 
    AND datetime(created_at) < datetime('now', '-2 days');
    
    DELETE FROM messages 
    WHERE conversation_id IN (
        SELECT conversation_id FROM conversations WHERE conversation_type != 'group'
    ) 
    AND datetime(created_at) < datetime('now', '-15 days');
END;

-- Voting Festivals
CREATE TABLE voting_festivals (
    festival_id INTEGER PRIMARY KEY AUTOINCREMENT,
    festival_name TEXT NOT NULL,
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Votes
CREATE TABLE votes (
    vote_id INTEGER PRIMARY KEY AUTOINCREMENT,
    festival_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(festival_id, user_id),
    FOREIGN KEY (festival_id) REFERENCES voting_festivals(festival_id),
    FOREIGN KEY (book_id) REFERENCES products(book_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Banners
CREATE TABLE banners (
    banner_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    subtitle TEXT,
    image_url TEXT NOT NULL,
    target_link TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Product Views
CREATE TABLE product_views (
    view_id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    user_id INTEGER,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES products(book_id)
);

-- Reviews
CREATE TABLE reviews (
    review_id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL,
    rating INTEGER CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES products(book_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

-- Push Subscriptions
CREATE TABLE push_subscriptions (
    subscription_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    seller_id INTEGER,
    endpoint TEXT NOT NULL,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK((user_id IS NOT NULL AND seller_id IS NULL) OR (user_id IS NULL AND seller_id IS NOT NULL))
);

-- Shipping Rates
CREATE TABLE shipping_rates (
    rate_id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    city TEXT NOT NULL,
    township TEXT NOT NULL,
    is_no_shipping INTEGER DEFAULT 0,
    is_cod_allowed INTEGER DEFAULT 1,
    is_prepay_allowed INTEGER DEFAULT 1,
    prepay_shipping_fee REAL DEFAULT 5000,
    UNIQUE(seller_id, state, city, township),
    FOREIGN KEY (seller_id) REFERENCES sellers(seller_id)
);

-- Wallet Transactions
CREATE TABLE transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_owner_type TEXT NOT NULL CHECK(wallet_owner_type IN ('user', 'seller')),
    wallet_owner_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('cash_in', 'purchase', 'withdrawal', 'p2p', 'commission_paid', 'refund', 'resell_payout')),
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    balance_after REAL NOT NULL,
    reference_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transaction Retention Trigger (FIFO 20)
CREATE TRIGGER enforce_transaction_limit
AFTER INSERT ON transactions
WHEN (SELECT COUNT(*) FROM transactions WHERE wallet_owner_id = NEW.wallet_owner_id AND wallet_owner_type = NEW.wallet_owner_type) > 20
BEGIN
    DELETE FROM transactions 
    WHERE wallet_owner_id = NEW.wallet_owner_id 
    AND wallet_owner_type = NEW.wallet_owner_type
    AND transaction_id = (
        SELECT transaction_id FROM transactions 
        WHERE wallet_owner_id = NEW.wallet_owner_id AND wallet_owner_type = NEW.wallet_owner_type 
        ORDER BY created_at ASC LIMIT 1
    );
END;

-- Wishlist
CREATE TABLE wishlist (
    wishlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, book_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (book_id) REFERENCES products(book_id)
);

-- Indexes
CREATE INDEX idx_products_seller ON products(seller_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_type ON products(product_type);
CREATE INDEX idx_orders_buyer ON orders(buyer_id);
CREATE INDEX idx_orders_seller ON orders(seller_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_created ON messages(created_at);
CREATE INDEX idx_product_views_book ON product_views(book_id);
CREATE INDEX idx_shipping_rates_seller ON shipping_rates(seller_id);
