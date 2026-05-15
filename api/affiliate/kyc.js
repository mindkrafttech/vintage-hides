// api/affiliate/kyc.js
// KYC verification via Sandbox.co.in API
// Actions: verify-pan, init-aadhaar, verify-aadhaar, verify-upi, verify-bank
require('dotenv').config();
const { supabaseAdmin } = require('../../lib/supabase');
const jwt = require('jsonwebtoken');

const SANDBOX_BASE = 'https://api.sandbox.co.in';
const SANDBOX_KEY  = process.env.SANDBOX_KYC_KEY;    // key_test_...
const SANDBOX_SEC  = process.env.SANDBOX_KYC_SECRET;  // secret_test_...

// ── In-memory token cache (valid 24h) ────────────────────────
let _sbToken = null, _sbTokenExpiry = 0;
async function getSandboxToken() {
  if (_sbToken && Date.now() < _sbTokenExpiry) return _sbToken;
  const r = await fetch(`${SANDBOX_BASE}/authenticate`, {
    method: 'POST',
    headers: {
      'x-api-key': SANDBOX_KEY,
      'x-api-secret': SANDBOX_SEC,
      'x-api-version': '1.0',
      'Content-Type': 'application/json'
    }
  });
  const d = await r.json();
  if (!d.data?.access_token) throw new Error('Sandbox auth failed: ' + JSON.stringify(d));
  _sbToken = d.data.access_token;
  _sbTokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 hours
  return _sbToken;
}

