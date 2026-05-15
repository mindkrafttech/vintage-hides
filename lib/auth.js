// lib/auth.js — JWT helpers for Admin + Affiliate auth
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ─── Admin Auth ─────────────────────────────────────────────

function signAdminToken(payload) {
  return jwt.sign(payload, process.env.ADMIN_JWT_SECRET, { expiresIn: '8h' });
}

function verifyAdminToken(token) {
  try {
    return jwt.verify(token, process.env.ADMIN_JWT_SECRET);
  } catch {
    return null;
  }
}

// ─── Affiliate Auth ──────────────────────────────────────────

function signAffiliateToken(payload) {
  return jwt.sign(payload, process.env.AFFILIATE_JWT_SECRET, { expiresIn: '30d' });
}

function verifyAffiliateToken(token) {
  try {
    return jwt.verify(token, process.env.AFFILIATE_JWT_SECRET);
  } catch {
    return null;
  }
}

// ─── Password Helpers ────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ─── OTP Helpers ─────────────────────────────────────────────

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Middleware helpers ──────────────────────────────────────

/**
 * Extract token from Authorization: Bearer <token> header
 */
function extractBearerToken(req) {
  const auth = req.headers?.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

/**
 * Middleware: require admin auth
 */
function requireAdmin(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyAdminToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.admin = payload;
  if (next) next();
  return payload;
}

/**
 * Middleware: require affiliate auth
 */
function requireAffiliate(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyAffiliateToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.affiliate = payload;
  if (next) next();
  return payload;
}

module.exports = {
  signAdminToken,
  verifyAdminToken,
  signAffiliateToken,
  verifyAffiliateToken,
  hashPassword,
  comparePassword,
  generateOTP,
  extractBearerToken,
  requireAdmin,
  requireAffiliate
};
