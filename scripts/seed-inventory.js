// scripts/seed-inventory.js
// Run: node scripts/seed-inventory.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Color hex map ─────────────────────────────────────────────
const COLOR_HEX = {
  'Barbados Cherry': '#8B1A2F',
  'Onyx Black':      '#1A1A1A',
  'Mocha Mousse':    '#8B6347',
  'Forest Green':    '#2D5A27',
  'Windsor Wine':    '#6B2D3E',
  'Burgundy':        '#800020',
};

// ── Inventory data from Excel ─────────────────────────────────
const PRODUCTS = [
  {
    name: 'Ryza Muse',
    slug: 'ryza-muse',
    tagline: 'Signature everyday carry',
    series_code: 'RZ',
    model_code: 'MU',
    badge: 'Signature',
    sort_order: 1,
    is_featured: true,
    is_popular: true,
    variants: [
      { sku: 'VH-RZ-MU-EDGR-BC', edition: 'Gray Edition',  edCode: 'EDGR', color: 'Barbados Cherry', colorCode: 'BC', qty: 5,  qcStatus: 'Approved'      },
      { sku: 'VH-RZ-MU-EDGR-OB', edition: 'Gray Edition',  edCode: 'EDGR', color: 'Onyx Black',      colorCode: 'OB', qty: 7,  qcStatus: 'Pending QC'    },
      { sku: 'VH-RZ-MU-EDGR-MM', edition: 'Gray Edition',  edCode: 'EDGR', color: 'Mocha Mousse',    colorCode: 'MM', qty: 5,  qcStatus: 'Rejected'      },
      { sku: 'VH-RZ-MU-EDGR-FG', edition: 'Gray Edition',  edCode: 'EDGR', color: 'Forest Green',    colorCode: 'FG', qty: 5,  qcStatus: 'Repair needed' },
      { sku: 'VH-RZ-MU-EDGR-WW', edition: 'Gray Edition',  edCode: 'EDGR', color: 'Windsor Wine',    colorCode: 'WW', qty: 2,  qcStatus: null            },
      { sku: 'VH-RZ-MU-EDMO-OB', edition: 'Mocha Edition', edCode: 'EDMO', color: 'Onyx Black',      colorCode: 'OB', qty: 5,  qcStatus: null            },
      { sku: 'VH-RZ-MU-EDBL-MM', edition: 'Black Edition', edCode: 'EDBL', color: 'Mocha Mousse',    colorCode: 'MM', qty: 5,  qcStatus: null            },
    ]
  },
  {
    name: 'Ryza Halo',
    slug: 'ryza-halo',
    tagline: 'Elevated classic carry',
    series_code: 'RZ',
    model_code: 'HA',
    badge: null,
    sort_order: 2,
    is_featured: false,
    is_popular: true,
    variants: [
      { sku: 'VH-RZ-HA-EDGR-BC', edition: 'Gray Edition', edCode: 'EDGR', color: 'Barbados Cherry', colorCode: 'BC', qty: 4, qcStatus: null },
      { sku: 'VH-RZ-HA-EDGR-OB', edition: 'Gray Edition', edCode: 'EDGR', color: 'Onyx Black',      colorCode: 'OB', qty: 6, qcStatus: null },
      { sku: 'VH-RZ-HA-EDGR-MM', edition: 'Gray Edition', edCode: 'EDGR', color: 'Mocha Mousse',    colorCode: 'MM', qty: 5, qcStatus: null },
      { sku: 'VH-RZ-HA-EDGR-WW', edition: 'Gray Edition', edCode: 'EDGR', color: 'Windsor Wine',    colorCode: 'WW', qty: 2, qcStatus: null },
    ]
  },
  {
    name: 'Ryza Croco',
    slug: 'ryza-croco',
    tagline: 'Textured statement piece',
    series_code: 'RZ',
    model_code: 'CR',
    badge: null,
    sort_order: 3,
    is_featured: false,
    is_popular: false,
    variants: [
      { sku: 'VH-RZ-CR-EDGR-BU', edition: 'Gray Edition', edCode: 'EDGR', color: 'Burgundy', colorCode: 'BU', qty: 6, brandingMethod: 'Printed', qcStatus: null },
    ]
  },
  {
    name: 'Ryza Duo',
    slug: 'ryza-duo',
    tagline: 'Double compartment everyday bag',
    series_code: 'RZ',
    model_code: 'DU',
    badge: null,
    sort_order: 4,
    is_featured: false,
    is_popular: false,
    variants: [
      { sku: 'VH-RZ-DU-EDGR-BC', edition: 'Gray Edition', edCode: 'EDGR', color: 'Barbados Cherry', colorCode: 'BC', qty: 5, brandingMethod: 'Combo', qcStatus: null },
      { sku: 'VH-RZ-DU-EDGR-OB', edition: 'Gray Edition', edCode: 'EDGR', color: 'Onyx Black',      colorCode: 'OB', qty: 6, brandingMethod: 'Combo', qcStatus: null },
      { sku: 'VH-RZ-DU-EDGR-MM', edition: 'Gray Edition', edCode: 'EDGR', color: 'Mocha Mousse',    colorCode: 'MM', qty: 8, brandingMethod: 'Combo', qcStatus: null },
      { sku: 'VH-RZ-DU-EDGR-FG', edition: 'Gray Edition', edCode: 'EDGR', color: 'Forest Green',    colorCode: 'FG', qty: 6, brandingMethod: 'Combo', qcStatus: null },
      { sku: 'VH-RZ-DU-EDGR-WW', edition: 'Gray Edition', edCode: 'EDGR', color: 'Windsor Wine',    colorCode: 'WW', qty: 6, qcStatus: null },
    ]
  },
  {
    name: 'Ryza Core',
    slug: 'ryza-core',
    tagline: 'Minimal everyday carry',
    series_code: 'RZ',
    model_code: 'CO',
    badge: 'Most Popular',
    sort_order: 5,
    is_featured: true,
    is_popular: true,
    variants: [
      { sku: 'VH-RZ-CO-EDBL-OB', edition: 'Black Edition', edCode: 'EDBL', color: 'Onyx Black',   colorCode: 'OB', qty: 9, brandingMethod: 'Plain', qcStatus: null },
      { sku: 'VH-RZ-CO-EDMO-MM', edition: 'Mocha Edition', edCode: 'EDMO', color: 'Mocha Mousse', colorCode: 'MM', qty: 7, brandingMethod: 'Plain', qcStatus: null },
    ]
  },
];

