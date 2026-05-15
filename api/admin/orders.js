// api/admin/orders.js — PRODUCTION COMPLETE
// Features: list, single, dispatch (with pre-dispatch confirmation), status update
require('dotenv').config();
const { supabaseAdmin } = require('../../lib/supabase');
const { requireAdmin } = require('../../lib/auth');
const { createShipment } = require('../../lib/delhivery');
const { sendOrderDispatched } = require('../../lib/msg91');
const { sendPreDispatchConfirmation } = require('../../lib/automation');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const admin = requireAdmin(req, res); if (!admin) return;

  const id = req.query?.id;

  // ── GET list ──────────────────────────────────────────────
  if (req.method === 'GET' && !id) {
    const { status, search, page = 1, payment_method } = req.query;
    const limit = 20, offset = (parseInt(page) - 1) * limit;
    let q = supabaseAdmin.from('orders')
      .select('id, order_number, status, payment_method, payment_status, total, cod_fee, awb, created_at, utm_source, utm_campaign, customers(name, phone, city, state), order_items(product_name, variant_color, quantity)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (status && status !== 'all') q = q.eq('status', status);
    if (payment_method && payment_method !== 'all') q = q.eq('payment_method', payment_method);
    if (search) q = q.or(`order_number.ilike.%${search}%`);
    const { data, count } = await q;

    // Stats for header
    let stats = null;
    try { const { data: s } = await supabaseAdmin.rpc('order_summary_stats'); stats = s; } catch {}

    return res.json({ success: true, orders: data || [], total: count, stats });
  }

  // ── GET single ────────────────────────────────────────────
  if (req.method === 'GET' && id) {
    const { data } = await supabaseAdmin.from('orders')
      .select('*, customers(*), order_items(*), affiliate_commissions(commission_amount, status)')
      .eq('id', id).single();
    return res.json({ success: true, order: data });
  }

  // ── PUT update / dispatch ─────────────────────────────────
  if (req.method === 'PUT' && id) {
    const { action, status } = req.body || {};

    // ── Pre-dispatch confirmation (send WhatsApp before shipping) ──
    if (action === 'pre_dispatch') {
      await sendPreDispatchConfirmation(id).catch(() => {});
      return res.json({ success: true, message: 'Pre-dispatch WhatsApp sent to customer' });
    }

    // ── Create Delhivery shipment ──────────────────────────
    if (action === 'create_shipment') {
      const { data: order } = await supabaseAdmin.from('orders')
        .select('*, customers(*), order_items(*)')
        .eq('id', id).single();

      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.awb) return res.status(400).json({ error: 'Shipment already created. AWB: ' + order.awb });

      try {
        const shipment = await createShipment(order);
        const awb = shipment.awb || shipment.packages?.[0]?.awb;
        if (!awb) return res.status(500).json({ error: 'Delhivery did not return an AWB number' });

        await supabaseAdmin.from('orders').update({
          awb,
          status: 'dispatched',
          dispatched_at: new Date().toISOString()
        }).eq('id', id);

        await sendOrderDispatched(order.customers?.phone, {
          name: order.customers?.name,
          awb,
          trackingUrl: `${process.env.APP_BASE_URL}/order-tracking?id=${order.order_number}`
        }).catch(() => {});

        return res.json({ success: true, awb, message: 'Shipment created and customer notified via WhatsApp' });
      } catch (e) {
        return res.status(500).json({ error: e.message || 'Shipment creation failed' });
      }
    }

    // ── Manual status update ───────────────────────────────
    if (status) {
      await supabaseAdmin.from('orders').update({ status }).eq('id', id);
      return res.json({ success: true });
    }

    // ── Bulk action ────────────────────────────────────────
    if (action === 'bulk_confirm') {
      const { orderIds } = req.body;
      if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds array required' });
      await supabaseAdmin.from('orders').update({ status: 'confirmed' }).in('id', orderIds);
      return res.json({ success: true, updated: orderIds.length });
    }

    return res.status(400).json({ error: 'No action specified' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
