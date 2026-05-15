// scripts/update_review_names.js
require('dotenv').config();
const { supabaseAdmin } = require('../lib/supabase');

async function run() {
  console.log('Starting review name update...');
  
  // 1. Get all reviews with 'Verified Buyer'
  const { data: reviews, error: rError } = await supabaseAdmin
    .from('reviews')
    .select('id, customer_id')
    .eq('reviewer_name', 'Verified Buyer');

  if (rError) {
    console.error('Error fetching reviews:', rError);
    return;
  }

  console.log(`Found ${reviews.length} reviews to update.`);

  for (const r of reviews) {
    if (!r.customer_id) continue;

    // 2. Get customer name
    const { data: customer, error: cError } = await supabaseAdmin
      .from('customers')
      .select('name')
      .eq('id', r.customer_id)
      .single();

    if (customer && customer.name) {
      console.log(`Updating review ${r.id} with name: ${customer.name}`);
      await supabaseAdmin
        .from('reviews')
        .update({ reviewer_name: customer.name })
        .eq('id', r.id);
    }
  }

  console.log('Update complete!');
}

run();
