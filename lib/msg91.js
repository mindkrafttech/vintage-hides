// lib/msg91.js — PRODUCTION COMPLETE — All 23 templates
// Authentication templates use MSG91 OTP API (predefined message, MSG91 manages OTP)
// Utility/Marketing templates use WhatsApp Template API (custom body text)
const axios = require('axios');
const { supabaseAdmin } = require('./supabase');

const WA_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/';
const OTP_URL = 'https://api.msg91.com/api/v5/otp';
const OTP_VERIFY_URL = 'https://api.msg91.com/api/v5/otp/verify';
const OTP_RESEND_URL = 'https://api.msg91.com/api/v5/otp/retry';

const HEADERS = () => ({ authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' });

async function sendWhatsApp(phone, tpl, vars = []) {
  const to = phone.startsWith('91') ? phone : `91${phone.replace(/^0/, '')}`;
  const bodyParams = vars.map(v => ({ type: 'text', text: String(v) }));
  let components = [];
  if (bodyParams.length > 0) {
    if (tpl.includes('otp')) {
      components = [
        { type: 'body', parameters: bodyParams },
        { type: 'button', sub_type: 'url', index: '0', parameters: bodyParams }
      ];
    } else {
      components = [{ type: 'body', parameters: bodyParams }];
    }
  }

  const payload = {
    integrated_number: process.env.MSG91_INTEGRATED_NUMBER,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      to, type: 'template',
      template: {
        name: tpl,
        language: { code: 'en' },
        components
      }
    }
  };
  try {
    const r = await axios.post(WA_URL, payload, { headers: HEADERS() });
    await supabaseAdmin.from('whatsapp_logs').insert({
      phone: to, template: tpl, variables: vars, status: 'sent', msg91_id: r.data?.data?.msg_id || null
    });
    return { success: true };
  } catch (e) {
    await supabaseAdmin.from('whatsapp_logs').insert({
      phone: to, template: tpl, variables: vars, status: 'failed', error_message: e?.response?.data?.message || e.message
    });
    return { success: false, error: e.message };
  }
}

// ─── Custom OTP logic via WhatsApp API ────────────────
// Generates a 6-digit OTP, stores it in `whatsapp_logs`, and sends via WhatsApp Cloud API

async function sendOTP(phone, templateName) {
  const to = phone.startsWith('91') ? phone : `91${phone.replace(/^0/, '')}`;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  const res = await sendWhatsApp(phone, templateName, [otp]);
  if (res.success) {
    return { success: true };
  }
  return { success: false, error: res.error || 'Failed to send WhatsApp message' };
}

async function verifyOTP(phone, otp) {
  const to = phone.startsWith('91') ? phone : `91${phone.replace(/^0/, '')}`;
  
  const { data: logs, error } = await supabaseAdmin.from('whatsapp_logs')
    .select('*')
    .eq('phone', to)
    .in('template', [
      process.env.MSG91_TEMPLATE_ACCOUNT_OTP || 'vh_otp_login_1', 
      process.env.MSG91_TEMPLATE_AFFILIATE_OTP || 'vh_affiliate_otp'
    ])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !logs || logs.length === 0) {
    return { success: false, error: 'No OTP requested' };
  }

  const log = logs[0];
  const createdTime = new Date(log.created_at).getTime();
  const now = Date.now();
  
  if (now - createdTime > 10 * 60 * 1000) {
    return { success: false, error: 'OTP has expired (10 mins validity)' };
  }

  if (log.variables && log.variables[0] === otp) {
    return { success: true };
  }
  return { success: false, error: 'Invalid OTP' };
}

async function resendOTP(phone) {
  const to = phone.startsWith('91') ? phone : `91${phone.replace(/^0/, '')}`;
  const { data: logs } = await supabaseAdmin.from('whatsapp_logs')
    .select('template')
    .eq('phone', to)
    .in('template', [
      process.env.MSG91_TEMPLATE_ACCOUNT_OTP || 'vh_otp_login_1', 
      process.env.MSG91_TEMPLATE_AFFILIATE_OTP || 'vh_affiliate_otp'
    ])
    .order('created_at', { ascending: false })
    .limit(1);
    
  const templateName = logs?.[0]?.template || process.env.MSG91_TEMPLATE_ACCOUNT_OTP || 'vh_otp_login_1';
  return sendOTP(phone, templateName);
}

async function sendAccountOTP(phone) {
  return sendOTP(phone, process.env.MSG91_TEMPLATE_ACCOUNT_OTP || 'vh_otp_login_1');
}

