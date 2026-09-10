-- Structured Myanmar delivery address fields for reliable seller-rate matching.
ALTER TABLE orders ADD COLUMN shipping_state TEXT;
ALTER TABLE orders ADD COLUMN shipping_district TEXT;
ALTER TABLE orders ADD COLUMN shipping_township TEXT;
