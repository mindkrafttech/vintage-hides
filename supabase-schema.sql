-- ============================================================
-- VINTAGE HIDES — COMPLETE SUPABASE SCHEMA (FIXED)
-- Run this FRESH in Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) UNIQUE,
  tagline       VARCHAR(255),
  description   TEXT,
  story         TEXT,
  care_instructions TEXT,
  dimensions    VARCHAR(100),
  weight        VARCHAR(50),
  material      VARCHAR(255) DEFAULT 'Full-grain LWG-Gold certified leather',
  status        VARCHAR(20) DEFAULT 'draft',  -- draft/active/archived
  badge         VARCHAR(100),
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID REFERENCES products(id) ON DELETE CASCADE,
  color_name    VARCHAR(100) NOT NULL,
  color_hex     VARCHAR(7)   NOT NULL,
  sku           VARCHAR(100) UNIQUE NOT NULL,
  price         INT NOT NULL,
  compare_price INT,
  images        JSONB DEFAULT '[]',
  active        BOOLEAN DEFAULT true,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id  UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  alt         TEXT,
  type        VARCHAR(50) DEFAULT 'main',
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id          UUID REFERENCES product_variants(id) ON DELETE CASCADE UNIQUE,
  quantity            INT NOT NULL DEFAULT 0,
  reserved_quantity   INT NOT NULL DEFAULT 0,
  low_stock_threshold INT DEFAULT 5,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255),
  phone         VARCHAR(15) UNIQUE NOT NULL,
  email         VARCHAR(255),
  address_line1 TEXT,
  address_line2 TEXT,
  city          VARCHAR(100),
  state         VARCHAR(100),
  pincode       VARCHAR(10),
  otp           VARCHAR(6),
  otp_expires_at TIMESTAMPTZ,
  total_orders  INT DEFAULT 0,
  total_spent   INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. AFFILIATES (must be before orders)
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(255) NOT NULL,
  phone            VARCHAR(15) UNIQUE NOT NULL,
  email            VARCHAR(255),
  city             VARCHAR(100),
  state            VARCHAR(100),
  social_link      TEXT,
  referral_code    VARCHAR(30) UNIQUE NOT NULL,
  tier             VARCHAR(20) DEFAULT 'starter',       -- starter/pro/elite
  commission_rate  DECIMAL(4,2) DEFAULT 10.00,
  status           VARCHAR(20) DEFAULT 'pending',       -- pending/approved/rejected
  pan_number       VARCHAR(20),
  upi_id           VARCHAR(100),
  bank_account     VARCHAR(100),
  kyc_done         BOOLEAN DEFAULT false,
  coins            INT DEFAULT 0,
  total_clicks     INT DEFAULT 0,
  total_orders     INT DEFAULT 0,
  total_earned     INT DEFAULT 0,
  available_balance INT DEFAULT 0,
  otp              VARCHAR(6),
  otp_expires_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number        VARCHAR(20) UNIQUE NOT NULL,
  customer_id         UUID REFERENCES customers(id),
  affiliate_id        UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  status              VARCHAR(50) DEFAULT 'pending',
  payment_method      VARCHAR(20) NOT NULL,
  payment_status      VARCHAR(20) DEFAULT 'pending',
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  subtotal            INT NOT NULL,
  discount            INT DEFAULT 0,
  upsell_amount       INT DEFAULT 0,
  shipping_fee        INT DEFAULT 0,
  cod_fee             INT DEFAULT 0,
  total               INT NOT NULL,
  coupon_code         VARCHAR(50),
  awb                 VARCHAR(100),
  courier             VARCHAR(50),
  tracking_url        TEXT,
  dispatched_at       TIMESTAMPTZ,
  expected_delivery   TIMESTAMPTZ,
  notes               TEXT,
  ip_address          VARCHAR(50),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id),
  variant_id   UUID REFERENCES product_variants(id),
  product_name VARCHAR(255) NOT NULL,
  variant_color VARCHAR(100),
  sku          VARCHAR(100),
  quantity     INT NOT NULL DEFAULT 1,
  price        INT NOT NULL,
  upsell_item  BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preorders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number        VARCHAR(20) UNIQUE NOT NULL,
  customer_id         UUID REFERENCES customers(id),
  variant_id          UUID REFERENCES product_variants(id),
  product_name        VARCHAR(255),
  token_amount        INT NOT NULL DEFAULT 199,
  total_price         INT NOT NULL,
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  status              VARCHAR(50) DEFAULT 'token_paid',
  eta                 VARCHAR(100),
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. AFFILIATE CHILD TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id  UUID REFERENCES affiliates(id) ON DELETE CASCADE,
  referral_code VARCHAR(30),
  page          TEXT,
  ip            VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id     UUID REFERENCES affiliates(id) ON DELETE CASCADE,
  order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_amount     INT NOT NULL,
  commission_rate  DECIMAL(4,2) NOT NULL,
  commission_amount INT NOT NULL,
  status           VARCHAR(20) DEFAULT 'pending',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id        UUID REFERENCES affiliates(id) ON DELETE CASCADE,
  amount              INT NOT NULL,
  upi_id              VARCHAR(100),
  razorpay_payout_id  VARCHAR(100),
  status              VARCHAR(20) DEFAULT 'processing',
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id     UUID REFERENCES products(id) ON DELETE CASCADE,
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  reviewer_name  VARCHAR(255),
  reviewer_phone VARCHAR(15),
  reviewer_city  VARCHAR(100),
  rating         INT CHECK (rating >= 1 AND rating <= 5),
  body           TEXT NOT NULL,
  source         VARCHAR(30) DEFAULT 'website',
  status         VARCHAR(20) DEFAULT 'pending',
  reply          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. COUPONS
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(50) UNIQUE NOT NULL,
  type            VARCHAR(20) NOT NULL,
  value           INT NOT NULL,
  min_order_value INT DEFAULT 0,
  max_discount    INT,
  max_uses        INT,
  used_count      INT DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  active          BOOLEAN DEFAULT true,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. WAITLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS waitlist (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id  UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  name        VARCHAR(255),
  phone       VARCHAR(15) NOT NULL,
  email       VARCHAR(255),
  notified    BOOLEAN DEFAULT false,
  notified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(variant_id, phone)
);