async function sendAffiliateOTP(phone) {
  return sendOTP(phone, process.env.MSG91_TEMPLATE_AFFILIATE_OTP || 'vh_affiliate_otp');
}

// ─── ORDER LIFECYCLE ──────────────────────────────────────────
// [UTILITY] vh_order_confirm — {{1}}=name {{2}}=orderNum {{3}}=product {{4}}=amount {{5}}=date {{6}}=url
async function sendOrderConfirmation(phone, { name, orderId, product, amount, deliveryDate, trackingUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_ORDER_CONFIRM || 'vh_order_confirm', [
    name, orderId, product, `Rs.${amount}`, deliveryDate, trackingUrl
  ]);
}

// [UTILITY] vh_order_dispatched — {{1}}=name {{2}}=awb {{3}}=url
async function sendOrderDispatched(phone, { name, awb, trackingUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_DISPATCHED || 'vh_order_dispatched', [
    name, awb, trackingUrl
  ]);
}

// [UTILITY] vh_out_for_delivery — {{1}}=name
async function sendOutForDelivery(phone, { name }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_OFD || 'vh_out_for_delivery', [name]);
}

// [UTILITY] vh_delivered — {{1}}=name
async function sendDelivered(phone, { name }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_DELIVERED || 'vh_delivered', [name]);
}

// [UTILITY] vh_pre_dispatch — {{1}}=name {{2}}=product {{3}}=orderNum
async function sendPreDispatch(phone, { name, product, orderNumber }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_PRE_DISPATCH || 'vh_pre_dispatch', [
    name, product, orderNumber
  ]);
}

// [UTILITY] vh_payment_failed — {{1}}=name {{2}}=orderRef {{3}}=retryUrl
async function sendPaymentFailed(phone, { name, product, retryUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_PAYMENT_FAILED || 'vh_payment_failed', [
    name, product, retryUrl
  ]);
}

// ─── POST-PURCHASE ────────────────────────────────────────────
// [MARKETING] vh_review_request — {{1}}=name {{2}}=product {{3}}=reviewUrl
async function sendReviewRequest(phone, { name, product, reviewLink }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_REVIEW || 'vh_review_request', [
    name, product, reviewLink
  ]);
}

// [MARKETING] vh_care_tips — {{1}}=name {{2}}=product
async function sendCareTips(phone, { name, product }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_CARE_TIPS || 'vh_care_tips', [name, product]);
}

// [MARKETING] vh_upsell_1 — {{1}}=name {{2}}=upsellUrl
async function sendUpsell(phone, { name, upsellUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_UPSELL || 'vh_upsell_1', [name, upsellUrl]);
}

// [MARKETING] vh_repeat_reward — {{1}}=name {{2}}=couponCode {{3}}=shopUrl
async function sendRepeatReward(phone, { name, couponCode, shopUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_REPEAT_REWARD || 'vh_repeat_reward', [
    name, couponCode, shopUrl
  ]);
}

// [MARKETING] vh_winback_1 — {{1}}=name {{2}}=couponCode {{3}}=shopUrl
async function sendWinback(phone, { name, couponCode, shopUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_WINBACK || 'vh_winback_1', [
    name, couponCode, shopUrl
  ]);
}

// ─── WAITLIST ────────────────────────────────────────────────
// [UTILITY] vh_waitlist_confirm — {{1}}=name {{2}}=product
async function sendWaitlistConfirm(phone, { name, product }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_WAITLIST_JOIN || 'vh_waitlist_confirm', [
    name || 'there', product
  ]);
}

// [MARKETING] vh_waitlist_restock — {{1}}=name {{2}}=product {{3}}=code {{4}}=url
async function sendWaitlistRestock(phone, { name, product, discountCode, buyLink }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_WAITLIST || 'vh_waitlist_restock', [
    name || 'there', product, discountCode, buyLink
  ]);
}

// [MARKETING] vh_waitlist_urgent — {{1}}=name {{2}}=product {{3}}=url
async function sendWaitlistUrgent(phone, { name, product, shopUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_WAITLIST_URGENT || 'vh_waitlist_urgent', [
    name || 'there', product, shopUrl
  ]);
}

// [MARKETING] vh_waitlist_last — {{1}}=name {{2}}=product {{3}}=url
async function sendWaitlistLast(phone, { name, product, shopUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_WAITLIST_LAST || 'vh_waitlist_last', [
    name || 'there', product, shopUrl
  ]);
}

// ─── ABANDONED CART ───────────────────────────────────────────
// [MARKETING] vh_abandoned_30min — {{1}}=name {{2}}=product {{3}}=url
async function sendAbandoned30Min(phone, { name, product, cartUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_ABANDONED_30MIN || 'vh_abandoned_30min', [
    name || 'there', product, cartUrl
  ]);
}

