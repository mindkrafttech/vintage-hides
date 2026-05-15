// api/preorder.js — pre-order token payment flow
// FIX: Added Razorpay payment signature verification before creating preorder
require('dotenv').config();
const { supabaseAdmin } = require('../lib/supabase');
const { createOrder, verifyPaymentSignature } = require('../lib/razorpay');
const { sendPreorderConfirmation } = require('../lib/msg91');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query?.action || 'create';
  const tokenAmount = parseInt(process.env.PREORDER_TOKEN_AMOUNT || '199');

  // Step 1: init (create Razorpay order for token)
  if (action === 'init') {
    try {
      const rzpOrder = await createOrder(tokenAmount, `PRE-${Date.now()}`, { type: 'preorder' });
      return res.json({ success: true, orderId: rzpOrder.id, amount: tokenAmount, key: process.env.RAZORPAY_KEY_ID });
    } catch (e) {
      console.error('Preorder init error:', e.message);
      return res.status(500).json({ error: 'Could not init payment' });
    }
  }

  // Step 2: confirm (after payment success)
  const { name, phone, email, variantId, productName, colorName, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
  if (!name || !phone || !variantId) return res.status(400).json({ error: 'Name, phone, and variantId required' });

  // FIX: Verify Razorpay payment signature — was missing, anyone could create a preorder without paying
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature)
    return res.status(400).json({ error: 'Payment verification data missing' });
  if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature))
    return res.status(400).json({ error: 'Payment verification failed. Please contact support.' });

  // Upsert customer
  const { data: ex } = await supabaseAdmin.from('customers').select('id').eq('phone', phone).maybeSingle();
  let customerId;
  if (ex) { customerId = ex.id; }
  else { const { data: nc } = await supabaseAdmin.from('customers').insert({ name, phone, email }).select('id').single(); customerId = nc?.id; }

  const { data: variant } = await supabaseAdmin.from('product_variants').select('price, products(name)').eq('id', variantId).single();
  const totalPrice = variant?.price || 0;
  const orderNumber = `PRE-${Date.now()}`;
  const eta = '15–20 business days';

  const { data: preorder } = await supabaseAdmin.from('preorders').insert({
    order_number: orderNumber, customer_id: customerId, variant_id: variantId,
    product_name: productName || variant?.products?.name, status: 'token_paid',
    token_amount: tokenAmount, total_price: totalPrice, eta,
    razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId
  }).select('id').single();

  await sendPreorderConfirmation(phone, { name, product: productName || variant?.products?.name, tokenAmount, eta, orderId: orderNumber }).catch(() => {});

  return res.status(201).json({ success: true, orderNumber, tokenAmount, totalPrice, eta });
};
