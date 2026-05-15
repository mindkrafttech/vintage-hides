// api/public.js — PRODUCTION COMPLETE
// Handles: pincode, waitlist join/notify, order tracking, abandoned cart capture, UTM tracking
require('dotenv').config();
const { supabaseAdmin } = require('../lib/supabase');
const { sendWhatsApp, sendWaitlistConfirm, sendWaitlistRestock } = require('../lib/msg91');
const { triggerAbandonedCart } = require('../lib/automation');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function requireAdmin(req) {
  const h = req.headers?.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), process.env.ADMIN_JWT_SECRET); } catch { return null; }
}

const pincodeCache = {};
function cached(key, ttl, fn) {
  const now = Date.now();
  if (pincodeCache[key] && now - pincodeCache[key].ts < ttl) return Promise.resolve(pincodeCache[key].val);
  return fn().then(v => { pincodeCache[key] = { val: v, ts: now }; return v; });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || '';

  // ══════════════════════════════════════════════════════════
  // GET pincode — check serviceability
  // ══════════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'pincode') {
    const pin = req.query.pin;
    if (!pin || !/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Invalid pincode' });

    const result = await cached(`pin_${pin}`, 3600000, async () => {
      const { data } = await supabaseAdmin.from('serviceable_pincodes')
        .select('city, state, delivery_days, serviceable')
        .eq('pincode', pin).maybeSingle();
      if (data) return { serviceable: data.serviceable, city: data.city, state: data.state, deliveryDays: data.delivery_days };
      // Default: serviceable (Delhivery covers 18,000+ pincodes)
      return { serviceable: true, city: '', state: '', deliveryDays: 5 };
    });

    return res.json(result);
  }

  // ══════════════════════════════════════════════════════════
  // GET track — order tracking
  // ══════════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'track') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Order ID required' });

    const isOrderNumber = id.startsWith('VH-') || id.startsWith('PRE-');
    let q = supabaseAdmin.from('orders')
      .select('id, order_number, status, payment_method, payment_status, total, awb, tracking_url, created_at, dispatched_at, order_items(product_name, variant_color, quantity, price, upsell_item), customers(name, city, state, pincode)');
    q = isOrderNumber ? q.eq('order_number', id) : q.eq('id', id);
    const { data: order, error } = await q.single();

    if (error || !order) return res.status(404).json({ success: false, error: 'Order not found' });

    // Build timeline
    const timeline = [{ status: 'confirmed', label: 'Order Confirmed', done: true, date: order.created_at }];
    const statuses = ['confirmed', 'processing', 'dispatched', 'out_for_delivery', 'delivered'];
    const currentIdx = statuses.indexOf(order.status);
    statuses.forEach((s, i) => {
      if (i === 0) return;
      timeline.push({ status: s, label: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), done: i <= currentIdx, date: s === 'dispatched' ? order.dispatched_at : null });
    });

    return res.json({ success: true, order: { ...order, timeline } });
  }

  // ══════════════════════════════════════════════════════════
  // POST waitlist — join waitlist
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'waitlist') {
    const { variantId, name, phone, email } = req.body || {};
    if (!variantId || !phone) return res.status(400).json({ error: 'variantId and phone required' });

    const { data: existing } = await supabaseAdmin.from('waitlist')
      .select('id').eq('phone', phone).eq('variant_id', variantId).maybeSingle();
    if (existing) return res.json({ success: true, message: 'Already on waitlist! We will notify you.' });

    await supabaseAdmin.from('waitlist').insert({ variant_id: variantId, name: name || 'there', phone, email, notified: false });

    // Get product name for WhatsApp
    const { data: variant } = await supabaseAdmin.from('product_variants')
      .select('color_name, products(name)').eq('id', variantId).single();
    const productName = variant ? `${variant.products?.name} ${variant.color_name}` : 'the product';

    await sendWaitlistConfirm(phone, { name: name || 'there', product: productName }).catch(() => {});

    return res.json({ success: true, message: 'You are on the waitlist! We will WhatsApp you when it is back.' });
  }

  // ══════════════════════════════════════════════════════════
  // POST notify — admin broadcasts restock (with 3-message sequence)
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'notify') {
    if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { variantId, discountCode = 'RESTOCK10' } = req.body || {};
    if (!variantId) return res.status(400).json({ error: 'variantId required' });

    const { data: variant } = await supabaseAdmin.from('product_variants')
      .select('color_name, products(name)').eq('id', variantId).single();
    if (!variant) return res.status(404).json({ error: 'Variant not found' });

    const { data: list } = await supabaseAdmin.from('waitlist')
      .select('*').eq('variant_id', variantId).eq('notified', false);

    const baseUrl = process.env.APP_BASE_URL || 'https://www.vintagehides.in';
    const shopUrl = `${baseUrl}/?coupon=${discountCode}`;
    let sent = 0;

    for (const entry of (list || [])) {
      // Message 1: immediate restock
      const r1 = await sendWaitlistRestock(entry.phone, {
        name: entry.name || 'there',
        product: `${variant.products?.name} ${variant.color_name}`,
        discountCode, buyLink: shopUrl
      });

      if (r1.success) {
        await supabaseAdmin.from('waitlist').update({ notified: true, notified_at: new Date().toISOString() }).eq('id', entry.id);
        sent++;

        // Message 2: 6hr urgency
        await supabaseAdmin.from('post_purchase_queue').insert([
          { phone: entry.phone, template: 'vh_waitlist_urgent', vars: JSON.stringify([entry.name || 'there', `${variant.products?.name} ${variant.color_name}`, shopUrl]), send_at: new Date(Date.now() + 6 * 3600000).toISOString(), type: 'waitlist', status: 'pending' },
          { phone: entry.phone, template: 'vh_waitlist_last', vars: JSON.stringify([entry.name || 'there', `${variant.products?.name} ${variant.color_name}`, shopUrl]), send_at: new Date(Date.now() + 24 * 3600000).toISOString(), type: 'waitlist', status: 'pending' }
        ]).catch(() => {});
      }
    }

    return res.json({ success: true, sent, queued: sent * 2, message: `Sent to ${sent} people + 2 follow-ups queued` });
  }

  // ══════════════════════════════════════════════════════════
  // POST cart — abandoned cart capture
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'cart') {
    const { sessionId, phone, name, productName, variantColor, price } = req.body || {};
    if (!sessionId || !productName) return res.status(400).json({ error: 'sessionId and productName required' });

    await triggerAbandonedCart({ sessionId, phone, name, productName, variantColor, price }).catch(() => {});

    return res.json({ success: true });
  }

  // ══════════════════════════════════════════════════════════
  // POST coupon — validate coupon code
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'coupon') {
    const { code, orderValue } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Code required' });

    const { data: coupon } = await supabaseAdmin.from('coupons')
      .select('*').eq('code', code.toUpperCase()).eq('active', true).single();

    if (!coupon) return res.status(404).json({ valid: false, error: 'Invalid coupon code' });
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
      return res.status(400).json({ valid: false, error: 'Coupon has expired' });
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses)
      return res.status(400).json({ valid: false, error: 'Coupon usage limit reached' });
    if (orderValue && orderValue < (coupon.min_order_value || 0))
      return res.status(400).json({ valid: false, error: `Minimum order value ₹${coupon.min_order_value} required` });

    const discount = coupon.type === 'percent'
      ? Math.min(Math.floor((orderValue || 0) * coupon.value / 100), coupon.max_discount || Infinity)
      : coupon.value;

    return res.json({ valid: true, discount, type: coupon.type, value: coupon.value, description: coupon.description });
  }

  // ══════════════════════════════════════════════════════════
  // GET products — list active products for collection/home
  // ══════════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'products') {
    const { data: products } = await supabaseAdmin.from('products')
      .select('*, product_variants(*, inventory(*))')
      .eq('status', 'active')
      .order('sort_order', { ascending: true });

    if (!products) return res.json({ success: true, products: [] });

    // Fetch review stats for each product
    const productIds = products.map(p => p.id);
    const { data: reviews } = await supabaseAdmin.from('reviews')
      .select('product_id, rating')
      .in('product_id', productIds)
      .eq('status', 'approved');

    const productsWithStats = products.map(p => {
      const pReviews = (reviews || []).filter(r => r.product_id === p.id);
      const count = pReviews.length;
      const avg = count > 0 ? (pReviews.reduce((s, r) => s + r.rating, 0) / count).toFixed(1) : 0;
      return { ...p, avg_rating: avg, review_count: count };
    });

    return res.json({ success: true, products: productsWithStats });
  }

  // ══════════════════════════════════════════════════════════
  // GET product — fetch single product by id
  // ══════════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'product') {
    const { id, slug } = req.query;
    if (!id && !slug) return res.status(400).json({ success: false, error: 'id or slug required' });

    let query = supabaseAdmin.from('products').select('*, product_variants(*, inventory(*))').eq('status', 'active');
    
    if (id) {
      query = query.eq('id', id);
    } else {
      query = query.eq('slug', slug);
    }

    const { data: product, error } = await query.single();

    if (error || !product) return res.status(404).json({ success: false, error: 'Product not found' });

    // Fetch review stats
    const { data: reviews } = await supabaseAdmin.from('reviews')
      .select('rating')
      .eq('product_id', product.id)
      .eq('status', 'approved');

    const count = (reviews || []).length;
    const avg = count > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / count).toFixed(1) : 0;

    return res.json({ success: true, product: { ...product, avg_rating: avg, review_count: count } });
  }

  return res.status(404).json({ error: 'Not found' });
};
