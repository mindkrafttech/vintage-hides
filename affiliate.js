// api/affiliate.js
// Handles: signup, signin (via MSG91 OTP API), dashboard, commissions, withdraw (MANUAL), click
require('dotenv').config();
const { supabaseAdmin } = require('../lib/supabase');
const { sendAffiliateOTP, verifyOTP, resendOTP } = require('../lib/msg91');
const jwt = require('jsonwebtoken');

// Generate referral code from name
function generateCode(name) {
  const base = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5).padEnd(5, 'X');
  return base + Math.floor(1000 + Math.random() * 9000);
}
function requireAffiliate(req) {
  const h = req.headers?.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), process.env.AFFILIATE_JWT_SECRET); } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || '';

  // ── POST signup ───────────────────────────────────────────
  if (req.method === 'POST' && action === 'signup') {
    const { name, phone, email, city, state, socialLink, upiId } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
    const { data: ex } = await supabaseAdmin.from('affiliates').select('id').eq('phone', phone).maybeSingle();
    if (ex) return res.status(400).json({ error: 'Phone already registered. Please login.' });
    const referralCode = generateCode(name).toLowerCase();
    await supabaseAdmin.from('affiliates').insert({
      name, phone, email, city, state, social_link: socialLink,
      upi_id: upiId || null,
      referral_code: referralCode, status: 'pending', tier: 'starter',
      commission_rate: 10, total_clicks: 0, total_orders: 0,
      total_earned: 0, available_balance: 0, pending_balance: 0
    });
    return res.json({ success: true, message: 'Application submitted! We will WhatsApp you within 24 hours.' });
  }

  // ── POST signin — MSG91 OTP ───────────────────────────────
  if (req.method === 'POST' && action === 'signin') {
    const { phone, otp } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (!otp) {
      const { data: aff } = await supabaseAdmin.from('affiliates')
        .select('id, status').eq('phone', phone).single();
      if (!aff) return res.status(404).json({ error: 'Phone not registered. Please apply first.' });
      if (aff.status === 'pending') return res.status(403).json({ error: 'Your application is under review. We will WhatsApp you once approved.' });
      if (aff.status === 'rejected') return res.status(403).json({ error: 'Your application was not approved.' });
      const result = await sendAffiliateOTP(phone);
      if (!result.success) return res.status(500).json({ error: 'Could not send OTP. Please try again.' });
      return res.json({ success: true, step: 'verify', message: 'OTP sent on WhatsApp. Valid for 10 minutes.' });
    }

    const verification = await verifyOTP(phone, otp);
    if (!verification.success) return res.status(400).json({ error: 'Invalid or expired OTP. Please try again.' });

    const { data: aff } = await supabaseAdmin.from('affiliates').select('*').eq('phone', phone).single();
    if (!aff) return res.status(404).json({ error: 'Account not found' });

    const token = jwt.sign({ id: aff.id, phone: aff.phone }, process.env.AFFILIATE_JWT_SECRET, { expiresIn: '30d' });
    return res.json({ success: true, token, affiliate: { id: aff.id, name: aff.name, referralCode: aff.referral_code, tier: aff.tier, commissionRate: aff.commission_rate } });
  }

  // ── POST resend-otp ───────────────────────────────────────
  if (req.method === 'POST' && action === 'resend-otp') {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    // FIX: was re-importing resendOTP inside handler; use top-level import
    const result = await resendOTP(phone);
    if (!result.success) return res.status(500).json({ error: 'Could not resend OTP.' });
    return res.json({ success: true, message: 'OTP resent on WhatsApp.' });
  }

  // ── POST click ────────────────────────────────────────────
  if (req.method === 'POST' && action === 'click') {
    const { referralCode, page } = req.body || {};
    if (!referralCode) return res.status(400).end();
    const { data: aff } = await supabaseAdmin.from('affiliates')
      .select('id, total_clicks').eq('referral_code', referralCode.toLowerCase()).eq('status', 'approved').single();
    if (!aff) return res.status(404).end();
    await Promise.all([
      supabaseAdmin.from('affiliate_clicks').insert({ affiliate_id: aff.id, referral_code: referralCode, page: page || '/', ip: req.headers['x-forwarded-for'] || '' }),
      supabaseAdmin.from('affiliates').update({ total_clicks: (aff.total_clicks || 0) + 1 }).eq('id', aff.id)
    ]);
    return res.status(200).json({ success: true });
  }

  // ── Require auth for all routes below ────────────────────
  const payload = requireAffiliate(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET dashboard ─────────────────────────────────────────
  if (req.method === 'GET' && action === 'dashboard') {
    const { data: aff } = await supabaseAdmin.from('affiliates').select('*').eq('id', payload.id).single();
    if (!aff) return res.status(404).json({ error: 'Not found' });

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: weekComm } = await supabaseAdmin.from('affiliate_commissions')
      .select('commission_amount').eq('affiliate_id', aff.id).gte('created_at', weekAgo);
    const { data: recent } = await supabaseAdmin.from('affiliate_commissions')
      .select('*, orders(order_number)').eq('affiliate_id', aff.id)
      .order('created_at', { ascending: false }).limit(5);
    const { data: pendingPayout } = await supabaseAdmin.from('affiliate_payouts')
      .select('id, amount, requested_at').eq('affiliate_id', aff.id).eq('status', 'pending').maybeSingle();

    const weekEarnings = (weekComm || []).reduce((s, c) => s + (c.commission_amount || 0), 0);
    const convRate = aff.total_clicks > 0 ? ((aff.total_orders / aff.total_clicks) * 100).toFixed(1) : '0.0';

    // Tier: Starter (10%) → Pro (12%, after Rs.10,000 earned) → Elite (15%, after Rs.50,000 earned)
    const tierThresholds = { starter: 0, pro: 10000, elite: 50000 };
    const nextTier = aff.tier === 'starter' ? 'pro' : aff.tier === 'pro' ? 'elite' : null;
    const progress = nextTier ? Math.min(100, Math.round((aff.total_earned / tierThresholds[nextTier]) * 100)) : 100;

    return res.json({
      success: true,
      affiliate: { ...aff, referralLink: `${process.env.APP_BASE_URL}/?ref=${aff.referral_code}` },
      stats: {
        availableBalance: aff.available_balance,
        pendingBalance: aff.pending_balance || 0,
        totalEarned: aff.total_earned,
        totalOrders: aff.total_orders,
        totalClicks: aff.total_clicks,
        weekEarnings,
        conversionRate: convRate
      },
      recentCommissions: recent || [],
      tierProgress: { progress, nextTier, nextThreshold: nextTier ? tierThresholds[nextTier] : null },
      pendingPayout: pendingPayout || null
    });
  }

  // ── GET commissions ───────────────────────────────────────
  if (req.method === 'GET' && action === 'commissions') {
    const { page = 1, status } = req.query;
    const limit = 20, offset = (parseInt(page) - 1) * limit;
    let q = supabaseAdmin.from('affiliate_commissions')
      .select('*, orders(order_number, created_at)', { count: 'exact' })
      .eq('affiliate_id', payload.id).order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (status) q = q.eq('status', status);
    const { data, count } = await q;
    const { data: payouts } = await supabaseAdmin.from('affiliate_payouts')
      .select('*').eq('affiliate_id', payload.id)
      .order('created_at', { ascending: false }).limit(10);
    return res.json({ success: true, commissions: data || [], total: count, payouts: payouts || [] });
  }

  // ── PUT update-upi — save UPI ID to profile ───────────────
  if (req.method === 'PUT' && action === 'update-upi') {
    const { upiId } = req.body || {};
    if (!upiId) return res.status(400).json({ error: 'UPI ID required' });
    await supabaseAdmin.from('affiliates').update({ upi_id: upiId }).eq('id', payload.id);
    return res.json({ success: true, message: 'UPI ID updated successfully' });
  }

  // ── POST withdraw — MANUAL PAYOUT REQUEST ─────────────────
  // Flow: Affiliate requests → stored as "pending" → Admin pays via UPI manually
  //       → Admin marks "paid" in admin panel → balance updated
  if (req.method === 'POST' && action === 'withdraw') {
    const { amount, upiId, note } = req.body || {};

    if (!amount || amount < 500)
      return res.status(400).json({ error: 'Minimum withdrawal amount is Rs.500' });

    const { data: aff } = await supabaseAdmin.from('affiliates').select('*').eq('id', payload.id).single();
    if (!aff) return res.status(404).json({ error: 'Account not found' });

    if ((aff.available_balance || 0) < amount)
      return res.status(400).json({ error: `Insufficient balance. Available: Rs.${aff.available_balance || 0}` });

    // Block if a pending request already exists
    const { data: existing } = await supabaseAdmin.from('affiliate_payouts')
      .select('id, amount').eq('affiliate_id', payload.id).eq('status', 'pending').maybeSingle();
    if (existing)
      return res.status(400).json({ error: `You already have a pending withdrawal of Rs.${existing.amount}. Please wait for it to be processed before requesting again.` });

    // Use UPI from request or saved profile
    const payoutUpi = upiId || aff.upi_id;
    if (!payoutUpi)
      return res.status(400).json({ error: 'Please add your UPI ID before requesting a withdrawal. Go to Profile → Edit UPI.' });

    // Save UPI to profile if it changed
    if (upiId && upiId !== aff.upi_id)
      await supabaseAdmin.from('affiliates').update({ upi_id: upiId }).eq('id', aff.id);

    // Create withdrawal request
    await supabaseAdmin.from('affiliate_payouts').insert({
      affiliate_id: aff.id,
      amount,
      status: 'pending',
      upi_id: payoutUpi,
      note: note || null,
      requested_at: new Date().toISOString()
    });

    // Deduct from available balance, add to pending balance
    await supabaseAdmin.from('affiliates').update({
      available_balance: (aff.available_balance || 0) - amount,
      pending_balance: (aff.pending_balance || 0) + amount
    }).eq('id', aff.id);

    return res.json({
      success: true,
      message: `Withdrawal request of Rs.${amount} submitted to UPI: ${payoutUpi}. We will process it within 3-5 business days.`
    });
  }

  return res.status(404).json({ error: 'Unknown action' });
};
