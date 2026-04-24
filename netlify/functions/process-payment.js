// Cora's Creations — Square Payment Processor

const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET'
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // Health check
  if (event.httpMethod === 'GET') {
    const hasToken = !!process.env.SQUARE_ACCESS_TOKEN;
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, tokenConfigured: hasToken })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { sourceId, amountCents, currency = 'USD', locationId } = body;
  if (!sourceId || !amountCents || !locationId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Square access token not configured' }) };
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
            resolve({
              statusCode: 200,
              headers: { ...CORS, 'Content-Type': 'application/json' },
              body: JSON.stringify({ success: true, paymentId: parsed.payment.id })
            });
          } else {
            const msg = parsed.errors?.[0]?.detail || parsed.errors?.[0]?.code || 'Payment declined';
            resolve({
              statusCode: 400,
              headers: { ...CORS, 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: msg })
            });
          }
        } catch {
          resolve({
            statusCode: 500,
            headers: { ...CORS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid response from Square' })
          });
        }
      });
    });

    req.on('error', (e) => resolve({
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    }));

    req.write(payload);
    req.end();
  });
};
