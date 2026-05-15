/**
 * js/api.js — Vintage Hides Frontend API Integration Layer
 * Include in any page: <script src="/js/api.js"></script>
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
    window.location.href = '/account.html';
  }

  // ─── Core fetch helper ────────────────────────────────────
  async function call(method, endpoint, body, useCustomerToken = false) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    // Use customer token for order/account calls, affiliate token for affiliate calls
    const token = useCustomerToken ? getCustomerToken() : (getAffiliateToken() || getCustomerToken());
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(BASE + endpoint, opts);
    return res.json();
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
      window.location.href = `/account.html${returnUrl ? '?return=' + returnUrl : ''}`;
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
      if (btn) { 
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg><span>${label}</span>`;
        btn.href = '/account.html'; 
      }
      if (mobileBtn) { mobileBtn.textContent = label; mobileBtn.href = '/account.html'; }
    } else {
      if (btn) { 
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg><span>Login</span>`;
        btn.href = '/account.html'; 
      }
      if (mobileBtn) { mobileBtn.textContent = 'Login / Sign Up'; mobileBtn.href = '/account.html'; }
    }
  }

  // ─── Pincode ──────────────────────────────────────────────
  async function checkPincode(pin) {
    return call('GET', `/public?action=pincode&pin=${encodeURIComponent(pin)}`);
  }

  // ─── Waitlist ─────────────────────────────────────────────
  async function joinWaitlist(variantId, name, phone, email) {
    return call('POST', '/public?action=waitlist', { variantId, name, phone, email });
  }

  // ─── Products ────────────────────────────────────────────
  async function listProducts() {
    const res = await call('GET', '/public?action=products');
    // API returns { success: true, products: [...] } — extract the array
    return Array.isArray(res) ? res : (res?.products || []);
  }
  async function getProduct(id) {
    return call('GET', `/public?action=product&id=${encodeURIComponent(id)}`);
  }
  async function getProductBySlug(slug) {
    return call('GET', `/public?action=product&slug=${encodeURIComponent(slug)}`);
  }

  // ─── Reviews ─────────────────────────────────────────────
  async function listReviews(productId) {
    return call('GET', `/reviews?action=list&productId=${encodeURIComponent(productId)}`);
  }
  async function submitReview(data) {
    return call('POST', '/reviews?action=submit', data, true);
  }

  async function uploadMedia(file) {
    // 1. Get signed URL
    const { success, uploadUrl, publicUrl, error } = await call('POST', '/reviews?action=upload', {
        fileName: file.name,
        fileType: file.type
    }, true);

    if (!success) throw new Error(error || 'Failed to get upload URL');

    // 2. Upload to signed URL
    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type }
    });

    if (!uploadRes.ok) throw new Error('Failed to upload file to storage');

    return publicUrl;
  }

  // ─── Coupon validation ────────────────────────────────────

  async function validateCoupon(code) {
    if (!code || code.length < 3) return { valid: false, error: 'Invalid code' };
    return { valid: true, code: code.toUpperCase() };
  }

  // ─── Create Razorpay payment order ────────────────────────
  async function createRazorpayOrder(amount, notes) {
    return call('POST', '/orders?action=initpay', { amount, notes }, true);
  }

  // ─── Place full order (post-payment) — requires login ────
  async function placeOrder(payload) {
    const token = getCustomerToken();
    const customer = getCustomer();
    // Attach customer token so backend can link order to account
    return call('POST', '/orders?action=create', { ...payload, customerToken: token, customerId: customer?.id || null }, true);
  }

  // ─── Pre-order ────────────────────────────────────────────
  async function initPreorder(variantId, productName, colorName) {
    return call('POST', '/preorder?action=init', { variantId, productName, colorName }, true);
  }
  async function confirmPreorder(payload) {
    return call('POST', '/preorder?action=create', payload, true);
  }

  // ─── Track order ──────────────────────────────────────────
  async function trackOrder(id) {
    return call('GET', `/public?action=track&id=${encodeURIComponent(id)}`);
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
  async function getAffiliateDashboard() {
    return call('GET', '/affiliate?action=dashboard');
  }
  async function getAffiliateCommissions(page) {
    return call('GET', `/affiliate?action=commissions&page=${page || 1}`);
  }
  async function affiliateWithdraw(amount, method, note) {
    return call('POST', '/affiliate?action=withdraw', { amount, method, note });
  }

  // ─── KYC Verification ───────────────────────────────────────
  async function getKycStatus() {
    return call('GET', '/affiliate/kyc?action=status');
  }
  async function verifyPan(pan) {
    return call('POST', '/affiliate/kyc?action=verify-pan', { pan });
  }
  async function initAadhaar(aadhaar) {
    return call('POST', '/affiliate/kyc?action=init-aadhaar', { aadhaar });
  }
  async function verifyAadhaar(otp) {
    return call('POST', '/affiliate/kyc?action=verify-aadhaar', { otp });
  }
  async function verifyUpi(upiId) {
    return call('POST', '/affiliate/kyc?action=verify-upi', { upiId });
  }
  async function verifyBank(accountNumber, ifsc, name) {
    return call('POST', '/affiliate/kyc?action=verify-bank', { accountNumber, ifsc, name });
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
          resolve({ success: true, razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature });
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

  function trackRef() {
    const ref = getParam('ref');
    const now = Date.now();
    const EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

    if (ref) {
      localStorage.setItem('vh_ref', ref);
      localStorage.setItem('vh_ref_ts', now.toString());
      // Log click once per session to avoid spamming
      if (!sessionStorage.getItem('vh_ref_logged')) {
        fetch(`${BASE}/affiliate?action=click`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referralCode: ref, page: location.pathname })
        }).then(() => sessionStorage.setItem('vh_ref_logged', '1')).catch(() => {});
      }

      // Cleanup URL: remove ref param without refreshing to keep it clean
      const url = new URL(location.href);
      url.searchParams.delete('ref');
      window.history.replaceState({}, '', url.pathname + url.search);
    }

    // Retrieve and check expiry
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
    requireLogin, updateHeaderAccountBtn, uploadMedia,
    // Commerce
    listReviews, submitReview,
    listProducts, getProduct, getProductBySlug, checkPincode, joinWaitlist, validateCoupon,

    createRazorpayOrder, placeOrder,
    initPreorder, confirmPreorder, trackOrder,
    // Affiliate
    affiliateSignup, affiliateRequestOTP, affiliateVerifyOTP,
    getAffiliateDashboard, getAffiliateCommissions, affiliateWithdraw,
    // KYC
    getKycStatus, verifyPan, initAadhaar, verifyAadhaar, verifyUpi, verifyBank,
    // Razorpay
    openRazorpay, loadRazorpaySDK,
    // Utils
    getParam, trackRef, call
  };
})();
