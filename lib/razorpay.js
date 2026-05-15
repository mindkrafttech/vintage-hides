// lib/razorpay.js — Razorpay payment + payout helper
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * Create a Razorpay order
 * @param {number} amount - Amount in PAISE (₹3499 = 349900)
 * @param {string} receipt - Unique receipt ID (order number)
 * @param {object} notes - Key-value metadata
 */
async function createOrder(amount, receipt, notes = {}) {
  return razorpay.orders.create({
    amount: amount * 100,  // Convert rupees to paise
    currency: 'INR',
    receipt,
    notes
  });
}

/**
 * Verify Razorpay payment signature
 */
function verifyPaymentSignature(orderId, paymentId, signature) {
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
}

/**
 * Verify Razorpay webhook signature
 */
function verifyWebhookSignature(body, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return expectedSignature === signature;
}

/**
 * Initiate a payout to affiliate's UPI
 * @param {object} params
 * @param {string} params.upiId - Recipient UPI ID
 * @param {string} params.name - Recipient name
 * @param {number} params.amount - Amount in rupees
 * @param {string} params.reference - Reference ID (payout ID)
 */
async function createPayout({ upiId, name, amount, reference }) {
  // Razorpay Payouts API requires a contact + fund account first
  // Step 1: Create contact
  const contact = await razorpay.contacts.create({
    name,
    type: 'vendor',
    reference_id: reference
  });

  // Step 2: Create fund account (UPI)
  const fundAccount = await razorpay.fundAccount.create({
    contact_id: contact.id,
    account_type: 'vpa',
    vpa: { address: upiId }
  });

  // Step 3: Create payout
  const payout = await razorpay.payouts.create({
    account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
    fund_account_id: fundAccount.id,
    amount: amount * 100,  // paise
    currency: 'INR',
    mode: 'UPI',
    purpose: 'payout',
    queue_if_low_balance: true,
    reference_id: reference,
    narration: 'Vintage Hides Affiliate Commission'
  });

  return payout;
}

module.exports = { razorpay, createOrder, verifyPaymentSignature, verifyWebhookSignature, createPayout };
