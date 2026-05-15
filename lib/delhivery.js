// lib/delhivery.js — Delhivery shipping API helper
const axios = require('axios');

const BASE_URL = process.env.DELHIVERY_BASE_URL || 'https://track.delhivery.com';
const TOKEN = process.env.DELHIVERY_TOKEN;

const headers = {
  'Authorization': `Token ${TOKEN}`,
  'Content-Type': 'application/json'
};

/**
 * Check if a pincode is serviceable by Delhivery
 */
async function checkPincode(pincode) {
  try {
    const res = await axios.get(
      `${BASE_URL}/c/api/pin-codes/json/?filter_codes=${pincode}`,
      { headers }
    );
    const data = res.data?.delivery_codes?.[0]?.postal_code;
    if (!data) return { serviceable: false };
    return {
      serviceable: data.pre_paid === 'Y' || data.cash_on_delivery === 'Y',
      prepaid: data.pre_paid === 'Y',
      cod: data.cash_on_delivery === 'Y',
      city: data.district,
      state: data.state_code,
      deliveryDays: 5
    };
  } catch (e) {
    console.error('Delhivery pincode error:', e.message);
    return { serviceable: true, city: null, state: null, deliveryDays: 5 }; // Fail open
  }
}

/**
 * Create a shipment/waybill
 */
async function createShipment(orderData) {
  const shipmentPayload = {
    format: 'json',
    data: JSON.stringify({
      shipments: [{
        name: orderData.customerName,
        add: orderData.addressLine1,
        add2: orderData.addressLine2 || '',
        city: orderData.city,
        state: orderData.state,
        country: 'India',
        pin: orderData.pincode,
        phone: orderData.phone,
        order: orderData.orderNumber,
        payment_mode: orderData.paymentMethod === 'cod' ? 'COD' : 'Pre-paid',
        cod_amount: orderData.paymentMethod === 'cod' ? orderData.total : 0,
        products_desc: orderData.productDescription,
        hs_code: '',
        seller_tin: '',
        quantity: orderData.quantity || 1,
        total_amount: orderData.total,
        return_pin: orderData.warehousePincode || '400001',
        return_city: 'Mumbai',
        return_phone: orderData.warehousePhone || process.env.WAREHOUSE_PHONE || '9999999999',
        return_name: 'Vintage Hides',
        return_add: orderData.warehouseAddress || 'Vintage Hides Warehouse, Mumbai',
        return_state: 'Maharashtra',
        return_country: 'India',
        shipping_mode: 'Surface',
        address_type: 'home'
      }]
    })
  };

  const res = await axios.post(
    `${BASE_URL}/api/cmu/create.json`,
    new URLSearchParams(shipmentPayload),
    { headers: { 'Authorization': `Token ${TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

/**
 * Track a shipment by AWB
 */
async function trackShipment(awb) {
  try {
    const res = await axios.get(
      `${BASE_URL}/api/v1/packages/json/?waybill=${awb}&verbose=2`,
      { headers }
    );
    return res.data;
  } catch (e) {
    console.error('Delhivery tracking error:', e.message);
    throw e;
  }
}

/**
 * Get tracking URL for customer
 */
function getTrackingUrl(awb) {
  return `https://www.delhivery.com/track/package/${awb}`;
}

module.exports = { checkPincode, createShipment, trackShipment, getTrackingUrl };
