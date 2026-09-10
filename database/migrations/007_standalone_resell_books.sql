-- Standalone C2C resell books. Existing listings retain their linked product as legacy metadata.
PRAGMA foreign_keys = OFF;
ALTER TABLE resell_listings RENAME TO resell_listings_legacy;

CREATE TABLE resell_listings (
    listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    seller_id INTEGER NOT NULL,
    product_id INTEGER,
    title TEXT NOT NULL,
    author_name TEXT,
    isbn TEXT,
    publisher TEXT,
    condition_status TEXT NOT NULL DEFAULT 'good',
    condition_images TEXT DEFAULT '[]',
    condition_note TEXT,
    asking_price REAL NOT NULL CHECK (asking_price >= 0),
    markup_percentage REAL NOT NULL DEFAULT 10 CHECK (markup_percentage >= 0),
    final_price REAL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sold')),
    approved_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES users(user_id),
    FOREIGN KEY (product_id) REFERENCES products(book_id),
    FOREIGN KEY (approved_by) REFERENCES sellers(seller_id)
);

INSERT INTO resell_listings
    (listing_id, public_id, seller_id, product_id, title, author_name, condition_status, condition_images, condition_note, asking_price, markup_percentage, final_price, status, approved_by, created_at, updated_at)
SELECT r.listing_id, r.public_id, r.seller_id, r.product_id, p.title, p.author_name, 'good', r.condition_images, r.condition_note, r.asking_price, r.markup_percentage, r.final_price, r.status, r.approved_by, r.created_at, r.updated_at
FROM resell_listings_legacy r JOIN products p ON p.book_id = r.product_id;

DROP TABLE resell_listings_legacy;
CREATE INDEX IF NOT EXISTS idx_resell_status ON resell_listings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_resell_seller ON resell_listings(seller_id, status);
PRAGMA foreign_keys = ON;
