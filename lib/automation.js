// lib/automation.js — PRODUCTION COMPLETE
// COD risk scoring, post-purchase sequences, abandoned cart, pre-dispatch, queue processor
require('dotenv').config();
const { supabaseAdmin } = require('./supabase');
const { dispatchTemplate, sendPreDispatch } = require('./msg91');

// ═══════════════════════════════════════════════════════════
// COD RISK SCORING
// Returns: { score, action: 'allow'|'flag'|'block', reason }
// ═══════════════════════════════════════════════════════════
async function scoreCODRisk({ phone, pincode, total, isNewCustomer }) {
  let score = 0;
  const reasons = [];

  if (isNewCustomer) { score += 20; reasons.push('new customer'); }
  if (total > 3000) { score += 10; reasons.push('high value'); }
  if (total > 5000) { score += 15; reasons.push('very high value'); }

  // Pincode RTO history
  const { data: pc } = await supabaseAdmin.from('pincode_rto_stats')
    .select('rto_count, order_count').eq('pincode', pincode).maybeSingle();
  if (pc && pc.order_count >= 5) {
    const rto = (pc.rto_count / pc.order_count) * 100;
    if (rto > 30) { score += 40; reasons.push(`high-RTO pincode (${rto.toFixed(0)}%)`); }
    else if (rto > 15) { score += 20; reasons.push('moderate-RTO pincode'); }
  }

  // Customer COD return history
  if (phone) {
    const { data: custOrders } = await supabaseAdmin.from('orders')
      .select('status, customers!inner(phone)')
      .eq('customers.phone', phone)
      .eq('payment_method', 'cod')
      .in('status', ['returned', 'cancelled'])
      .limit(10);
    if (custOrders && custOrders.length >= 2) {
      score += 30; reasons.push(`${custOrders.length} past COD returns`);
    }
  }

  let action = 'allow';
  if (score >= 70) action = 'block';
  else if (score >= 35) action = 'flag';

  return { score, action, reason: reasons.join(', ') || 'ok' };
}

// ═══════════════════════════════════════════════════════════
// POST-DELIVERY SEQUENCE — queue 4 messages
// ═══════════════════════════════════════════════════════════
async function triggerPostDeliverySequence(orderId) {
  const { data: order } = await supabaseAdmin.from('orders')
    .select('order_number, customers(name, phone), order_items(product_name)')
    .eq('id', orderId).single();

  if (!order?.customers?.phone) return;
  const { name, phone } = order.customers;
  const product = order.order_items?.[0]?.product_name || 'your Vintage Hides bag';
  const base = process.env.APP_BASE_URL || 'https://www.vintagehides.in';
  const now = Date.now();

  const queue = [
    // Day 2: Review request
    { phone, template: 'vh_review_request', vars: JSON.stringify([name, product, `${base}/review?order=${order.order_number}`]), send_at: new Date(now + 2 * 86400000).toISOString(), type: 'post_purchase', order_id: orderId },
    // Day 5: Care tips
    { phone, template: 'vh_care_tips', vars: JSON.stringify([name, product]), send_at: new Date(now + 5 * 86400000).toISOString(), type: 'post_purchase', order_id: orderId },
    // Day 10: Upsell
    { phone, template: 'vh_upsell_1', vars: JSON.stringify([name, `${base}/products/ryza-duo`]), send_at: new Date(now + 10 * 86400000).toISOString(), type: 'post_purchase', order_id: orderId },
    // Day 15: Loyalty reward
    { phone, template: 'vh_repeat_reward', vars: JSON.stringify([name, 'REPEAT150', base]), send_at: new Date(now + 15 * 86400000).toISOString(), type: 'post_purchase', order_id: orderId }
  ];

  await supabaseAdmin.from('post_purchase_queue').insert(queue);
}

// ═══════════════════════════════════════════════════════════
// PRE-DISPATCH CONFIRMATION — send before shipping
// ═══════════════════════════════════════════════════════════
async function sendPreDispatchConfirmation(orderId) {
  const { data: order } = await supabaseAdmin.from('orders')
    .select('order_number, customers(name, phone), order_items(product_name)')
    .eq('id', orderId).single();

  if (!order?.customers?.phone) return;
  const { name, phone } = order.customers;
  const product = order.order_items?.[0]?.product_name || 'your order';

  await sendPreDispatch(phone, { name, product, orderNumber: order.order_number });
  await supabaseAdmin.from('orders').update({ pre_dispatch_sent_at: new Date().toISOString() }).eq('id', orderId);
}