-- ============================================================
-- 9. ABANDONED CARTS
-- ============================================================
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id       VARCHAR(100),
  phone            VARCHAR(15),
  email            VARCHAR(255),
  name             VARCHAR(255),
  product_id       UUID REFERENCES products(id),
  variant_id       UUID REFERENCES product_variants(id),
  product_name     VARCHAR(255),
  variant_color    VARCHAR(100),
  price            INT,
  whatsapp_sent    BOOLEAN DEFAULT false,
  whatsapp_sent_at TIMESTAMPTZ,
  recovered        BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. ADMIN USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) DEFAULT 'admin',
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. WHATSAPP LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone         VARCHAR(15) NOT NULL,
  template      VARCHAR(100) NOT NULL,
  variables     JSONB,
  status        VARCHAR(20) DEFAULT 'sent',
  msg91_id      VARCHAR(100),
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. SITE SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS site_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 13. SERVICEABLE PINCODES
-- ============================================================
CREATE TABLE IF NOT EXISTS serviceable_pincodes (
  pincode      VARCHAR(10) PRIMARY KEY,
  city         VARCHAR(100),
  state        VARCHAR(100),
  serviceable  BOOLEAN DEFAULT true,
  delivery_days INT DEFAULT 5,
  cached_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_customer   ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_variant  ON waitlist(variant_id);
CREATE INDEX IF NOT EXISTS idx_aff_clicks        ON affiliate_clicks(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_aff_commissions   ON affiliate_commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_phone   ON abandoned_carts(phone);
CREATE INDEX IF NOT EXISTS idx_reviews_product   ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_variant ON inventory(variant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_affiliates_code   ON affiliates(referral_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_phone  ON affiliates(phone);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE preorders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist           ENABLE ROW LEVEL SECURITY;
ALTER TABLE abandoned_carts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_payouts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE serviceable_pincodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users        ENABLE ROW LEVEL SECURITY;

-- PUBLIC READ POLICIES (service_role key bypasses RLS automatically)
CREATE POLICY "Public read active products"  ON products        FOR SELECT USING (status = 'active');
CREATE POLICY "Public read active variants"  ON product_variants FOR SELECT USING (active = true);
CREATE POLICY "Public read images"           ON product_images  FOR SELECT USING (true);
CREATE POLICY "Public read inventory"        ON inventory       FOR SELECT USING (true);
CREATE POLICY "Public read approved reviews" ON reviews         FOR SELECT USING (status = 'approved');
CREATE POLICY "Public read active coupons"   ON coupons         FOR SELECT USING (active = true);
CREATE POLICY "Public read site_settings"    ON site_settings   FOR SELECT USING (true);
CREATE POLICY "Public read pincodes"         ON serviceable_pincodes FOR SELECT USING (true);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-generate order number: VH-2026-00001
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  new_number TEXT;
  year_str   TEXT := TO_CHAR(NOW(), 'YYYY');
  seq_num    INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(order_number, '-', 3) AS INT)), 0) + 1
  INTO seq_num FROM orders
  WHERE order_number LIKE 'VH-' || year_str || '-%';
  new_number := 'VH-' || year_str || '-' || LPAD(seq_num::TEXT, 5, '0');
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Decrement inventory safely
CREATE OR REPLACE FUNCTION decrement_inventory(p_variant_id UUID, p_quantity INT)
RETURNS VOID AS $$
BEGIN
  UPDATE inventory
  SET quantity = GREATEST(0, quantity - p_quantity),
      updated_at = NOW()
  WHERE variant_id = p_variant_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default coupons
INSERT INTO coupons (code, type, value, min_order_value, description) VALUES
  ('RYZA10',   'percent', 10,  0, 'Launch offer — 10% off prepaid'),
  ('EXTRA5',   'percent',  5,  0, 'Exit intent — 5% off'),
  ('COD99',    'flat',    99,  0, 'COD fee waiver')
ON CONFLICT (code) DO NOTHING;

-- Default site settings
INSERT INTO site_settings (key, value, description) VALUES
  ('announcement_text',       '🎉 LAUNCH OFFER • 10% OFF PREPAID (RYZA10) • COD Available • Free Shipping', 'Announcement bar text'),
  ('announcement_active',     'true',  'Show announcement bar'),
  ('whatsapp_number',         '919XXXXXXXXX', 'Support WhatsApp'),
  ('free_shipping_threshold', '0',     'Min order for free shipping (0=always free)'),
  ('cod_fee',                 '99',    'COD handling fee in ₹'),
  ('preorder_token',          '199',   'Pre-order token amount'),
  ('low_stock_threshold',     '5',     'Show low stock warning at this qty')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- ADMIN USER
-- Username: admin
-- Password: VintageAdmin@2026
-- ============================================================
INSERT INTO admin_users (username, password_hash, role)
VALUES (
  'admin',
  '$2a$10$oQz6I9KO93Fk/ynnkWpwZOfLMZj4u.oVSBJ/tNA2lGeUbOXUo5Ute',
  'superadmin'
)
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- POST-PURCHASE AUTOMATION QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS post_purchase_queue (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID REFERENCES orders(id) ON DELETE CASCADE,
  phone       VARCHAR(15) NOT NULL,
  template    VARCHAR(100) NOT NULL,
  vars        TEXT,
  type        VARCHAR(30) DEFAULT 'post_purchase', -- post_purchase / cart / sequence
  status      VARCHAR(20) DEFAULT 'pending',       -- pending / sent / failed / skipped
  send_at     TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ppq_send_at ON post_purchase_queue(send_at) WHERE status = 'pending';
ALTER TABLE post_purchase_queue ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PINCODE RTO STATS (for COD risk scoring)
-- ============================================================
CREATE TABLE IF NOT EXISTS pincode_rto_stats (
  pincode     VARCHAR(10) PRIMARY KEY,
  order_count INT DEFAULT 0,
  rto_count   INT DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pincode_rto_stats ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ORDERS: add pre_dispatch_sent_at if missing
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pre_dispatch_sent_at TIMESTAMPTZ;

-- ============================================================
-- UTM TRACKING: add columns to orders
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_source    VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_medium    VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_campaign  VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_content   VARCHAR(100);

-- ============================================================
-- COD RISK LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS cod_risk_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone      VARCHAR(15),
  pincode    VARCHAR(10),
  score      INT,
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cod_risk_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PINCODE RTO STATS + update function
-- ============================================================
CREATE OR REPLACE FUNCTION increment_pincode_stat(p_pincode VARCHAR, p_rto BOOLEAN)
RETURNS VOID AS $$
BEGIN
  INSERT INTO pincode_rto_stats (pincode, order_count, rto_count)
  VALUES (p_pincode, 1, CASE WHEN p_rto THEN 1 ELSE 0 END)
  ON CONFLICT (pincode) DO UPDATE SET
    order_count = pincode_rto_stats.order_count + 1,
    rto_count = pincode_rto_stats.rto_count + CASE WHEN p_rto THEN 1 ELSE 0 END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ORDER SUMMARY STATS (for admin orders header)
-- ============================================================
CREATE OR REPLACE FUNCTION order_summary_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_today', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE),
    'revenue_today', COALESCE(SUM(total) FILTER (WHERE created_at >= CURRENT_DATE), 0),
    'pending_dispatch', COUNT(*) FILTER (WHERE status = 'confirmed' AND awb IS NULL),
    'cod_pending', COUNT(*) FILTER (WHERE payment_method = 'cod' AND payment_status = 'pending')
  ) INTO result FROM orders;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- WINBACK COUPON (seed)
-- ============================================================
INSERT INTO coupons (code, type, value, min_order_value, description, active) VALUES
  ('WINBACK200',  'flat', 200, 0, 'Win-back campaign � Rs.200 off', true),
  ('REPEAT150',   'flat', 150, 0, 'Loyalty reward � Rs.150 off next order', true),
  ('RESTOCK10',   'percent', 10, 0, 'Waitlist restock coupon', true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- AFFILIATE: add pending_balance column
-- ============================================================
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS pending_balance INT DEFAULT 0;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS upi_id VARCHAR(100);
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS paid_by VARCHAR(100);
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS upi_id VARCHAR(100);
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS transaction_ref VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