// [MARKETING] vh_abandoned_6hr — {{1}}=name {{2}}=product {{3}}=url
async function sendAbandoned6Hr(phone, { name, product, cartUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_ABANDONED_6HR || 'vh_abandoned_6hr', [
    name || 'there', product, cartUrl
  ]);
}

// [MARKETING] vh_abandoned_24hr — {{1}}=name {{2}}=product {{3}}=url
async function sendAbandoned24Hr(phone, { name, product, cartUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_ABANDONED_24HR || 'vh_abandoned_24hr', [
    name || 'there', product, cartUrl
  ]);
}

// ─── AFFILIATE ────────────────────────────────────────────────
// [UTILITY] vh_affiliate_commission — {{1}}=name {{2}}=amount {{3}}=orderId {{4}}=dashUrl
async function sendAffiliateCommission(phone, { name, commission, orderId, dashboardUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_AFFILIATE_COMM || 'vh_affiliate_commission', [
    name, String(commission), orderId, dashboardUrl
  ]);
}

// [UTILITY] vh_affiliate_approved — {{1}}=name {{2}}=code {{3}}=dashUrl
async function sendAffiliateApproved(phone, { name, referralCode, dashboardUrl }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_AFF_APPROVED || 'vh_affiliate_approved', [
    name, referralCode, dashboardUrl
  ]);
}

// ─── PRE-ORDER ────────────────────────────────────────────────
// [UTILITY] vh_preorder_confirm — {{1}}=name {{2}}=product {{3}}=token {{4}}=eta {{5}}=orderId
async function sendPreorderConfirmation(phone, { name, product, tokenAmount, eta, orderId }) {
  return sendWhatsApp(phone, process.env.MSG91_TEMPLATE_PREORDER || 'vh_preorder_confirm', [
    name, product, String(tokenAmount), eta, orderId
  ]);
}

// ─── QUEUE DISPATCHER (used by cron) ──────────────────────────
// Maps template names to their sender functions
const TEMPLATE_DISPATCH = {
  vh_review_request: (phone, vars) => sendReviewRequest(phone, { name: vars[0], product: vars[1], reviewLink: vars[2] }),
  vh_care_tips: (phone, vars) => sendCareTips(phone, { name: vars[0], product: vars[1] }),
  vh_upsell_1: (phone, vars) => sendUpsell(phone, { name: vars[0], upsellUrl: vars[1] }),
  vh_repeat_reward: (phone, vars) => sendRepeatReward(phone, { name: vars[0], couponCode: vars[1], shopUrl: vars[2] }),
  vh_winback_1: (phone, vars) => sendWinback(phone, { name: vars[0], couponCode: vars[1], shopUrl: vars[2] }),
  vh_waitlist_urgent: (phone, vars) => sendWaitlistUrgent(phone, { name: vars[0], product: vars[1], shopUrl: vars[2] }),
  vh_waitlist_last: (phone, vars) => sendWaitlistLast(phone, { name: vars[0], product: vars[1], shopUrl: vars[2] }),
  vh_abandoned_30min: (phone, vars) => sendAbandoned30Min(phone, { name: vars[0], product: vars[1], cartUrl: vars[2] }),
  vh_abandoned_6hr: (phone, vars) => sendAbandoned6Hr(phone, { name: vars[0], product: vars[1], cartUrl: vars[2] }),
  vh_abandoned_24hr: (phone, vars) => sendAbandoned24Hr(phone, { name: vars[0], product: vars[1], cartUrl: vars[2] })
};

async function dispatchTemplate(phone, template, vars) {
  const fn = TEMPLATE_DISPATCH[template];
  if (fn) return fn(phone, vars);
  return sendWhatsApp(phone, template, vars); // fallback
}

module.exports = {
  sendWhatsApp,
  dispatchTemplate,
  // OTP API (Authentication templates — MSG91 manages OTP generation & verification)
  sendOTP, verifyOTP, resendOTP,
  sendAccountOTP, sendAffiliateOTP,
  sendOrderConfirmation, sendOrderDispatched, sendOutForDelivery, sendDelivered,
  sendPreDispatch, sendPaymentFailed,
  sendReviewRequest, sendCareTips, sendUpsell, sendRepeatReward, sendWinback,
  sendWaitlistConfirm, sendWaitlistRestock, sendWaitlistUrgent, sendWaitlistLast,
  sendAbandoned30Min, sendAbandoned6Hr, sendAbandoned24Hr,
  sendAffiliateCommission, sendAffiliateApproved,
  sendPreorderConfirmation
};
