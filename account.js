// api/account.js — Customer account: OTP login, profile, orders
// OTP flow uses custom WhatsApp OTP (MSG91 WhatsApp API — see lib/msg91.js)
// FIX: Tokens now use CUSTOMER_JWT_SECRET (dedicated secret, separate from admin)
require('dotenv').config();
const { supabaseAdmin } = require('../lib/supabase');
const { sendAccountOTP, verifyOTP, resendOTP } = require('../lib/msg91');
const jwt = require('jsonwebtoken');

// CUSTOMER_JWT_SECRET must be set in .env — falls back only for backward compat
const CUSTOMER_SECRET = process.env.CUSTOMER_JWT_SECRET
  || process.env.JWT_SECRET
  || (() => { console.warn('[WARN] CUSTOMER_JWT_SECRET not set! Using ADMIN_JWT_SECRET as fallback — add CUSTOMER_JWT_SECRET to .env'); return process.env.ADMIN_JWT_SECRET; })();

function makeToken(customer) {
  return jwt.sign(
    { id: customer.id, phone: customer.phone, role: 'customer' },
    CUSTOMER_SECRET,
    { expiresIn: '30d' }
  );
}

function getCustomer(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), CUSTOMER_SECRET); } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || '';

  // ══════════════════════════════════════════════════════════
  // POST send-otp — sends WhatsApp OTP via MSG91 OTP API
  // MSG91 generates OTP automatically. Message is predefined.
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'send-otp') {
    const { phone } = req.body || {};
    if (!phone || !/^[6-9]\d{9}$/.test(phone))
      return res.status(400).json({ error: 'Valid 10-digit Indian mobile number required' });

    const result = await sendAccountOTP(phone);

    if (!result.success)
      return res.status(500).json({ error: 'Could not send OTP. Please try again.' });

    return res.json({ success: true, message: 'OTP sent on WhatsApp. Valid for 10 minutes.' });
  }

  // ══════════════════════════════════════════════════════════
  // POST verify-otp — MSG91 verifies the OTP
  // No DB lookup needed — MSG91 validates internally
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'verify-otp') {
    const { phone, otp } = req.body || {};
    if (!phone || !otp)
      return res.status(400).json({ error: 'Phone and OTP required' });

    const verification = await verifyOTP(phone, otp);
    if (!verification.success)
      return res.status(400).json({ error: 'Invalid or expired OTP. Please try again.' });

    // OTP valid — upsert customer
    const { data: existing } = await supabaseAdmin.from('customers')
      .select('id, name, phone, email, city, state, total_orders, total_spent')
      .eq('phone', phone).maybeSingle();

    let customer;
    if (existing) {
      customer = existing;
    } else {
      const { data: newC } = await supabaseAdmin.from('customers')
        .insert({ phone }).select('id, name, phone, email, city, state, total_orders, total_spent').single();
      customer = newC;
    }

    if (!customer) return res.status(500).json({ error: 'Account error. Please contact support.' });

    const token = makeToken(customer);
    return res.json({ success: true, token, customer, isNewCustomer: !existing });
  }

  // ══════════════════════════════════════════════════════════
  // POST resend-otp — resend if user didn't receive it
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'resend-otp') {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const result = await resendOTP(phone);
    if (!result.success)
      return res.status(500).json({ error: 'Could not resend OTP. Please wait a moment.' });

    return res.json({ success: true, message: 'OTP resent on WhatsApp.' });
  }

  // ══════════════════════════════════════════════════════════
  // GET me — fetch customer profile + orders
  // ══════════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'me') {
    const user = getCustomer(req);
    if (!user) return res.status(401).json({ error: 'Please login to continue' });

    const { data: customer } = await supabaseAdmin.from('customers')
      .select('id, name, phone, email, address_line1, address_line2, city, state, pincode, total_orders, total_spent, created_at')
      .eq('id', user.id).single();

    if (!customer) return res.status(404).json({ error: 'Account not found' });

    const { data: orders } = await supabaseAdmin.from('orders')
      .select('id, order_number, status, payment_method, total, awb, tracking_url, created_at, order_items(product_name, variant_color, quantity, price)')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.json({ success: true, customer, orders: orders || [] });
  }

  // ══════════════════════════════════════════════════════════
  // PUT profile — update customer details
  // ══════════════════════════════════════════════════════════
  if (req.method === 'PUT' && action === 'profile') {
    const user = getCustomer(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { name, email, addressLine1, addressLine2, city, state, pincode } = req.body || {};
    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (addressLine1) updates.address_line1 = addressLine1;
    if (addressLine2 !== undefined) updates.address_line2 = addressLine2;
    if (city) updates.city = city;
    if (state) updates.state = state;
    if (pincode) updates.pincode = pincode;

    await supabaseAdmin.from('customers').update(updates).eq('id', user.id);
    return res.json({ success: true, message: 'Profile updated' });
  }

  return res.status(404).json({ error: 'Unknown action' });
};
