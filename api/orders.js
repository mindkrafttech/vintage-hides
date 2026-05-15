// api/orders.js — PRODUCTION COMPLETE
// Features: initpay, create (with COD risk + UTM), webhook (delivery trigger + payment failure)
require('dotenv').config();
const { supabaseAdmin } = require('../lib/supabase');
const { createOrder: rzpCreateOrder, verifyPaymentSignature } = require('../lib/razorpay');
const { sendOrderConfirmation, sendPaymentFailed, sendDelivered } = require('../lib/msg91');
const { scoreCODRisk, triggerPostDeliverySequence } = require('../lib/automation');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || '';

  // ══════════════════════════════════════════════════════════
  // POST initpay — create Razorpay order
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'initpay') {
    const { amount, notes } = req.body || {};
    if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });
    try {
      const order = await rzpCreateOrder(amount, `VH-${Date.now()}`, notes || {});
      return res.json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to create payment order' });
    }
  }

  // ══════════════════════════════════════════════════════════
  // POST webhook — Razorpay + Delhivery events
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'webhook') {
    // ── Razorpay webhook ────────────────────────────────────
    if (req.headers['x-razorpay-signature']) {
      const sig = req.headers['x-razorpay-signature'];
      const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) return res.status(400).json({ error: 'Invalid signature' });

      const event = req.body?.event;
      const payment = req.body?.payload?.payment?.entity;

      if (event === 'payment.captured' && payment?.order_id) {
        await supabaseAdmin.from('orders')
          .update({ payment_status: 'paid', razorpay_payment_id: payment.id })
          .eq('razorpay_order_id', payment.order_id);
      }

      if (event === 'payment.failed' && payment) {
        // Get order + customer to send recovery WhatsApp
        const { data: order } = await supabaseAdmin.from('orders')
          .select('*, customers(name, phone)')
          .eq('razorpay_order_id', payment.order_id)
          .single();

        if (order?.customers?.phone) {
          const retryUrl = `${process.env.APP_BASE_URL}/products/ryza-core?retry=${order.order_number}`;
          await sendPaymentFailed(order.customers.phone, {
            name: order.customers.name,
            product: order.order_number,
            retryUrl
          });
          await supabaseAdmin.from('orders').update({ payment_status: 'failed' }).eq('id', order.id);
        }
      }

      return res.json({ success: true });
    }

    // ── Delhivery webhook ────────────────────────────────────
    if (req.body?.waybill || req.body?.packages) {
      const packages = req.body.packages || [{ waybill: req.body.waybill, status: req.body.status }];

      for (const pkg of packages) {
        const { waybill, status } = pkg;
        const statusMap = {
          'DL': 'delivered',
          'OFD': 'out_for_delivery',
          'INTRANSIT': 'dispatched',
          'RTD': 'returned',
          'RTO': 'returned',
          'LOST': 'cancelled'
        };
        const newStatus = statusMap[status];
        if (!newStatus || !waybill) continue;

        await supabaseAdmin.from('orders').update({ status: newStatus }).eq('awb', waybill);

        // On delivery → send confirmation + trigger post-purchase sequence
        if (newStatus === 'delivered') {
          const { data: order } = await supabaseAdmin.from('orders')
            .select('id, order_number, customers(name, phone)')
            .eq('awb', waybill).single();

          if (order?.customers?.phone) {
            await sendDelivered(order.customers.phone, { name: order.customers.name });
            await triggerPostDeliverySequence(order.id);

            // Update pincode RTO stats
            const { data: custData } = await supabaseAdmin.from('orders')
              .select('customers(pincode)').eq('id', order.id).single();
            const pincode = custData?.customers?.pincode;
            if (pincode) {
              await supabaseAdmin.rpc('increment_pincode_stat', { p_pincode: pincode, p_rto: false });
            }
          }

          // Convert pending affiliate commission to holding upon delivery (72-hr wait)
          if (order) {
            const { data: commission } = await supabaseAdmin.from('affiliate_commissions')
              .select('id, affiliate_id, commission_amount')
              .eq('order_id', order.id)
              .eq('status', 'pending')
              .maybeSingle();

            if (commission) {
              await supabaseAdmin.from('affiliate_commissions')
                .update({ status: 'holding', updated_at: new Date().toISOString() })
                .eq('id', commission.id);
            }
          }
        }

        if (newStatus === 'returned') {
          const { data: order } = await supabaseAdmin.from('orders')
            .select('id, customers(pincode)').eq('awb', waybill).single();
          const pincode = order?.customers?.pincode;
          if (pincode) {
            await supabaseAdmin.rpc('increment_pincode_stat', { p_pincode: pincode, p_rto: true });
          }
          if (order) {
            await supabaseAdmin.from('affiliate_commissions')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() })
              .eq('order_id', order.id)
              .in('status', ['pending', 'holding']);
          }
        }
      }

      return res.json({ success: true });
    }

    return res.json({ received: true });
  }

  // ══════════════════════════════════════════════════════════
  // POST create — full order placement with COD risk + UTM
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'create') {
    try {
    const {
      name, phone, email, addressLine1, addressLine2, city, state, pincode,
      paymentMethod, productId, variantId, quantity = 1,
      couponCode, affiliateCode, addGiftBox = false,
      razorpayOrderId, razorpayPaymentId, razorpaySignature,
      // UTM tracking
      utmSource, utmMedium, utmCampaign, utmContent,
      // Session (for cart recovery marking)
      sessionId
    } = req.body || {};

    if (!name || !phone || !addressLine1 || !city || !state || !pincode)
      return res.status(400).json({ error: 'Customer details required' });
    if (!productId || !variantId)
      return res.status(400).json({ error: 'Product details required' });
    if (!['prepaid', 'partial', 'cod'].includes(paymentMethod))
      return res.status(400).json({ error: 'Invalid payment method' });

    // ── Verify Razorpay signature for paid orders ─────────
    if (paymentMethod !== 'cod') {
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature)
        return res.status(400).json({ error: 'Payment verification data missing' });
      if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature))
        return res.status(400).json({ error: 'Payment verification failed. Please try again.' });
    }

    // ── COD Risk Scoring ──────────────────────────────────
    if (paymentMethod === 'cod') {
      const { data: existingCustomer } = await supabaseAdmin
        .from('customers').select('id').eq('phone', phone).maybeSingle();

      const riskResult = await scoreCODRisk({
        phone, pincode,
        total: 3499, // estimate — we'll recalc after variant fetch
        isNewCustomer: !existingCustomer
      }).catch(() => ({ score: 0, action: 'allow' }));

      if (riskResult.action === 'block') {
        return res.status(400).json({
          error: 'COD is not available for your location due to high return rates. Please choose Prepaid and get 10% OFF with code RYZA10.',
          codBlocked: true,
          reason: riskResult.reason
        });
      }

      // Log high-risk but allow
      if (riskResult.score >= 30) {
        await supabaseAdmin.from('cod_risk_log').insert({
          phone, pincode, score: riskResult.score, reason: riskResult.reason
        });
      }
    }

    // ── Fetch variant + product ───────────────────────────
    const { data: variant } = await supabaseAdmin
      .from('product_variants')
      .select('*, products(*), inventory(*)')
      .eq('id', variantId).single();

    if (!variant) return res.status(404).json({ error: 'Product not found' });

    const stock = Array.isArray(variant.inventory) 
      ? (variant.inventory[0]?.quantity || 0) 
      : (variant.inventory?.quantity || 0);
    if (stock < quantity) return res.status(400).json({ error: 'Insufficient stock', available: stock });

    // ── Pricing ───────────────────────────────────────────
    const basePrice = variant.price;
    const codFee = paymentMethod === 'cod' ? 99 : 0;
    const upsellAmount = addGiftBox ? 399 : 0;
    let discount = 0, appliedCoupon = null;

    if (couponCode) {
      const { data: coupon } = await supabaseAdmin.from('coupons')
        .select('*').eq('code', couponCode.toUpperCase()).eq('active', true).single();
      if (coupon &&
        !(coupon.expires_at && new Date(coupon.expires_at) < new Date()) &&
        !(coupon.max_uses && coupon.used_count >= coupon.max_uses) &&
        basePrice >= (coupon.min_order_value || 0)) {
        discount = coupon.type === 'percent'
          ? Math.min(Math.floor(basePrice * coupon.value / 100), coupon.max_discount || Infinity)
          : coupon.value;
        appliedCoupon = coupon;
      }
    }

    const subtotal = basePrice * quantity;
    const total = subtotal - discount + codFee + upsellAmount;

    // ── Upsert customer ───────────────────────────────────
    let customer;
    const { data: ex } = await supabaseAdmin.from('customers')
      .select('id').eq('phone', phone).maybeSingle();
    if (ex) {
      customer = ex;
      await supabaseAdmin.from('customers').update({
        name, email, address_line1: addressLine1, address_line2: addressLine2,
        city, state, pincode
      }).eq('id', ex.id);
    } else {
      const { data: nc } = await supabaseAdmin.from('customers')
        .insert({ name, phone, email, address_line1: addressLine1, address_line2: addressLine2, city, state, pincode })
        .select('id').single();
      customer = nc;
    }

    // ── Affiliate lookup ──────────────────────────────────
    let affiliateId = null, affiliateRate = 10;
    if (affiliateCode) {
      const { data: aff, error: affErr } = await supabaseAdmin.from('affiliates')
        .select('id, commission_rate, status').eq('referral_code', affiliateCode.toLowerCase()).single();
      
      if (affErr) {
        console.warn(`[orders] Affiliate lookup failed for code: ${affiliateCode}`, affErr.message);
      } else if (aff) {
        if (aff.status === 'approved') {
          affiliateId = aff.id;
          affiliateRate = aff.commission_rate || 10;
          console.log(`[orders] Affiliate attribution: ${affiliateCode} (ID: ${affiliateId})`);
        } else {
          console.warn(`[orders] Affiliate ${affiliateCode} found but status is ${aff.status}`);
        }
      }
    }

    // ── Generate order number ─────────────────────────────
    let orderNumber;
    try {
      const { data: onData } = await supabaseAdmin.rpc('generate_order_number');
      orderNumber = onData || `VH-${Date.now()}`;
    } catch {
      orderNumber = `VH-${Date.now()}`;
    }

    // ── Create order (with UTM + risk score) ─────────────
    const { data: order, error: oErr } = await supabaseAdmin.from('orders').insert({
      order_number: orderNumber,
      customer_id: customer.id,
      affiliate_id: affiliateId,
      status: 'confirmed',
      payment_method: paymentMethod,
      payment_status: paymentMethod === 'cod' ? 'pending' : (paymentMethod === 'partial' ? 'partial' : 'paid'),
      razorpay_order_id: razorpayOrderId || null,
      razorpay_payment_id: razorpayPaymentId || null,
      subtotal, discount, upsell_amount: upsellAmount, cod_fee: codFee, total,
      coupon_code: couponCode || null,
      utm_source: utmSource || null,
      utm_medium: utmMedium || null,
      utm_campaign: utmCampaign || null,
      utm_content: utmContent || null,
      ip_address: req.headers['x-forwarded-for'] || ''
    }).select('id').single();

    if (oErr) return res.status(500).json({ error: 'Failed to create order' });

    // ── Order items ───────────────────────────────────────
    await supabaseAdmin.from('order_items').insert({
      order_id: order.id, product_id: productId, variant_id: variantId,
      product_name: variant.products.name, variant_color: variant.color_name,
      sku: variant.sku, quantity, price: basePrice
    });
    if (addGiftBox) {
      await supabaseAdmin.from('order_items').insert({
        order_id: order.id, product_id: productId, variant_id: variantId,
        product_name: 'Premium Gift Box (Keychain + Perfume)', sku: 'GIFT-BOX-001',
        quantity: 1, price: 399, upsell_item: true
      });
    }

    // ── Inventory + coupon ────────────────────────────────
    try {
      await supabaseAdmin.rpc('decrement_inventory', { p_variant_id: variantId, p_quantity: quantity });
    } catch (invErr) {
      console.error('[orders] decrement_inventory rpc failed, using fallback:', invErr.message);
      const { data: inv } = await supabaseAdmin.from('inventory').select('id, quantity').eq('variant_id', variantId).maybeSingle();
      if (inv) await supabaseAdmin.from('inventory').update({ quantity: Math.max(0, inv.quantity - quantity) }).eq('id', inv.id);
    }
    if (appliedCoupon) {
      await supabaseAdmin.from('coupons').update({ used_count: appliedCoupon.used_count + 1 }).eq('id', appliedCoupon.id);
    }

    // ── Affiliate commission (Pending until delivery) ─────
    if (affiliateId) {
      try {
        const commissionableAmount = subtotal - discount;
        const comm = Math.floor(commissionableAmount * affiliateRate / 100);
        const { error: commErr } = await supabaseAdmin.from('affiliate_commissions').insert({
          affiliate_id: affiliateId, order_id: order.id,
          order_amount: total, commission_rate: affiliateRate, commission_amount: comm,
          status: 'pending'
        });
        
        if (commErr) {
          console.error(`[orders] Failed to insert commission for affiliate ${affiliateId}:`, commErr.message);
        } else {
          const { data: affCur } = await supabaseAdmin.from('affiliates').select('total_orders').eq('id', affiliateId).single();
          await supabaseAdmin.from('affiliates').update({
            total_orders: (affCur?.total_orders || 0) + 1
          }).eq('id', affiliateId);
          console.log(`[orders] Commission created for affiliate ${affiliateId}`);
        }
      } catch (err) {
        console.error('[orders] Commission logic error:', err.message);
      }
    }

    // ── Mark abandoned cart as recovered ─────────────────
    if (sessionId) {
      await supabaseAdmin.from('abandoned_carts').update({ recovered: true }).eq('session_id', sessionId);
      await supabaseAdmin.from('post_purchase_queue')
        .update({ status: 'skipped' })
        .eq('type', 'cart')
        .in('phone', [phone])
        .eq('status', 'pending')
        ;
    }

    // ── WhatsApp confirmation ─────────────────────────────
    try {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + 5);
      await sendOrderConfirmation(phone, {
        name, orderId: orderNumber,
        product: `${variant.products.name} (${variant.color_name})`,
        amount: total,
        deliveryDate: deliveryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        trackingUrl: `${process.env.APP_BASE_URL}/order-tracking?id=${orderNumber}`
      });
    } catch (waErr) {
      console.error('[orders] WhatsApp send failed (non-fatal):', waErr.message);
    }

    return res.status(201).json({
      success: true,
      orderId: order.id,
      orderNumber,
      total,
      paymentMethod,
      message: 'Order placed! WhatsApp confirmation on its way.'
    });

    } catch (err) {
      console.error('[orders/create] Unhandled error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    }
  }

  return res.status(404).json({ error: 'Unknown action' });
};
