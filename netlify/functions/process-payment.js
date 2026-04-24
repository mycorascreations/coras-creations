// Cora's Creations — Square Payment Processor
// Netlify Function: /.netlify/functions/process-payment
//
// Required env var in Netlify Dashboard → Site settings → Environment variables:
//   SQUARE_ACCESS_TOKEN  →  your Square production access token
//
// Get it from: developers.squareup.com → Your App → Credentials → Production Access Token

const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { sourceId, amountCents, currency = 'USD', locationId } = body;

  if (!sourceId || !amountCents || !locationId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Square not configured on server' }) };
  }

  const idempotencyKey = `cc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const payload = JSON.stringify({
    source_id: sourceId,
    idempotency_key: idempotencyKey,
    amount_money: {
      amount: amountCents,
      currency
    },
    location_id: locationId
  });

  return new Promise((resolve) => {
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
            resolve({
              statusCode: 200,
              body: JSON.stringify({ success: true, paymentId: parsed.payment.id })
            });
          } else {
            const msg = parsed.errors?.[0]?.detail || 'Payment declined';
            resolve({
              statusCode: 400,
              body: JSON.stringify({ error: msg })
            });
          }
        } catch {
          resolve({ statusCode: 500, body: JSON.stringify({ error: 'Invalid Square response' }) });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) });
    });

    req.write(payload);
    req.end();
  });
};
