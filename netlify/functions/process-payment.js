// Cora's Creations — Square Payment Processor + Order Email

const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  if (event.httpMethod === 'GET') {
    const hasToken = !!process.env.SQUARE_ACCESS_TOKEN;
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, tokenConfigured: hasToken }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { sourceId, amountCents, currency = 'USD', locationId, orderDetails } = body;
  if (!sourceId || !amountCents || !locationId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Square access token not configured' }) };
  }

  // ── Charge via Square ─────────────────────────────────────────────────────
  const squarePayload = JSON.stringify({
    source_id: sourceId,
    idempotency_key: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    amount_money: { amount: amountCents, currency },
    location_id: locationId
  });

  let paymentResult;
  try {
    paymentResult = await squareCharge(squarePayload, accessToken);
  } catch (e) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }) };
  }

  if (!paymentResult.success) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: paymentResult.error }) };
  }

  // ── Send notification email (server-side, non-blocking) ───────────────────
  if (orderDetails) {
    const { customerName, customerEmail, orderNumber, items, subtotal, shipping, total,
            streetAddress, city, state, zipCode } = orderDetails;

    const itemLines = (items || []).map(i => `  • ${i.name} x${i.qty} — $${(i.price * i.qty).toFixed(2)}`).join('\n');
    const shippingDisplay = parseFloat(shipping) === 0 ? 'FREE' : `$${parseFloat(shipping).toFixed(2)}`;

    const adminMsg = `New Order Received!\n\nORDER #${orderNumber}\n\nCUSTOMER\nName: ${customerName}\nEmail: ${customerEmail}\n\nSHIPPING ADDRESS\n${streetAddress}\n${city}, ${state} ${zipCode}\n\nORDER ITEMS\n${itemLines}\n\nSubtotal: $${parseFloat(subtotal).toFixed(2)}\nShipping: ${shippingDisplay}\nTOTAL: $${parseFloat(total).toFixed(2)}\n\nPayment: Card (Square) ✅`;

    const notifyEmail = process.env.NOTIFICATION_EMAIL || 'mikecpeters82@icloud.com';

    // Admin notification
    sendResendEmail(
      `✅ New Order — Cora's Creations`,
      adminMsg,
      notifyEmail
    ).catch(e => console.error('Admin email error:', e.message));

    // Customer confirmation
    if (customerEmail) {
      const customerMsg = `Hi ${customerName || 'there'},\n\nThank you for your order at Cora's Creations! 🐉✨\n\nYour order #${orderNumber} has been received and payment confirmed. We'll start crafting your magical items right away!\n\nORDER SUMMARY\n${itemLines}\n\nSubtotal: $${parseFloat(subtotal).toFixed(2)}\nShipping: ${shippingDisplay}\nTOTAL: $${parseFloat(total).toFixed(2)}\n\nShipping to: ${streetAddress}, ${city}, ${state} ${zipCode}\n\nThank you for supporting a small handmade business! ✨\n— Cora`;
      sendResendEmail(
        `Order #${orderNumber} Confirmed — Cora's Creations ✨`,
        customerMsg,
        customerEmail
      ).catch(e => console.error('Customer email error:', e.message));
    }
  }

  return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, paymentId: paymentResult.paymentId }) };
};

// ── Square charge ─────────────────────────────────────────────────────────────
function squareCharge(payload, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'connect.squareup.com',
      path: '/v2/payments',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': '2024-01-17',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.payment?.status === 'COMPLETED') {
            resolve({ success: true, paymentId: parsed.payment.id });
          } else {
            const msg = parsed.errors?.[0]?.detail || parsed.errors?.[0]?.code || 'Payment declined';
            resolve({ success: false, error: msg });
          }
        } catch {
          reject(new Error('Invalid response from Square'));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

// ── Resend email ──────────────────────────────────────────────────────────────
function sendResendEmail(subject, message, to) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { console.error('RESEND_API_KEY not set'); return Promise.resolve(); }

  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
    <h2 style="color:#7c3aed;">✨ ${esc(subject)}</h2>
    <div style="background:#f5f5ff;padding:1rem;border-radius:8px;white-space:pre-wrap;line-height:1.7;">${esc(message).replace(/\n/g,'<br>')}</div>
    <p style="color:#888;font-size:0.8rem;margin-top:1rem;">Cora's Creations — order notification</p>
  </div>`;

  const emailPayload = JSON.stringify({
    from: "Cora's Creations <orders@mycorascreations.com>",
    to: [to],
    subject,
    html
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(emailPayload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`[process-payment] Email to ${to} — Resend status: ${res.statusCode}`, data.slice(0,200));
        resolve();
      });
    });
    req.on('error', (e) => { console.error('Resend error:', e.message); resolve(); });
    req.write(emailPayload);
    req.end();
  });
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
