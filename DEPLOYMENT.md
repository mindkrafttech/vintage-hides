# ═══════════════════════════════════════════════════════════════════
#  VINTAGE HIDES — DEPLOYMENT CHECKLIST
#  Complete each step in order before running: vercel --prod
# ═══════════════════════════════════════════════════════════════════

## STEP 1 — SUPABASE (Do first, everything depends on this)
# ──────────────────────────────────────────────────────────────────
# 1. Go to: https://supabase.com → New Project
# 2. Name: "vintage-hides-prod", Region: South Asia (ap-south-1)
# 3. Save your DB password somewhere safe
# 4. Go to: Project Settings → API
#    → Copy "Project URL"        → paste in SUPABASE_URL in .env
#    → Copy "anon public" key    → paste in SUPABASE_ANON_KEY in .env
#    → Copy "service_role" key   → paste in SUPABASE_SERVICE_KEY in .env
# 5. Go to: SQL Editor → New Query
#    → Paste ENTIRE contents of supabase-schema.sql → Run
#    → Should say "Success. No rows returned"

## STEP 2 — RAZORPAY
# ──────────────────────────────────────────────────────────────────
# 1. Go to: https://dashboard.razorpay.com → Settings → API Keys
#    → Generate Live Keys (switch from Test mode)
#    → Copy Key ID     → RAZORPAY_KEY_ID in .env
#    → Copy Key Secret → RAZORPAY_KEY_SECRET in .env
# 2. Settings → Webhooks → Add Webhook
#    → URL: https://www.vintagehides.in/api/orders/webhook
#    → Events: payment.captured, payment.failed
#    → Set a secret → copy it → RAZORPAY_WEBHOOK_SECRET in .env
# 3. Settings → Account → Bank Account number → RAZORPAY_ACCOUNT_NUMBER

## STEP 3 — MSG91
# ──────────────────────────────────────────────────────────────────
# 1. Go to: https://control.msg91.com → API → Auth Key
#    → Copy → MSG91_AUTH_KEY in .env
# 2. WhatsApp → Integrated Number → copy → MSG91_INTEGRATED_NUMBER
# 3. Template IDs are filled in already (submit templates to Meta for approval)

## STEP 4 — DELHIVERY
# ──────────────────────────────────────────────────────────────────
# 1. Email: seller-support@delhivery.com to get API access
# 2. Once approved: Merchant portal → Integration → Copy token
#    → DELHIVERY_TOKEN in .env
# 3. Set WAREHOUSE_NAME = your pickup address label in Delhivery

## STEP 5 — DEPLOY TO VERCEL (after filling .env)
# ──────────────────────────────────────────────────────────────────
# Run these commands in order:
#
#   vercel login            (already done)
#
#   vercel env add SUPABASE_URL production
#   vercel env add SUPABASE_ANON_KEY production
#   vercel env add SUPABASE_SERVICE_KEY production
#   vercel env add RAZORPAY_KEY_ID production
#   vercel env add RAZORPAY_KEY_SECRET production
#   vercel env add RAZORPAY_WEBHOOK_SECRET production
#   vercel env add MSG91_AUTH_KEY production
#   vercel env add MSG91_INTEGRATED_NUMBER production
#   vercel env add DELHIVERY_TOKEN production
#   vercel env add ADMIN_JWT_SECRET production
#   vercel env add AFFILIATE_JWT_SECRET production
#   vercel env add APP_BASE_URL production
#   vercel env add PREORDER_TOKEN_AMOUNT production
#
#   vercel --prod           (deploy!)

## STEP 6 — CREATE FIRST ADMIN USER
# ──────────────────────────────────────────────────────────────────
#   node scripts/setup-admin.js
# (Run after .env is filled in locally)

## STEP 7 — UPDATE PRODUCT PAGE
# ──────────────────────────────────────────────────────────────────
# After adding first product in admin panel:
# 1. Go to: https://www.vintagehides.in/admin → Products → Add Product
# 2. Copy the Product UUID and Variant UUIDs
# 3. Edit product page.html → find VH_CONFIG block → update:
#    productId: 'paste-uuid-here'
#    variantIds: { 'Pitch Black': 'uuid', 'Mocha Brown': 'uuid', ... }
# 4. Run: vercel --prod  (redeploy)

## STEP 8 — CUSTOM DOMAIN
# ──────────────────────────────────────────────────────────────────
# Vercel Dashboard → Project → Settings → Domains
# Add: www.vintagehides.in and vintagehides.in
# Add CNAME records in your domain registrar pointing to cname.vercel-dns.com
