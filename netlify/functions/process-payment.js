// Cora's Creations — Square Payment Processor
// Env var required: SQUARE_ACCESS_TOKEN (set in Netlify → Project configuration → Environment variables)

const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { sourceId, amountCents, currency = 'USD', locationId } = body;
  if (!sourceId || !amountCents || !locationId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Square access token not configured on server' }) };
  }

  const payload = JSON.stringify({
    source_id: sourceId,
    idempotency_key: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    amount_money: { amount: amountCents, currency },
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
            resolve({ statusCode: 200, body: JSON.stringify({ success: true, paymentId: parsed.payment.id }) });
          } else {
            const msg = parsed.errors?.[0]?.detail || parsed.errors?.[0]?.code || 'Payment declined';
            resolve({ statusCode: 400, body: JSON.stringify({ error: msg }) });
          }
        } catch {
          resolve({ statusCode: 500, body: JSON.stringify({ error: 'Invalid response from Square' }) });
        }
      });
    });

    req.on('error', (e) => resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) }));
    req.write(payload);
    req.end();
  });
};
