-- Existing databases created from the original schema incorrectly linked
-- resell_listings.seller_id to sellers.seller_id, although resell routes store
-- a buyer/user id in that column. Rebuild the table without that constraint.
PRAGMA foreign_keys = OFF;

CREATE TABLE resell_listings_new (
    listing_id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    seller_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    condition_images TEXT,
    asking_price REAL NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'sold')),
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(book_id),
    FOREIGN KEY (approved_by) REFERENCES sellers(seller_id)
);

INSERT INTO resell_listings_new
    (listing_id, public_id, seller_id, product_id, condition_images, asking_price, status, approved_by, created_at)
SELECT listing_id, public_id, seller_id, product_id, condition_images, asking_price, status, approved_by, created_at
FROM resell_listings;

DROP TABLE resell_listings;
ALTER TABLE resell_listings_new RENAME TO resell_listings;

PRAGMA foreign_keys = ON;
