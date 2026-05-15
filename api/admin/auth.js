// api/admin/auth.js — POST /api/admin/auth
require('dotenv').config();
const { supabaseAdmin } = require('../../lib/supabase');
const { signAdminToken, comparePassword } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const { data: admin, error } = await supabaseAdmin
    .from('admin_users')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !admin) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isValid = await comparePassword(password, admin.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Update last login
  await supabaseAdmin.from('admin_users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', admin.id);

  const token = signAdminToken({ id: admin.id, username: admin.username, role: admin.role });

  return res.json({
    success: true,
    token,
    admin: { id: admin.id, username: admin.username, role: admin.role }
  });
};