// ═══════════════════════════════════════════════════════════
// ABANDONED CART — register + queue 3 messages
// ═══════════════════════════════════════════════════════════
async function triggerAbandonedCart({ sessionId, phone, name, productName, variantColor, price }) {
  if (!sessionId || !productName) return;
  const base = process.env.APP_BASE_URL || 'https://www.vintagehides.in';
  const cartUrl = `${base}/products/ryza-core`;
  const now = Date.now();

  // Upsert cart record
  await supabaseAdmin.from('abandoned_carts').upsert({
    session_id: sessionId, phone, name, product_name: productName,
    variant_color: variantColor, price, updated_at: new Date().toISOString()
  }, { onConflict: 'session_id' });

  if (!phone) return; // No phone = can't send WhatsApp

  // Skip if already queued for this session
  const { data: existing } = await supabaseAdmin.from('post_purchase_queue')
    .select('id').eq('phone', phone).eq('type', 'cart').eq('status', 'pending').limit(1);
  if (existing?.length) return;

  await supabaseAdmin.from('post_purchase_queue').insert([
    { phone, template: 'vh_abandoned_30min', vars: JSON.stringify([name || 'there', productName, cartUrl]), send_at: new Date(now + 30 * 60000).toISOString(), type: 'cart', status: 'pending' },
    { phone, template: 'vh_abandoned_6hr', vars: JSON.stringify([name || 'there', productName, cartUrl]), send_at: new Date(now + 6 * 3600000).toISOString(), type: 'cart', status: 'pending' },
    { phone, template: 'vh_abandoned_24hr', vars: JSON.stringify([name || 'there', productName, cartUrl]), send_at: new Date(now + 24 * 3600000).toISOString(), type: 'cart', status: 'pending' }
  ]);
}

// ═══════════════════════════════════════════════════════════
// WIN-BACK — for customers who haven't ordered in 45+ days
// ═══════════════════════════════════════════════════════════
async function triggerWinbackCampaign() {
  const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86400000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const base = process.env.APP_BASE_URL || 'https://www.vintagehides.in';

  // Customers whose last order was 45-90 days ago
  const { data: customers } = await supabaseAdmin.from('customers')
    .select('name, phone, id')
    .lt('updated_at', fortyFiveDaysAgo)
    .gt('updated_at', ninetyDaysAgo)
    .gt('total_orders', 0)
    .limit(200);

  let queued = 0;
  for (const c of (customers || [])) {
    // Check not already queued for winback
    const { data: ex } = await supabaseAdmin.from('post_purchase_queue')
      .select('id').eq('phone', c.phone).eq('template', 'vh_winback_1').gte('created_at', ninetyDaysAgo).limit(1);
    if (ex?.length) continue;

    await supabaseAdmin.from('post_purchase_queue').insert({
      phone: c.phone, template: 'vh_winback_1',
      vars: JSON.stringify([c.name || 'there', 'WINBACK200', base]),
      send_at: new Date().toISOString(), type: 'winback', status: 'pending'
    });
    queued++;
  }
  return { queued };
}

// ═══════════════════════════════════════════════════════════
// PROCESS QUEUE — called by cron (runs at 2AM + external cron)
// ═══════════════════════════════════════════════════════════
async function processPendingQueue(limit = 100) {
  const { data: pending } = await supabaseAdmin.from('post_purchase_queue')
    .select('*').eq('status', 'pending')
    .lte('send_at', new Date().toISOString())
    .order('send_at', { ascending: true })
    .limit(limit);

  if (!pending?.length) return { processed: 0, sent: 0, failed: 0 };

  let sent = 0, failed = 0;
  for (const item of pending) {
    let vars = [];
    try { vars = JSON.parse(item.vars || '[]'); } catch { vars = []; }

    const result = await dispatchTemplate(item.phone, item.template, vars).catch(e => ({ success: false, error: e.message }));

    await supabaseAdmin.from('post_purchase_queue').update({
      status: result.success ? 'sent' : 'failed',
      processed_at: new Date().toISOString()
    }).eq('id', item.id);

    if (result.success) sent++; else failed++;
  }

  return { processed: pending.length, sent, failed };
}

// ═══════════════════════════════════════════════════════════
// PROCESS AFFILIATE COMMISSIONS — 72-hr hold after delivery
// ═══════════════════════════════════════════════════════════
async function processAffiliateCommissions() {
  const holdPeriod = new Date(Date.now() - 72 * 3600000).toISOString();
  
  // Find commissions that have been holding for > 72 hours
  const { data: holdingCommissions } = await supabaseAdmin.from('affiliate_commissions')
    .select('id, affiliate_id, commission_amount')
    .eq('status', 'holding')
    .lte('updated_at', holdPeriod)
    .limit(100);
    
  if (!holdingCommissions?.length) return { processed: 0 };
  
  let processed = 0;
  for (const comm of holdingCommissions) {
    const { error } = await supabaseAdmin.from('affiliate_commissions')
      .update({ status: 'earned', updated_at: new Date().toISOString() })
      .eq('id', comm.id);
      
    if (!error) {
      const { data: affCur } = await supabaseAdmin.from('affiliates')
        .select('total_earned, available_balance').eq('id', comm.affiliate_id).single();
      if (affCur) {
        await supabaseAdmin.from('affiliates').update({
          total_earned: (affCur.total_earned || 0) + comm.commission_amount,
          available_balance: (affCur.available_balance || 0) + comm.commission_amount
        }).eq('id', comm.affiliate_id);
      }
      processed++;
    }
  }
  return { processed };
}

module.exports = {
  scoreCODRisk,
  triggerPostDeliverySequence,
  sendPreDispatchConfirmation,
  triggerAbandonedCart,
  triggerWinbackCampaign,
  processPendingQueue,
  processAffiliateCommissions
};
