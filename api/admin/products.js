// api/admin/products.js — product CRUD + image upload (merged)
require('dotenv').config();
const { supabaseAdmin } = require('../../lib/supabase');
const { requireAdmin } = require('../../lib/auth');
const formidable = require('formidable');
const fs = require('fs');

// Vercel: disable body parser so formidable can handle multipart
module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Upload handler (multipart) ────────────────────────────
  const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');
  if (isMultipart && req.method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const form = formidable({ keepExtensions: true });
    try {
      const [, files] = await form.parse(req);
      let fileArray = Array.isArray(files.file) ? files.file : (files.file ? [files.file] : []);
      if (fileArray.length === 0) return res.status(400).json({ error: 'No file uploaded' });
      const uploadedUrls = [];
      for (const file of fileArray) {
        try {
          const fileContent = fs.readFileSync(file.filepath);
          const originalName = file.originalFilename || 'image.jpg';
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${originalName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          const filePath = `variants/${fileName}`;
          const { error } = await supabaseAdmin.storage.from('product-images').upload(filePath, fileContent, { contentType: file.mimetype, upsert: false });
          if (error) { console.error('Supabase upload error:', error); continue; }
          const { data: pub } = supabaseAdmin.storage.from('product-images').getPublicUrl(filePath);
          if (pub?.publicUrl) uploadedUrls.push(pub.publicUrl);
        } catch (e) { console.error('File processing error:', e); }
      }
      return res.json({ success: true, urls: uploadedUrls });
    } catch (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Failed to parse form data' });
    }
  }

  // ── Parse JSON body for non-multipart requests ────────────
  if (req.method !== 'GET' && req.method !== 'DELETE' && !isMultipart) {
    await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try { req.body = JSON.parse(data || '{}'); } catch { req.body = {}; }
        resolve();
      });
    });
  }

  const admin = requireAdmin(req, res); if (!admin) return;
  
  // Extract ID from path if not in query (for /api/admin/products/[id])
  let id = req.query?.id;
  if (!id) {
    const parts = req.url.split('?')[0].split('/');
    const lastPart = parts[parts.length - 1];
    // Check if lastPart is a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lastPart)) {
      id = lastPart;
    }
  }
  const action = req.query?.action;

  // ── GET list ──────────────────────────────────────────────
  if (req.method === 'GET' && !id) {
    const { search, status, page = 1 } = req.query;
    const limit = 20, offset = (parseInt(page) - 1) * limit;
    let q = supabaseAdmin.from('products').select('*, product_variants(*, inventory(*))', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (status) q = q.eq('status', status);
    if (search) q = q.ilike('name', `%${search}%`);
    const { data, count } = await q;
    return res.json({ success: true, products: data || [], total: count });
  }

  // ── GET single ────────────────────────────────────────────
  if (req.method === 'GET' && id) {
    const { data } = await supabaseAdmin.from('products').select('*, product_variants(*, inventory(*)), reviews(*)').eq('id', id).single();
    return res.json({ success: true, product: data });
  }

  // ── POST create product ───────────────────────────────────
  if (req.method === 'POST') {
    const { 
      name, slug, tagline, description, story, careInstructions, dimensions, weight_grams, material, 
      active, badge, sort_order, is_featured, is_popular, variants,
      series_code, model_code
    } = req.body || {};
    
    if (action === 'image') {
      const { variantId, url, type = 'main' } = req.body || {};
      const { data: variant } = await supabaseAdmin.from('product_variants').select('images').eq('id', variantId).single();
      const images = variant?.images || [];
      images.push(url);
      await supabaseAdmin.from('product_variants').update({ images }).eq('id', variantId);
      await supabaseAdmin.from('product_images').insert({ product_id: id, variant_id: variantId, url, type });
      return res.json({ success: true });
    }

    if (!name) return res.status(400).json({ error: 'Product name required' });
    const status = active ? 'active' : 'draft';
    const { data: product, error } = await supabaseAdmin.from('products').insert({ 
      name, slug, tagline, description, story, care_instructions: careInstructions, 
      dimensions, weight: weight_grams, material, status, badge, sort_order, 
      is_featured, is_popular, series_code, model_code 
    }).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    if (variants?.length) {
      for (const v of variants) {
        const sku = v.sku || `${name.slice(0, 3).toUpperCase()}-${v.colorName?.slice(0, 3).toUpperCase()}-${Date.now()}`;
        const { data: variant } = await supabaseAdmin.from('product_variants').insert({ 
          product_id: product.id, color_name: v.colorName, color_hex: v.colorHex, sku, 
          price: v.price, compare_price: v.comparePrice, images: v.images || [],
          edition_name: v.editionName, edition_code: v.editionCode, color_code: v.colorCode,
          batch_no: v.batchNo, mfg_date: v.mfgDate, leather_type: v.leatherType,
          hardware: v.hardware, branding_method: v.brandingMethod, qc_status: v.qcStatus
        }).select('id').single();
        if (variant) await supabaseAdmin.from('inventory').insert({ variant_id: variant.id, quantity: v.stock || 0, reserved_quantity: 0, low_stock_threshold: 5 });
      }
    }
    return res.status(201).json({ success: true, productId: product.id });
  }

  // ── PUT update ────────────────────────────────────────────
  if (req.method === 'PUT' && id) {
    if (action === 'inventory') {
      const { variantId, quantity } = req.body || {};
      await supabaseAdmin.from('inventory').update({ quantity }).eq('variant_id', variantId);
      return res.json({ success: true });
    }
    if (action === 'status') {
      const { status } = req.body || {};
      await supabaseAdmin.from('products').update({ status }).eq('id', id);
      return res.json({ success: true });
    }
    if (action === 'variant') {
      const { 
        colorName, colorHex, sku, price, mrp, initialStock,
        editionName, editionCode, colorCode, batchNo, mfgDate, leatherType,
        hardware, brandingMethod, qcStatus
      } = req.body || {};
      const { data: variant, error } = await supabaseAdmin.from('product_variants').insert({ 
        product_id: id, color_name: colorName, color_hex: colorHex, sku, 
        price, compare_price: mrp,
        edition_name: editionName, edition_code: editionCode, color_code: colorCode,
        batch_no: batchNo, mfg_date: mfgDate, leather_type: leatherType,
        hardware: hardware, branding_method: brandingMethod, qc_status: qcStatus
      }).select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      await supabaseAdmin.from('inventory').insert({ variant_id: variant.id, quantity: initialStock || 0 });
      return res.json({ success: true, variantId: variant.id });
    }
    const { 
      name, slug, tagline, description, story, careInstructions, dimensions, weight_grams, material, 
      active, badge, sort_order, is_featured, is_popular, series_code, model_code
    } = req.body || {};
    const u = {};
    if (name) u.name = name; if (slug !== undefined) u.slug = slug; if (tagline !== undefined) u.tagline = tagline;
    if (description !== undefined) u.description = description; if (story !== undefined) u.story = story;
    if (careInstructions !== undefined) u.care_instructions = careInstructions;
    if (dimensions !== undefined) u.dimensions = dimensions; if (weight_grams !== undefined) u.weight = weight_grams;
    if (material !== undefined) u.material = material; 
    if (active !== undefined) u.status = active ? 'active' : 'draft';
    if (badge !== undefined) u.badge = badge;
    if (sort_order !== undefined) u.sort_order = sort_order;
    if (is_featured !== undefined) u.is_featured = is_featured;
    if (is_popular !== undefined) u.is_popular = is_popular;
    if (series_code !== undefined) u.series_code = series_code;
    if (model_code !== undefined) u.model_code = model_code;
    await supabaseAdmin.from('products').update(u).eq('id', id);
    return res.json({ success: true });
  }

  // ── PUT update variant ────────────────────────────────────
  if (req.method === 'PUT' && !id && req.query?.variantId) {
    const { variantId } = req.query;
    const { 
      colorName, colorHex, price, comparePrice, images, stock,
      editionName, editionCode, colorCode, batchNo, mfgDate, leatherType,
      hardware, brandingMethod, qcStatus
    } = req.body || {};
    const u = {};
    if (colorName) u.color_name = colorName; if (colorHex) u.color_hex = colorHex;
    if (price) u.price = price; if (comparePrice !== undefined) u.compare_price = comparePrice;
    if (images) u.images = images;
    if (editionName !== undefined) u.edition_name = editionName;
    if (editionCode !== undefined) u.edition_code = editionCode;
    if (colorCode !== undefined) u.color_code = colorCode;
    if (batchNo !== undefined) u.batch_no = batchNo;
    if (mfgDate !== undefined) u.mfg_date = mfgDate;
    if (leatherType !== undefined) u.leather_type = leatherType;
    if (hardware !== undefined) u.hardware = hardware;
    if (brandingMethod !== undefined) u.branding_method = brandingMethod;
    if (qcStatus !== undefined) u.qc_status = qcStatus;
    if (Object.keys(u).length) await supabaseAdmin.from('product_variants').update(u).eq('id', variantId);
    if (stock !== undefined) await supabaseAdmin.from('inventory').update({ quantity: stock }).eq('variant_id', variantId);
    return res.json({ success: true });
  }

  // ── DELETE product ────────────────────────────────────────
  if (req.method === 'DELETE' && id) {
    await supabaseAdmin.from('products').update({ status: 'archived' }).eq('id', id);
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
