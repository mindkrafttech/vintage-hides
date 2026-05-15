-- ============================================================
-- KYC + Payout Migration for affiliates table
-- Run this in Supabase SQL Editor (once)
-- ============================================================

-- KYC identity
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS pan_number        TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS pan_name          TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS pan_verified      BOOLEAN DEFAULT FALSE;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS aadhaar_ref       TEXT;    -- Sandbox OTP ref_id
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS aadhaar_verified  BOOLEAN DEFAULT FALSE;

-- Payout method (affiliate picks one)
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS payout_method     TEXT DEFAULT 'upi';  -- 'upi' | 'bank'
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS upi_verified      BOOLEAN DEFAULT FALSE;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS upi_verified_name TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_ifsc         TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_name         TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_verified     BOOLEAN DEFAULT FALSE;

-- KYC overall status
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS kyc_status        TEXT DEFAULT 'pending';
  -- 'pending' | 'partial' | 'verified'
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS kyc_done          BOOLEAN DEFAULT FALSE;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS kyc_verified_at   TIMESTAMPTZ;

-- Razorpay Payouts cache (avoid re-creating contacts/fund-accounts)
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS rzp_contact_id     TEXT;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS rzp_fund_account_id TEXT;

-- Add razorpay_payout_id and mode to affiliate_payouts
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS rzp_payout_id  TEXT;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS payout_mode     TEXT DEFAULT 'upi'; -- 'upi' | 'neft' | 'imps'
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS failure_reason  TEXT;
