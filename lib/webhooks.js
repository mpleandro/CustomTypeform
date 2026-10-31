'use strict';
// Outgoing webhooks: HMAC-signed JSON POST, 3 attempts, every attempt logged.
const crypto = require('node:crypto');

const DELAYS = [0, 5_000, 30_000];

function createWebhooks(store) {
  async function attempt(job, n) {
    const body = JSON.stringify(job.payload);
    const t = Date.now();
    let status = 0, error = null;
    try {
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'CustomTypeform/1.0', 'X-Webhook-Event': job.event };
      if (job.secret) headers['X-Webhook-Signature'] = `sha256=${crypto.createHmac('sha256', job.secret).update(body).digest('hex')}`;
      const r = await fetch(job.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
      status = r.status;
      r.body?.cancel().catch(() => {});
    } catch (e) {
      error = (e.name === 'TimeoutError' ? 'timeout' : String(e.cause?.code || e.message)).slice(0, 200);
    }
    const ok = status >= 200 && status < 300;
    if (!ok && !error) error = `HTTP ${status}`;
    const logId = store.logWebhook({
      form_id: job.form_id, response_id: job.response_id, question_id: job.question_id, event: job.event,
      url: job.url, status, ok, error, duration_ms: Date.now() - t, attempt: n, payload: job.payload
    });
    return { ok, status, error, ms: Date.now() - t, logId };
  }

  return {
    // Fire-and-forget with retries; never throws into the request that triggered it.
    dispatch(job) {
      const run = async n => {
        const r = await attempt(job, n + 1).catch(() => ({ ok: true }));
        if (!r.ok && n + 1 < DELAYS.length) setTimeout(() => run(n + 1), DELAYS[n + 1]).unref();
      };
      run(0);
    },
    once: job => attempt(job, 1)
  };
}

module.exports = { createWebhooks };
