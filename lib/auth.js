'use strict';
// Single-admin auth: password from ADMIN_PASSWORD, stateless signed session cookie.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COOKIE = 'ctf_session';
const SESSION_MS = 7 * 24 * 3600 * 1000;

function createAuth(dataDir, password) {
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    const file = path.join(dataDir, '.secret');
    try { secret = fs.readFileSync(file, 'utf8').trim(); } catch {}
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  const mac = data => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const sha = v => crypto.createHash('sha256').update(String(v)).digest();

  return {
    enabled: !!password,
    passwordOk: input => !!password && crypto.timingSafeEqual(sha(input), sha(password)),
    issue() {
      const body = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
      return `${body}.${mac(body)}`;
    },
    verify(token) {
      if (!token || !token.includes('.')) return false;
      const [body, sig] = token.split('.');
      const a = Buffer.from(sig), b = Buffer.from(mac(body));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
      try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); } catch { return false; }
    },
    cookie(token, secure) {
      return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${secure ? '; Secure' : ''}`;
    },
    token(req) {
      const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
      return m ? m.slice(COOKIE.length + 1) : '';
    }
  };
}

// Sliding-window limiter keyed by string (usually IP).
function createLimiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, list] of hits) if (list.every(t => now - t >= windowMs)) hits.delete(k);
  }, windowMs).unref();
  return key => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > max;
  };
}

module.exports = { createAuth, createLimiter };
