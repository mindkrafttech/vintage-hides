// api/affiliate.js
// Handles: signup, signin (via MSG91 OTP API), dashboard, commissions, withdraw (AUTOMATED via Razorpay Payouts), click
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
    const { resendOTP: resend } = require('../lib/msg91');
    const result = await resend(phone);
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
      .select('commission_amount, created_at').eq('affiliate_id', aff.id).gte('created_at', weekAgo);
    const { data: recent } = await supabaseAdmin.from('affiliate_commissions')
      .select('*, orders(order_number)').eq('affiliate_id', aff.id)
      .order('created_at', { ascending: false }).limit(5);
    const { data: pendingPayout } = await supabaseAdmin.from('affiliate_payouts')
      .select('id, amount, requested_at').eq('affiliate_id', aff.id).eq('status', 'pending').maybeSingle();

    // weekClicks (placeholder or from a hypothetical clicks table, but for now we use a subset of total_clicks if no click logging exists)
    // Actually, I'll search if there's a click logging table.

    const weekEarnings = (weekComm || []).reduce((s, c) => s + (c.commission_amount || 0), 0);
    const weekSales = (weekComm || []).length;
    const convRate = aff.total_clicks > 0 ? ((aff.total_orders / aff.total_clicks) * 100).toFixed(1) : '0.0';

    // ── Generate real 7-day revenue graph data
    const graphData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0,0,0,0);
      const nextD = new Date(d.getTime() + 86400000);
      const dayComms = (weekComm || []).filter(c => new Date(c.created_at) >= d && new Date(c.created_at) < nextD);
      const total = dayComms.reduce((s, c) => s + (c.commission_amount || 0), 0);
      graphData.push({
        label: d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2),
        value: total
      });
    }

    // Tier: Starter (10%) → Pro (12%, after Rs.10,000 earned) → Elite (15%, after Rs.50,000 earned)
    const tierThresholds = { starter: 0, pro: 10000, elite: 50000 };
    const nextTier = aff.tier === 'starter' ? 'pro' : aff.tier === 'pro' ? 'elite' : null;
    const progress = nextTier ? Math.min(100, Math.round((aff.total_earned / tierThresholds[nextTier]) * 100)) : 100;

    const { data: pendComm } = await supabaseAdmin.from('affiliate_commissions')
      .select('commission_amount')
      .eq('affiliate_id', aff.id)
      .in('status', ['pending', 'holding']);
    const pendingBalance = (pendComm || []).reduce((s, c) => s + (c.commission_amount || 0), 0);

    const { data: paidOuts } = await supabaseAdmin.from('affiliate_payouts')
      .select('amount').eq('affiliate_id', aff.id).eq('status', 'paid');
    const totalPaidOut = (paidOuts || []).reduce((s, p) => s + (p.amount || 0), 0);

    return res.json({
      success: true,
      affiliate: { ...aff, referralLink: `${process.env.APP_BASE_URL}/?ref=${aff.referral_code}` },
      stats: {
        availableBalance: aff.available_balance,
        pendingBalance,
        totalPaidOut,
        totalEarned: Math.max(aff.total_earned || 0, (aff.available_balance || 0) + totalPaidOut),
        totalOrders: aff.total_orders,
        totalClicks: aff.total_clicks,
        weekEarnings,
        weekSales,
        conversionRate: convRate,
        coins: (aff.available_balance || 0) * 10,
        graphData
      },
      kyc: {
        status: aff.kyc_status || 'pending',
        done: aff.kyc_done || false,
        panVerified: aff.pan_verified || false,
        panName: aff.pan_name || '',
        aadhaarVerified: aff.aadhaar_verified || false,
        upiVerified: aff.upi_verified || false,
        upiVerifiedName: aff.upi_verified_name || '',
        bankVerified: aff.bank_verified || false,
        bankName: aff.bank_name || '',
        payoutMethod: aff.payout_method || 'upi'
      },
      recentCommissions: recent || [],
      tierProgress: { progress, nextTier, nextThreshold: nextTier ? tierThresholds[nextTier] : null },
      pendingPayout: pendingPayout || null
    });
  }

  // ── GET referrals ─────────────────────────────────────────
  if (req.method === 'GET' && action === 'referrals') {
    const { data: commissions } = await supabaseAdmin.from('affiliate_commissions')
      .select('id, order_amount, commission_amount, status, created_at, orders(order_number, status)')
      .eq('affiliate_id', payload.id)
      .order('created_at', { ascending: false })
      .limit(50);
      
    const mapped = (commissions || []).map(c => ({
      order_number: c.orders?.order_number || 'Unknown',
      total: c.order_amount,
      delivery_status: c.orders?.status || 'processing',
      created_at: c.created_at,
      commission_amount: c.commission_amount,
      commission_status: c.status || 'pending'
    }));
    return res.json({ success: true, referrals: mapped });
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

  // ── POST withdraw — AUTOMATED via Razorpay Payouts ──────────
  if (req.method === 'POST' && action === 'withdraw') {
    const { amount, method, note } = req.body || {};

    if (!amount || amount < 500)
      return res.status(400).json({ error: 'Minimum withdrawal amount is ₹500' });

    const { data: aff } = await supabaseAdmin.from('affiliates').select('*').eq('id', payload.id).single();
    if (!aff) return res.status(404).json({ error: 'Account not found' });

    // ── KYC Gate ──────────────────────────────────────────────
    if (!aff.kyc_done) {
      const missing = [];
      if (!aff.pan_verified) missing.push('PAN verification');
      if (!aff.aadhaar_verified) missing.push('Aadhaar verification');
      if (!aff.upi_verified && !aff.bank_verified) missing.push('UPI or Bank Account verification');
      return res.status(400).json({
        error: `Complete KYC before withdrawing. Pending: ${missing.join(', ')}. Go to Wallet → KYC.`,
        kycRequired: true
      });
    }

    if ((aff.available_balance || 0) < amount)
      return res.status(400).json({ error: `Insufficient balance. Available: ₹${aff.available_balance || 0}` });

    // Block if a pending request already exists
    const { data: existing } = await supabaseAdmin.from('affiliate_payouts')
      .select('id, amount').eq('affiliate_id', payload.id).eq('status', 'pending').maybeSingle();
    if (existing)
      return res.status(400).json({ error: `You have a pending withdrawal of ₹${existing.amount}. Wait for it to process.` });

    // (UPI is now saved strictly via KYC Verification)

    // ── Deduct from balance immediately ──────────────────────
    await supabaseAdmin.from('affiliates').update({
      available_balance: (aff.available_balance || 0) - amount,
      pending_balance: (aff.pending_balance || 0) + amount
    }).eq('id', aff.id);

    // ── Create payout record (pending) ────────────────────────
    let payoutUpi = null;
    let payoutMode = 'UPI';

    if (method === 'bank') {
      if (!aff.bank_verified) return res.status(400).json({ error: 'Bank account is not verified.' });
      payoutUpi = aff.bank_account_number;
      payoutMode = 'NEFT';
    } else {
      if (!aff.upi_verified) return res.status(400).json({ error: 'UPI ID is not verified.' });
      payoutUpi = aff.upi_id;
      payoutMode = 'UPI';
    }

    const { data: newPayout } = await supabaseAdmin.from('affiliate_payouts').insert({
      affiliate_id: aff.id,
      amount,
      status: 'pending',
      upi_id: payoutUpi || null,
      payout_mode: payoutMode,
      note: note || null,
      requested_at: new Date().toISOString()
    }).select('id').single();

    return res.json({
      success: true,
      pending: true,
      message: `Withdrawal of ₹${amount} is queued. Admin will process it within 24 hours.`
    });
  }

  // ── GET leaderboard ───────────────────────────────────────
  if (req.method === 'GET' && action === 'leaderboard') {
    // Fetch top 10 approved affiliates by total_earned
    const { data: topAffiliates, error: affErr } = await supabaseAdmin.from('affiliates')
      .select('name, total_orders, total_earned')
      .eq('status', 'approved')
      .order('total_earned', { ascending: false })
      .limit(10);

    if (affErr) return res.status(500).json({ error: 'Failed to fetch leaderboard' });

    // Find the current affiliate's rank
    const { data: allAffs } = await supabaseAdmin.from('affiliates')
      .select('id, total_earned')
      .eq('status', 'approved')
      .order('total_earned', { ascending: false });

    const myRank = allAffs ? allAffs.findIndex(a => a.id === payload.id) + 1 : 0;
    const me = allAffs ? allAffs.find(a => a.id === payload.id) : null;

    return res.json({
      success: true,
      leaderboard: topAffiliates.map((a, i) => ({
        rank: i + 1,
        name: a.name.split(' ')[0] + ' ' + (a.name.split(' ')[1] ? a.name.split(' ')[1][0] + '.' : ''),
        orders: a.total_orders,
        earnings: a.total_earned
      })),
      me: {
        rank: myRank,
        orders: me ? me.total_orders : 0,
        earnings: me ? me.total_earned : 0
      }
    });
  }

  return res.status(404).json({ error: 'Unknown action' });
};