async function sbPost(path, body) {
  const token = await getSandboxToken();
  const r = await fetch(`${SANDBOX_BASE}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': SANDBOX_KEY,
      'authorization': token,
      'x-api-version': '1.0',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function sbGet(path) {
  const token = await getSandboxToken();
  const r = await fetch(`${SANDBOX_BASE}${path}`, {
    method: 'GET',
    headers: {
      'x-api-key': SANDBOX_KEY,
      'authorization': token,
      'x-api-version': '1.0'
    }
  });
  return r.json();
}

// ── Auth helper ───────────────────────────────────────────────
function requireAffiliate(req) {
  const h = req.headers?.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), process.env.AFFILIATE_JWT_SECRET); } catch { return null; }
}

// ── Auto-update KYC status ────────────────────────────────────
async function refreshKycStatus(affiliateId) {
  const { data: aff } = await supabaseAdmin
    .from('affiliates').select('pan_verified,aadhaar_verified,upi_verified,bank_verified,payout_method')
    .eq('id', affiliateId).single();
  if (!aff) return;

  const payoutOk = aff.payout_method === 'bank' ? aff.bank_verified : aff.upi_verified;
  const allVerified = aff.pan_verified && aff.aadhaar_verified && payoutOk;
  const partial = (aff.pan_verified || aff.aadhaar_verified || aff.upi_verified || aff.bank_verified) && !allVerified;

  const update = {
    kyc_status: allVerified ? 'verified' : partial ? 'partial' : 'pending',
    kyc_done: allVerified,
    kyc_verified_at: allVerified ? new Date().toISOString() : null
  };
  await supabaseAdmin.from('affiliates').update(update).eq('id', affiliateId);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = requireAffiliate(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.query?.action || '';

  // ── GET status ────────────────────────────────────────────
  if (req.method === 'GET' && action === 'status') {
    const { data: aff } = await supabaseAdmin
      .from('affiliates')
      .select('kyc_status,kyc_done,pan_verified,pan_name,pan_number,aadhaar_verified,upi_verified,upi_verified_name,upi_id,bank_verified,bank_name,bank_account_number,bank_ifsc,payout_method')
      .eq('id', payload.id).single();
    return res.json({ success: true, kyc: aff });
  }

  // ── POST verify-pan ───────────────────────────────────────
  if (req.method === 'POST' && action === 'verify-pan') {
    const { pan } = req.body || {};
    if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase()))
      return res.status(400).json({ error: 'Invalid PAN format. Example: ABCDE1234F' });

    let sbRes;
    try {
      sbRes = await sbGet(`/pans/${pan.toUpperCase()}/verify?consent=Y&reason=For%20Affiliate%20KYC`);
    } catch (e) {
      return res.status(500).json({ error: 'KYC service unavailable. Please try again.' });
    }

    if (!sbRes?.data || sbRes?.code !== 200) {
      return res.status(400).json({ error: sbRes?.message || 'PAN verification failed. Check the PAN number.' });
    }

    const panName = sbRes.data.full_name || sbRes.data.name_as_per_pan || sbRes.data.name || '';
    await supabaseAdmin.from('affiliates').update({
      pan_number: pan.toUpperCase(),
      pan_name: panName,
      pan_verified: true
    }).eq('id', payload.id);

    await refreshKycStatus(payload.id);
    return res.json({ success: true, name: panName, message: `PAN verified! Name: ${panName}` });
  }

  // ── POST init-aadhaar (send OTP) ──────────────────────────
  if (req.method === 'POST' && action === 'init-aadhaar') {
    const { aadhaar } = req.body || {};
    if (!aadhaar || !/^\d{12}$/.test(aadhaar))
      return res.status(400).json({ error: 'Aadhaar must be 12 digits.' });

    let sbRes;
    try {
      sbRes = await sbPost('/kyc/aadhaar/okyc/otp', { 
        '@entity': 'in.co.sandbox.kyc.aadhaar.okyc.otp.request',
        aadhaar_number: aadhaar,
        consent: 'Y',
        reason: 'For Affiliate KYC Verification'
      });
    } catch (e) {
      return res.status(500).json({ error: 'KYC service unavailable. Please try again.' });
    }

    const refId = sbRes?.data?.ref_id || sbRes?.data?.reference_id;
    if (!refId) {
      return res.status(400).json({ error: sbRes?.message || 'Could not send Aadhaar OTP. Check the number.' });
    }

    await supabaseAdmin.from('affiliates').update({ aadhaar_ref: String(refId) }).eq('id', payload.id);
    return res.json({ success: true, refId, message: 'OTP sent to your Aadhaar-linked mobile number.' });
  }

  // ── POST verify-aadhaar (check OTP) ──────────────────────
  if (req.method === 'POST' && action === 'verify-aadhaar') {
    const { otp } = req.body || {};
    if (!otp) return res.status(400).json({ error: 'OTP required' });

    const { data: aff } = await supabaseAdmin
      .from('affiliates').select('aadhaar_ref').eq('id', payload.id).single();
    if (!aff?.aadhaar_ref)
      return res.status(400).json({ error: 'Please initiate Aadhaar verification first.' });

    let sbRes;
    try {
      sbRes = await sbPost('/kyc/aadhaar/okyc/otp/verify', {
        '@entity': 'in.co.sandbox.kyc.aadhaar.okyc.request',
        reference_id: String(aff.aadhaar_ref),
        otp: String(otp),
        consent: 'Y',
        reason: 'For Affiliate KYC Verification'
      });
    } catch (e) {
      return res.status(500).json({ error: 'KYC service unavailable. Please try again.' });
    }

    if (sbRes?.data?.status !== 'VALID' && sbRes?.data?.aadhaar_number === undefined) {
      return res.status(400).json({ error: sbRes?.message || 'Invalid or expired OTP. Please try again.' });
    }

    await supabaseAdmin.from('affiliates').update({ aadhaar_verified: true }).eq('id', payload.id);
    await refreshKycStatus(payload.id);
    return res.json({ success: true, message: 'Aadhaar verified successfully! ✅' });
  }

  // ── POST verify-upi ───────────────────────────────────────
  if (req.method === 'POST' && action === 'verify-upi') {
    const { upiId } = req.body || {};
    if (!upiId || !upiId.includes('@'))
      return res.status(400).json({ error: 'Invalid UPI ID format. Example: name@upi' });

    let sbRes;
    try {
      sbRes = await sbPost('/bank/upi', { 
        '@entity': 'in.co.sandbox.kyc.upi_verification.request',
        upi_id: upiId,
        consent: 'Y',
        reason: 'For Affiliate KYC Verification'
      });
    } catch (e) {
      return res.status(500).json({ error: 'KYC service unavailable. Please try again.' });
    }

    if (!sbRes?.data || sbRes?.data?.status === 'FAILURE') {
      return res.status(400).json({ error: 'UPI ID not found or invalid. Please check and retry.' });
    }

    const holderName = sbRes.data.name_at_bank || sbRes.data.payee_name || '';
    await supabaseAdmin.from('affiliates').update({
      upi_id: upiId,
      upi_verified: true,
      upi_verified_name: holderName,
      payout_method: 'upi',
      rzp_fund_account_id: null // reset so it gets re-created with new UPI
    }).eq('id', payload.id);

    await refreshKycStatus(payload.id);
    return res.json({ success: true, name: holderName, message: `UPI verified! Account: ${holderName}` });
  }

  // ── POST verify-bank ──────────────────────────────────────
  if (req.method === 'POST' && action === 'verify-bank') {
    const { accountNumber, ifsc, name } = req.body || {};
    if (!accountNumber || !ifsc || !name)
      return res.status(400).json({ error: 'Account number, IFSC, and account holder name are required.' });
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase()))
      return res.status(400).json({ error: 'Invalid IFSC code. Example: SBIN0001234' });

    let sbRes;
    try {
      sbRes = await sbPost('/bank/accounts/verify', {
        '@entity': 'in.co.sandbox.kyc.bank_verification.request',
        bank_account: accountNumber,
        ifsc: ifsc.toUpperCase(),
        name,
        consent: 'Y',
        reason: 'For Affiliate KYC Verification'
      });
    } catch (e) {
      return res.status(500).json({ error: 'KYC service unavailable. Please try again.' });
    }

    const verified = sbRes?.data?.account_status === 'ACTIVE' ||
                     sbRes?.data?.bank_response === 'Transaction Successful';
    if (!verified) {
      return res.status(400).json({ error: sbRes?.message || 'Bank account verification failed. Check details.' });
    }

    const bankName = sbRes.data.full_name || sbRes.data.name_at_bank || name;
    await supabaseAdmin.from('affiliates').update({
      bank_account_number: accountNumber,
      bank_ifsc: ifsc.toUpperCase(),
      bank_name: bankName,
      bank_verified: true,
      payout_method: 'bank',
      rzp_fund_account_id: null // reset for new bank account
    }).eq('id', payload.id);

    await refreshKycStatus(payload.id);
    return res.json({ success: true, name: bankName, message: `Bank account verified! Name: ${bankName}` });
  }

  return res.status(404).json({ error: 'Unknown KYC action' });
};
