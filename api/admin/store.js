// api/admin/store.js — customers, reviews, affiliates, coupons, settings, analytics (merged)
require('dotenv').config();
const { supabaseAdmin } = require('../../lib/supabase');
const { requireAdmin } = require('../../lib/auth');
const { sendWhatsApp } = require('../../lib/msg91');


// ── Razorpay Payouts helper ───────────────────────────────────
const RZP_KEY    = process.env.RAZORPAY_PAYOUT_KEY    || process.env.RAZORPAY_KEY_ID;
const RZP_SECRET = process.env.RAZORPAY_PAYOUT_SECRET || process.env.RAZORPAY_KEY_SECRET;
const RZP_ACCOUNT_NUMBER = process.env.RAZORPAY_ACCOUNT_NUMBER;
const rzpBase = 'https://api.razorpay.com/v1';
const rzpAuth = () => 'Basic ' + Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString('base64');

async function rzpPost(path, body) {
  const r = await fetch(`${rzpBase}${path}`, {
    method: 'POST',
    headers: { 'Authorization': rzpAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function ensureRzpContact(aff) {
  if (aff.rzp_contact_id) return aff.rzp_contact_id;
  const c = await rzpPost('/contacts', {
    name: aff.name,
    email: aff.email || undefined,
    contact: aff.phone,
    type: 'vendor',
    reference_id: aff.id
  });
  if (!c.id) throw new Error('Razorpay contact creation failed: ' + JSON.stringify(c));
  await supabaseAdmin.from('affiliates').update({ rzp_contact_id: c.id }).eq('id', aff.id);
  return c.id;
}

async function ensureRzpFundAccount(aff, contactId) {
  if (aff.rzp_fund_account_id) return aff.rzp_fund_account_id;
  let faBody;
  if (aff.payout_method === 'bank' && aff.bank_verified) {
    faBody = { contact_id: contactId, account_type: 'bank_account', bank_account: { name: aff.bank_name || aff.name, account_number: aff.bank_account_number, ifsc: aff.bank_ifsc } };
  } else if (aff.upi_verified) {
    faBody = { contact_id: contactId, account_type: 'vpa', vpa: { address: aff.upi_id } };
  } else {
    throw new Error('No verified payout method found.');
  }
  const fa = await rzpPost('/fund_accounts', faBody);
  if (!fa.id) throw new Error('Razorpay fund account creation failed: ' + JSON.stringify(fa));
  await supabaseAdmin.from('affiliates').update({ rzp_fund_account_id: fa.id }).eq('id', aff.id);
  return fa.id;
}
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const admin = requireAdmin(req, res); if (!admin) return;

  const section = req.query?.section || '';

  // ══ ANALYTICS ════════════════════════════════════════════
  if (section === 'analytics') {
    const range = req.query?.range || '7';
    const days = parseInt(range);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const prevSince = new Date(Date.now() - days * 2 * 86400000).toISOString();
    const [
      { data: orders }, { data: prevOrders }, { data: todayOrders },
      { data: productStats }, { data: affiliateStats }, { data: whatsappStats }
    ] = await Promise.all([
      supabaseAdmin.from('orders').select('id, total, payment_method, status, created_at, customer_id, coupon_code').gte('created_at', since),
      supabaseAdmin.from('orders').select('id, total, payment_method, status').gte('created_at', prevSince).lt('created_at', since),
      supabaseAdmin.from('orders').select('id, total, payment_method, status').gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
      supabaseAdmin.from('order_items').select('product_name, variant_color, quantity, price, order_id, orders(created_at, status)').gte('orders.created_at', since),
      supabaseAdmin.from('affiliate_commissions').select('commission_amount, created_at').gte('created_at', since),
      supabaseAdmin.from('whatsapp_logs').select('status, created_at').gte('created_at', since)
    ]);
    const allOrders = orders || [], prev = prevOrders || [], today = todayOrders || [];
    const totalRevenue = allOrders.reduce((s, o) => s + (o.total || 0), 0);
    const prevRevenue = prev.reduce((s, o) => s + (o.total || 0), 0);
    const revenueGrowth = prevRevenue ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : null;
    const totalOrders = allOrders.length, prevTotalOrders = prev.length;
    const ordersGrowth = prevTotalOrders ? (((totalOrders - prevTotalOrders) / prevTotalOrders) * 100).toFixed(1) : null;
    const todayRevenue = today.reduce((s, o) => s + (o.total || 0), 0), todayOrderCount = today.length;
    const codOrders = allOrders.filter(o => o.payment_method === 'cod');
    const prepaidOrders = allOrders.filter(o => o.payment_method !== 'cod');
    const codPct = totalOrders ? ((codOrders.length / totalOrders) * 100).toFixed(1) : 0;
    const prepaidPct = totalOrders ? ((prepaidOrders.length / totalOrders) * 100).toFixed(1) : 0;
    const codRevenue = codOrders.reduce((s, o) => s + (o.total || 0), 0);
    const prepaidRevenue = prepaidOrders.reduce((s, o) => s + (o.total || 0), 0);
    const returnedOrders = allOrders.filter(o => o.status === 'returned');
    const deliveredOrders = allOrders.filter(o => ['delivered', 'returned'].includes(o.status));
    const rtoPct = deliveredOrders.length ? ((returnedOrders.length / deliveredOrders.length) * 100).toFixed(1) : '0.0';
    const codReturned = returnedOrders.filter(o => o.payment_method === 'cod').length;
    const codDelivered = deliveredOrders.filter(o => o.payment_method === 'cod').length;
    const codRtoPct = codDelivered ? ((codReturned / codDelivered) * 100).toFixed(1) : '0.0';
    const aov = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;
    const prevAov = prevTotalOrders ? Math.round(prevRevenue / prevTotalOrders) : 0;
    const statusCount = {};
    allOrders.forEach(o => { statusCount[o.status] = (statusCount[o.status] || 0) + 1; });
    const dailyMap = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      dailyMap[key] = { revenue: 0, orders: 0, cod: 0, prepaid: 0 };
    }
    allOrders.forEach(o => {
      const key = new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      if (dailyMap[key]) { dailyMap[key].revenue += o.total || 0; dailyMap[key].orders += 1; if (o.payment_method === 'cod') dailyMap[key].cod += 1; else dailyMap[key].prepaid += 1; }
    });
    const chart = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v }));
    const productMap = {};
    (productStats || []).forEach(item => {
      if (!item.orders || item.orders.status === 'cancelled') return;
      const key = `${item.product_name} (${item.variant_color})`;
      if (!productMap[key]) productMap[key] = { name: key, units: 0, revenue: 0 };
      productMap[key].units += item.quantity || 1;
      productMap[key].revenue += (item.price || 0) * (item.quantity || 1);
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const totalCommission = (affiliateStats || []).reduce((s, c) => s + (c.commission_amount || 0), 0);
    const waSent = (whatsappStats || []).length;
    const waFailed = (whatsappStats || []).filter(w => w.status === 'failed').length;
    const waSuccessRate = waSent ? (((waSent - waFailed) / waSent) * 100).toFixed(1) : '100.0';
    const uniqueCustomers = new Set(allOrders.map(o => o.customer_id)).size;
    return res.json({
      success: true, range: days,
      today: { revenue: todayRevenue, orders: todayOrderCount },
      revenue: { total: totalRevenue, prev: prevRevenue, growth: revenueGrowth, cod: codRevenue, prepaid: prepaidRevenue },
      orders: { total: totalOrders, prev: prevTotalOrders, growth: ordersGrowth, cod: codOrders.length, prepaid: prepaidOrders.length },
      rates: { codPct, prepaidPct, rtoPct, codRtoPct, aov, prevAov },
      status: statusCount, chart, topProducts,
      customers: { unique: uniqueCustomers, repeat: allOrders.length - uniqueCustomers },
      whatsapp: { sent: waSent, failed: waFailed, successRate: waSuccessRate },
      affiliate: { totalCommission }
    });
  }

  // ══ CUSTOMERS ════════════════════════════════════════════
  if (section === 'customers') {
    const { search, page = 1 } = req.query;
    const limit = 20, offset = (parseInt(page) - 1) * limit;
    let q = supabaseAdmin.from('customers').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    const { data, count } = await q;
    return res.json({ success: true, customers: data || [], total: count });
  }

  // ══ REVIEWS ══════════════════════════════════════════════
  if (section === 'reviews') {
    if (req.method === 'GET') {
      const { status = 'pending' } = req.query;
      let q = supabaseAdmin.from('reviews').select('*, products(name)').order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data } = await q;
      return res.json({ success: true, reviews: data || [] });
    }
    if (req.method === 'POST') {
      const { productId, reviewerName, reviewerCity, rating, body, source } = req.body || {};
      const { data, error } = await supabaseAdmin.from('reviews').insert({ product_id: productId, reviewer_name: reviewerName, reviewer_city: reviewerCity, rating, body, source: source || 'admin', status: 'approved' }).select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, reviewId: data.id });
    }
    if (req.method === 'PUT') {
      const { id, status } = req.body || {};
      await supabaseAdmin.from('reviews').update({ status }).eq('id', id);
      return res.json({ success: true });
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      await supabaseAdmin.from('reviews').delete().eq('id', id);
      return res.json({ success: true });
    }
  }

  // ══ AFFILIATES ═══════════════════════════════════════════
  if (section === 'affiliates') {
    if (req.method === 'GET') {
      const { status = 'all' } = req.query;
      let q = supabaseAdmin.from('affiliates').select('*').order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data } = await q;
      return res.json({ success: true, affiliates: data || [] });
    }
    if (req.method === 'PUT') {
      const { id, status, tier, commissionRate } = req.body || {};
      const u = {};
      if (status) u.status = status;
      if (tier) u.tier = tier;
      if (commissionRate !== undefined) u.commission_rate = commissionRate;
      await supabaseAdmin.from('affiliates').update(u).eq('id', id);
      // Send WhatsApp if newly approved
      if (status === 'approved') {
        const { data: aff } = await supabaseAdmin.from('affiliates').select('phone, name, referral_code').eq('id', id).single();
        if (aff) await sendWhatsApp(`91${aff.phone}`, process.env.MSG91_TEMPLATE_AFF_APPROVED || 'vh_affiliate_approved', [aff.name, aff.referral_code, `${process.env.APP_BASE_URL}/affiliate`]).catch(() => {});
      }
      return res.json({ success: true });
    }
  }

  // ══ PAYOUTS (Manual Affiliate Withdrawals) ════════════════
  // GET  ?section=payouts              → list all pending requests
  // GET  ?section=payouts&status=all   → list all (any status)
  // PUT  ?section=payouts { id, action: 'paid', transactionRef } → mark as paid
  // PUT  ?section=payouts { id, action: 'reject', reason }       → reject request
  if (section === 'payouts') {
    if (req.method === 'GET') {
      const { status = 'pending' } = req.query;
      let q = supabaseAdmin.from('affiliate_payouts')
        .select('*, affiliates(name, phone, upi_id, tier, commission_rate)')
        .order('requested_at', { ascending: true });
      if (status !== 'all') q = q.eq('status', status);
      const { data } = await q;

      // Summary counts for admin badge
      const { count: pendingCount } = await supabaseAdmin.from('affiliate_payouts')
        .select('id', { count: 'exact', head: true }).eq('status', 'pending');

      return res.json({ success: true, payouts: data || [], pendingCount: pendingCount || 0 });
    }

    if (req.method === 'PUT') {
      const { id, action: payoutAction, transactionRef, reason } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Payout ID required' });

      // ── Mark as PAID (Execute Razorpay Payout) ────────────
      if (payoutAction === 'paid') {
        const { data: payout } = await supabaseAdmin.from('affiliate_payouts')
          .select('*, affiliates(*)').eq('id', id).single();
        if (!payout) return res.status(404).json({ error: 'Payout request not found' });
        if (payout.status === 'paid') return res.status(400).json({ error: 'Already paid' });

        const aff = payout.affiliates;
        
        try {
          // 1. Get/create Razorpay contact
          const contactId = await ensureRzpContact(aff);

          // 2. Get/create fund account
          const fundAccountId = await ensureRzpFundAccount(aff, contactId);

          // 3. Dispatch payout
          const rzpPayout = await rzpPost('/payouts', {
            account_number: RZP_ACCOUNT_NUMBER,
            fund_account_id: fundAccountId,
            amount: payout.amount * 100, // paise
            currency: 'INR',
            mode: payout.payout_mode,
            purpose: 'payout',
            queue_if_low_balance: false,
            reference_id: `VH-${payout.id}`,
            narration: 'Vintage Hides Affiliate Payout',
            notes: { affiliate_id: aff.id, affiliate_name: aff.name }
          });

          if (rzpPayout.id) {
            await supabaseAdmin.from('affiliate_payouts').update({
              status: 'paid',
              paid_at: new Date().toISOString(),
              paid_by: admin.username || 'admin',
              rzp_payout_id: rzpPayout.id,
              transaction_ref: rzpPayout.id
            }).eq('id', id);

            // Reduce pending_balance on affiliate
            const { data: currentAff } = await supabaseAdmin.from('affiliates')
              .select('pending_balance').eq('id', payout.affiliate_id).single();
            await supabaseAdmin.from('affiliates').update({
              pending_balance: Math.max(0, (currentAff?.pending_balance || 0) - payout.amount)
            }).eq('id', payout.affiliate_id);

            return res.json({ success: true, message: `✅ Rs.${payout.amount} transferred successfully to ${payout.upi_id || 'account'}` });
          } else {
            const failReason = rzpPayout.error?.description || rzpPayout.description || JSON.stringify(rzpPayout);
            return res.status(400).json({ error: `Razorpay Payout failed: ${failReason}` });
          }
        } catch (e) {
          console.error('Admin Razorpay payout error:', e);
          return res.status(500).json({ error: `Server Error: ${e.message}` });
        }
      }

      // ── Reject request ────────────────────────────────────
      if (payoutAction === 'reject') {
        const { data: payout } = await supabaseAdmin.from('affiliate_payouts')
          .select('affiliate_id, amount').eq('id', id).single();
        if (!payout) return res.status(404).json({ error: 'Payout request not found' });

        await supabaseAdmin.from('affiliate_payouts').update({
          status: 'rejected',
          note: reason || 'Rejected by admin'
        }).eq('id', id);

        // Refund back to available balance
        const { data: aff } = await supabaseAdmin.from('affiliates')
          .select('available_balance, pending_balance').eq('id', payout.affiliate_id).single();
        await supabaseAdmin.from('affiliates').update({
          available_balance: (aff?.available_balance || 0) + payout.amount,
          pending_balance: Math.max(0, (aff?.pending_balance || 0) - payout.amount)
        }).eq('id', payout.affiliate_id);

        return res.json({ success: true, message: 'Payout request rejected and amount refunded to affiliate balance.' });
      }

      return res.status(400).json({ error: 'Invalid action. Use "paid" or "reject".' });
    }
  }

  // ══ TRANSACTIONS LEDGER (Commissions & Payouts) ════════════
  if (section === 'transactions') {
    if (req.method === 'GET') {
      const { data: commissions } = await supabaseAdmin.from('affiliate_commissions')
        .select('id, created_at, commission_amount, order_amount, status, affiliates(name), orders(order_number)');
      const { data: payouts } = await supabaseAdmin.from('affiliate_payouts')
        .select('id, requested_at, amount, status, payout_mode, affiliates(name)');
      
      const transactions = [];
      
      (commissions || []).forEach(c => {
        transactions.push({
          type: 'commission',
          id: c.id,
          date: c.created_at,
          amount: c.commission_amount,
          status: c.status || 'earned',
          affiliateName: c.affiliates?.name || 'Unknown',
          description: `Commission for Order ${c.orders?.order_number || ''}`
        });
      });

      (payouts || []).forEach(p => {
        transactions.push({
          type: 'payout',
          id: p.id,
          date: p.requested_at,
          amount: -p.amount, // negative for withdrawal
          status: p.status,
          affiliateName: p.affiliates?.name || 'Unknown',
          description: `Withdrawal via ${p.payout_mode}`
        });
      });

      transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
      return res.json({ success: true, transactions });
    }
  }

  // ══ COUPONS ══════════════════════════════════════════════
  if (section === 'coupons') {
    if (req.method === 'GET') {
      const { data } = await supabaseAdmin.from('coupons').select('*').order('created_at', { ascending: false });
      return res.json({ success: true, coupons: data || [] });
    }
    if (req.method === 'POST') {
      const { code, type, value, minOrderValue, maxDiscount, maxUses, expiresAt, description } = req.body || {};
      if (!code || !type || !value) return res.status(400).json({ error: 'Code, type, and value required' });
      const { data, error } = await supabaseAdmin.from('coupons').insert({ code: code.toUpperCase(), type, value, min_order_value: minOrderValue || 0, max_discount: maxDiscount, max_uses: maxUses, expires_at: expiresAt, description, active: true, used_count: 0 }).select('id').single();
      if (error) return res.status(500).json({ error: error.code === '23505' ? 'Coupon code already exists' : error.message });
      return res.json({ success: true, couponId: data.id });
    }
    if (req.method === 'PUT') {
      const { id, active, code, value } = req.body || {};
      const u = {};
      if (active !== undefined) u.active = active; if (code) u.code = code.toUpperCase(); if (value) u.value = value;
      await supabaseAdmin.from('coupons').update(u).eq('id', id);
      return res.json({ success: true });
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      await supabaseAdmin.from('coupons').delete().eq('id', id);
      return res.json({ success: true });
    }
  }

  // ══ SETTINGS ═════════════════════════════════════════════
  if (section === 'settings') {
    if (req.method === 'GET') {
      const { data } = await supabaseAdmin.from('site_settings').select('*');
      const settings = {}; (data || []).forEach(s => { settings[s.key] = s.value; });
      return res.json({ success: true, settings });
    }
    if (req.method === 'PUT') {
      const { key, value } = req.body || {};
      await supabaseAdmin.from('site_settings').upsert({ key, value, updated_at: new Date().toISOString() });
      return res.json({ success: true });
    }
    if (req.method === 'POST') {
      const { action, currentPassword, newPassword } = req.body || {};
      if (action === 'change_password') {
        const { data: adminUser } = await supabaseAdmin.from('admin_users').select('*').eq('id', admin.id).single();
        const valid = await bcrypt.compare(currentPassword, adminUser.password_hash);
        if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
        const newHash = await bcrypt.hash(newPassword, 10);
        await supabaseAdmin.from('admin_users').update({ password_hash: newHash }).eq('id', admin.id);
        return res.json({ success: true });
      }
    }
  }

  return res.status(404).json({ error: 'Unknown section' });
};