// ── Generate a solid-color SVG as a Buffer ────────────────────
function makeSvgBuffer(hex, productName, colorName) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
  <rect width="800" height="800" fill="${hex}"/>
  <rect x="0" y="600" width="800" height="200" fill="rgba(0,0,0,0.35)"/>
  <text x="400" y="665" font-family="Georgia,serif" font-size="38" fill="white" text-anchor="middle" font-weight="bold">VINTAGE HIDES</text>
  <text x="400" y="715" font-family="Georgia,serif" font-size="26" fill="rgba(255,255,255,0.85)" text-anchor="middle">${productName}</text>
  <text x="400" y="755" font-family="Georgia,serif" font-size="20" fill="rgba(255,255,255,0.65)" text-anchor="middle">${colorName}</text>
</svg>`;
  return Buffer.from(svg);
}

// ── Upload a color swatch image to Supabase Storage ───────────
async function uploadColorImage(productSlug, colorCode, hex, productName, colorName) {
  const svgBuf = makeSvgBuffer(hex, productName, colorName);
  const filePath = `variants/${productSlug}-${colorCode.toLowerCase()}-placeholder.svg`;

  // Delete existing file first (ignore errors)
  await supabase.storage.from('product-images').remove([filePath]).catch(() => {});

  const { error } = await supabase.storage
    .from('product-images')
    .upload(filePath, svgBuf, { contentType: 'image/svg+xml', upsert: true });

  if (error) {
    console.warn(`  ⚠ Upload failed for ${filePath}:`, error.message);
    return null;
  }

  const { data: pub } = supabase.storage.from('product-images').getPublicUrl(filePath);
  return pub?.publicUrl || null;
}

// ── Main seed function ────────────────────────────────────────
async function seed() {
  console.log('🌱 Starting inventory seed...\n');

  for (const p of PRODUCTS) {
    console.log(`📦 Creating product: ${p.name}`);

    // Insert product
    const { data: product, error: pErr } = await supabase
      .from('products')
      .insert({
        name: p.name,
        slug: p.slug,
        tagline: p.tagline,
        material: 'Full-grain LWG-Gold certified sheep leather',
        status: 'active',
        badge: p.badge,
        sort_order: p.sort_order,
        is_featured: p.is_featured,
        is_popular: p.is_popular,
        series_code: p.series_code,
        model_code: p.model_code,
      })
      .select('id')
      .single();

    if (pErr) {
      console.error(`  ✗ Failed to insert product ${p.name}:`, pErr.message);
      continue;
    }

    console.log(`  ✓ Product created: ${product.id}`);

    // Insert each variant
    for (const v of p.variants) {
      const hex = COLOR_HEX[v.color] || '#888888';

      // Upload placeholder image
      process.stdout.write(`  🎨 Uploading image for ${v.color}...`);
      const imageUrl = await uploadColorImage(p.slug, v.colorCode, hex, p.name, v.color);
      console.log(imageUrl ? ' ✓' : ' ✗ (skipped)');

      // Insert variant
      const { data: variant, error: vErr } = await supabase
        .from('product_variants')
        .insert({
          product_id: product.id,
          color_name: v.color,
          color_hex: hex,
          color_code: v.colorCode,
          sku: v.sku,
          price: 3499,       // Default price — update in admin panel
          compare_price: 4999,
          images: imageUrl ? [imageUrl] : [],
          edition_name: v.edition,
          edition_code: v.edCode,
          batch_no: 'B001',
          mfg_date: '2026-04-28',
          leather_type: 'Sheep Leather',
          hardware: 'Gold',
          branding_method: v.brandingMethod || 'Laser',
          qc_status: v.qcStatus || null,
          active: true,
        })
        .select('id')
        .single();

      if (vErr) {
        console.error(`    ✗ Failed variant ${v.sku}:`, vErr.message);
        continue;
      }

      // Insert inventory
      const { error: iErr } = await supabase
        .from('inventory')
        .insert({
          variant_id: variant.id,
          quantity: v.qty,
          reserved_quantity: 0,
          low_stock_threshold: 5,
        });

      if (iErr) {
        console.error(`    ✗ Inventory insert failed for ${v.sku}:`, iErr.message);
      } else {
        console.log(`    ✓ Variant ${v.sku} — Stock: ${v.qty}`);
      }
    }
    console.log('');
  }

  console.log('✅ Seed complete! All products added to Supabase.\n');
  console.log('📝 Note: Default price set to ₹3,499 / MRP ₹4,999 for all variants.');
  console.log('   Update real prices from Admin Panel → Products → Edit variant.');
}

seed().catch(console.error);
