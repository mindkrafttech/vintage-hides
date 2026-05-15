// api/reviews.js
// Handles: fetching and submitting product reviews
require('dotenv').config();
const { supabaseAdmin } = require('../lib/supabase');
const jwt = require('jsonwebtoken');

function getCustomer(req) {
  const auth = req.headers?.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try {
    const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || 'vh_secret_key';
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || '';

  // ─── GET reviews ──────────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    const { productId } = req.query;
    if (!productId) return res.status(400).json({ error: 'productId required' });

    const { data: reviews, error } = await supabaseAdmin.from('reviews')
      .select('*, customers(name)')
      .eq('product_id', productId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch reviews' });

    return res.json({ success: true, reviews });
  }

  // ─── POST review (Logged in only) ─────────────────────────
  if (req.method === 'POST' && action === 'submit') {
    const customer = getCustomer(req);
    if (!customer) return res.status(401).json({ error: 'Please login to submit a review' });

    const { productId, rating, title, body, images } = req.body || {};
    if (!productId || !rating || !body) {
      return res.status(400).json({ error: 'productId, rating, and body are required' });
    }

    const { data: dbCustomer } = await supabaseAdmin.from('customers')
      .select('name')
      .eq('id', customer.id)
      .single();

    const { data, error } = await supabaseAdmin.from('reviews').insert({
      product_id: productId,
      customer_id: customer.id,
      reviewer_name: dbCustomer?.name || 'Verified Buyer',
      rating,
      title,
      body,
      images: images || [], // images is expected to be an array of URLs
      status: 'approved', // Auto-approve for now, can be changed to 'pending' later
      source: 'website'
    }).select().single();

    if (error) {
      console.error('Review insert error:', error);
      return res.status(500).json({ error: 'Failed to submit review' });
    }

    return res.json({ success: true, review: data, message: 'Thank you for your review!' });
  }

  // ─── POST upload (Logged in only) ─────────────────────────
  if (req.method === 'POST' && action === 'upload') {
    const customer = getCustomer(req);
    if (!customer) return res.status(401).json({ error: 'Please login to upload files' });

    const { fileName, fileType } = req.body || {};
    if (!fileName || !fileType) return res.status(400).json({ error: 'fileName and fileType required' });

    const path = `reviews/${customer.id}/${Date.now()}_${fileName}`;
    
    const { data, error } = await supabaseAdmin.storage
      .from('reviews')
      .createSignedUploadUrl(path);

    if (error) {
      console.error('Signed URL error:', error);
      return res.status(500).json({ error: 'Failed to generate upload URL' });
    }

    return res.json({ 
      success: true, 
      uploadUrl: data.signedUrl, 
      publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/reviews/${path}` 
    });
  }

  return res.status(404).json({ error: 'Unknown action' });
};
