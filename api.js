/**
 * js/api.js — Vintage Hides Frontend API Integration Layer
 * Include in any page: <script src="/js/api.js"></script>
 *
 * FIXED:
 *  - checkPincode    → GET  /api/public?action=pincode&pin=...
 *  - joinWaitlist    → POST /api/public?action=waitlist
 *  - validateCoupon  → POST /api/public?action=coupon  (was FAKE, always returned valid)
 *  - createRazorpayOrder → POST /api/orders?action=initpay
 *  - placeOrder      → POST /api/orders?action=create
 *  - initPreorder    → POST /api/preorder?action=init
 *  - confirmPreorder → POST /api/preorder?action=create
 *  - trackOrder      → GET  /api/public?action=track&id=...
 *  - Added: sendCodOTP, verifyCodOTP for COD OTP verification flow
 */

const VH = (() => {
  const BASE = '/api';

  // ─── Token helpers ─────────────────────────────────────────
  function getCustomerToken() { return localStorage.getItem('vh_token'); }
  function getAffiliateToken() { return localStorage.getItem('vh_affiliate_token'); }
  function isLoggedIn() { return !!getCustomerToken(); }
  function getCustomer() {
    try { return JSON.parse(localStorage.getItem('vh_customer') || 'null'); } catch { return null; }
  }
  function logout() {
    localStorage.removeItem('vh_token');
    localStorage.removeItem('vh_customer');
    window.location.href = '/account';
  }

  // ─── Core fetch helper ────────────────────────────────────
  async function call(method, endpoint, body, useCustomerToken = false) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const token = useCustomerToken ? getCustomerToken() : (getAffiliateToken() || getCustomerToken());
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    try {
      const res = await fetch(BASE + endpoint, opts);
      return res.json();
    } catch (err) {
      return { success: false, error: err.message || 'Network error' };
    }
  }

  // ─── Auth: Customer OTP Login ─────────────────────────────
  async function sendOTP(phone) {
    return call('POST', '/account?action=send-otp', { phone });
  }
  async function verifyOTP(phone, otp) {
    const res = await call('POST', '/account?action=verify-otp', { phone, otp });
    if (res.success && res.token) {
      localStorage.setItem('vh_token', res.token);
      localStorage.setItem('vh_customer', JSON.stringify(res.customer));
    }
    return res;
  }
  async function resendOTP(phone) {
    return call('POST', '/account?action=resend-otp', { phone });
  }

  // ─── Account ─────────────────────────────────────────────
  async function getAccount() {
    return call('GET', '/account?action=me', null, true);
  }
  async function updateProfile(data) {
    return call('PUT', '/account?action=profile', data, true);
  }

  // ─── Auth guard — redirect to login if not logged in ─────
  function requireLogin(redirectBack = true) {
    if (!isLoggedIn()) {
      const returnUrl = redirectBack ? encodeURIComponent(location.href) : '';
      window.location.href = `/account${returnUrl ? '?return=' + returnUrl : ''}`;
      return false;
    }
    return true;
  }

  // ─── Update header account button ─────────────────────────
  function updateHeaderAccountBtn() {
    const customer = getCustomer();
    const btn = document.getElementById('header-account-btn');
    const mobileBtn = document.getElementById('mobile-account-btn');
    if (!btn && !mobileBtn) return;

    if (customer) {
      const label = customer.name ? `Hi, ${customer.name.split(' ')[0]}` : 'My Account';
      if (btn) { btn.textContent = label; btn.href = '/account'; }
      if (mobileBtn) { mobileBtn.textContent = label; mobileBtn.href = '/account'; }
    } else {
      if (btn) { btn.textContent = 'Login'; btn.href = '/account'; }
      if (mobileBtn) { mobileBtn.textContent = 'Login / Sign Up'; mobileBtn.href = '/account'; }
    }
  }

  // ─── Pincode check ────────────────────────────────────────
  // FIX: was GET /api/pincode/${pin} — no such route exists
  async function checkPincode(pin) {
    return call('GET', `/public?action=pincode&pin=${encodeURIComponent(pin)}`);
  }

  // ─── Waitlist ─────────────────────────────────────────────
  // FIX: was POST /api/waitlist/join — no such route exists
  async function joinWaitlist(variantId, name, phone, email) {
    return call('POST', '/public?action=waitlist', { variantId, name, phone, email });
  }

  // ─── Coupon validation ────────────────────────────────────
  // FIX: was fake stub — always returned { valid: true } for any code >= 3 chars
  async function validateCoupon(code, orderValue) {
    if (!code || code.length < 3) return { valid: false, error: 'Invalid code' };
    return call('POST', '/public?action=coupon', { code: code.toUpperCase(), orderValue: orderValue || 0 });
  }

  // ─── Create Razorpay payment order ────────────────────────
  // FIX: was POST /api/orders/initpay — route exists but path was wrong (vercel matched but action wasn't set)
  async function createRazorpayOrder(amount, notes) {
    return call('POST', '/orders?action=initpay', { amount, notes }, true);
  }

  // ─── Place full order (post-payment) ─────────────────────
  // FIX: was POST /api/orders/create — wrong path, action never reached
  async function placeOrder(payload) {
    const customer = getCustomer();
    return call('POST', '/orders?action=create', {
      ...payload,
      customerId: customer?.id || null
    }, true);
  }

  // ─── COD OTP — send OTP before placing COD order ─────────
  // NEW: required for COD identity verification
  async function sendCodOTP(phone) {
    return call('POST', '/orders?action=send-cod-otp', { phone });
  }

  // ─── COD OTP — verify OTP; returns codToken used in placeOrder ─
  // NEW: codToken must be passed as payload.codToken when calling placeOrder for COD
  async function verifyCodOTP(phone, otp) {
    return call('POST', '/orders?action=verify-cod-otp', { phone, otp });
  }

  // ─── Pre-order ────────────────────────────────────────────
  // FIX: was POST /api/preorder/create?step=init — wrong path + wrong action key
  async function initPreorder(variantId, productName, colorName) {
    return call('POST', '/preorder?action=init', { variantId, productName, colorName }, true);
  }
  // FIX: was POST /api/preorder/create — wrong path
  async function confirmPreorder(payload) {
    return call('POST', '/preorder?action=create', payload, true);
  }

  // ─── Track order ──────────────────────────────────────────
  // FIX: was GET /api/orders/${id} — orders.js has no GET handler; tracking is in public.js
  async function trackOrder(id) {
    return call('GET', `/public?action=track&id=${encodeURIComponent(id)}`);
  }

  // ─── Products (public catalog) ──────────────────────────
  async function listProducts() {
    const res = await call('GET', '/public?action=products');
    // Returns { success: true, products: [...] } — extract the array
    return Array.isArray(res) ? res : (res?.products || []);
  }

  async function getProductBySlug(slug) {
    return call('GET', `/public?action=product&slug=${encodeURIComponent(slug)}`);
  }

  async function getProductById(id) {
    return call('GET', `/public?action=product&id=${encodeURIComponent(id)}`);
  }

  // ─── Affiliate ────────────────────────────────────────────
  async function affiliateSignup(payload) {
    return call('POST', '/affiliate?action=signup', payload);
  }
  async function affiliateRequestOTP(phone) {
    return call('POST', '/affiliate?action=signin', { phone });
  }
  async function affiliateVerifyOTP(phone, otp) {
    const res = await call('POST', '/affiliate?action=signin', { phone, otp });
    if (res.success && res.token) localStorage.setItem('vh_affiliate_token', res.token);
    return res;
  }
  async function affiliateResendOTP(phone) {
    return call('POST', '/affiliate?action=resend-otp', { phone });
  }
  async function getAffiliateDashboard() {
    return call('GET', '/affiliate?action=dashboard');
  }
  async function getAffiliateCommissions(page) {
    return call('GET', `/affiliate?action=commissions&page=${page || 1}`);
  }
  async function affiliateWithdraw(amount, upiId, note) {
    return call('POST', '/affiliate?action=withdraw', { amount, upiId, note });
  }
  async function affiliateUpdateUpi(upiId) {
    return call('PUT', '/affiliate?action=update-upi', { upiId });
  }

  // ─── Razorpay SDK loader ──────────────────────────────────
  function loadRazorpaySDK() {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ─── Open Razorpay checkout ───────────────────────────────
  async function openRazorpay({ orderId, amount, name, phone, email, description, onSuccess, onFailure }) {
    await loadRazorpaySDK();
    return new Promise((resolve) => {
      const options = {
        key: window.VH_CONFIG?.razorpayKey || '',
        amount: amount * 100, currency: 'INR',
        name: 'Vintage Hides', description: description || 'Order Payment',
        order_id: orderId,
        prefill: { name, contact: `+91${phone}`, email: email || '' },
        theme: { color: '#1A3626' },
        modal: { backdropclose: false },
        handler: (response) => {
          const result = {
            success: true,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature
          };
          resolve(result);
          if (onSuccess) onSuccess(response);
        }
      };
      const rzp = new Razorpay(options);
      rzp.on('payment.failed', (resp) => {
        resolve({ success: false, error: resp.error.description });
        if (onFailure) onFailure(resp);
      });
      rzp.open();
    });
  }

  // ─── URL param helpers ────────────────────────────────────
  function getParam(key) {
    return new URLSearchParams(location.search).get(key);
  }

  // ─── Ref code tracker ─────────────────────────────────────
  function trackRef() {
    const ref = getParam('ref');
    const now = Date.now();
    const EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

    if (ref) {
      localStorage.setItem('vh_ref', ref);
      localStorage.setItem('vh_ref_ts', now.toString());
      // Log click once per session
      if (!sessionStorage.getItem('vh_ref_logged')) {
        fetch(`${BASE}/affiliate?action=click`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referralCode: ref, page: location.pathname })
        }).then(() => sessionStorage.setItem('vh_ref_logged', '1')).catch(() => {});
      }

      // Cleanup URL
      const url = new URL(location.href);
      url.searchParams.delete('ref');
      window.history.replaceState({}, '', url.pathname + url.search);
    }

    const savedRef = localStorage.getItem('vh_ref');
    const savedTs  = localStorage.getItem('vh_ref_ts');
    if (savedRef && savedTs) {
      if (now - parseInt(savedTs) > EXPIRY) {
        localStorage.removeItem('vh_ref');
        localStorage.removeItem('vh_ref_ts');
        return null;
      }
      return savedRef;
    }
    return null;
  }

  // ─── Auto-run: update header + track ref on page load ─────
  document.addEventListener('DOMContentLoaded', () => {
    updateHeaderAccountBtn();
    trackRef();
  });

  return {
    // Auth
    sendOTP, verifyOTP, resendOTP,
    getAccount, updateProfile,
    isLoggedIn, getCustomer, getCustomerToken, logout,
    requireLogin, updateHeaderAccountBtn,
    // Commerce
    checkPincode, joinWaitlist, validateCoupon,
    createRazorpayOrder, placeOrder,
    sendCodOTP, verifyCodOTP,
    initPreorder, confirmPreorder, trackOrder,
    // Affiliate
    affiliateSignup, affiliateRequestOTP, affiliateVerifyOTP, affiliateResendOTP,
    getAffiliateDashboard, getAffiliateCommissions, affiliateWithdraw, affiliateUpdateUpi,
    // Razorpay
    openRazorpay, loadRazorpaySDK,
    // Products
    listProducts, getProductBySlug, getProductById,
    // Utils
    getParam, trackRef, call
  };
})();
