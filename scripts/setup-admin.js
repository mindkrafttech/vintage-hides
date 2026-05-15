// scripts/setup-admin.js
// Run once: node scripts/setup-admin.js
// Creates the first admin user in Supabase

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n🔐 Vintage Hides — Admin User Setup\n');

  const username = await ask('Enter admin username: ');
  const password = await ask('Enter admin password (min 8 chars): ');
  const confirm = await ask('Confirm password: ');

  if (password !== confirm) { console.log('❌ Passwords do not match.'); process.exit(1); }
  if (password.length < 8) { console.log('❌ Password must be at least 8 characters.'); process.exit(1); }

  const hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('admin_users')
    .insert({ username, password_hash: hash, role: 'superadmin' })
    .select('id').single();

  if (error) {
    if (error.code === '23505') console.log(`❌ Username "${username}" already exists.`);
    else console.log('❌ Error:', error.message);
    process.exit(1);
  }

  console.log(`\n✅ Admin user created!`);
  console.log(`   Username: ${username}`);
  console.log(`   ID: ${data.id}`);
  console.log(`\n🌐 Login at: https://www.vintagehides.in/admin/`);

  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
