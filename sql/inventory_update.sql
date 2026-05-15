-- Migration: Add Inventory & Manufacturing Fields
ALTER TABLE products ADD COLUMN IF NOT EXISTS series_code VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS model_code VARCHAR(50);

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS edition_name VARCHAR(255);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS edition_code VARCHAR(50);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS color_code VARCHAR(50);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS mfg_date DATE;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS leather_type VARCHAR(100);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS hardware VARCHAR(100);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS branding_method VARCHAR(100);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS qc_status VARCHAR(100);
