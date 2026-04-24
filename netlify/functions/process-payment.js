// Cora's Creations — Square Payment Processor
// Env var required in Netlify → Project configuration → Environment variables:
//   SQUARE_ACCESS_TOKEN = your Square production access token

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { sourceId, amountCents, currency = 'USD', locationId } = body;
  if (!sourceId || !amountCents || !locationId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Square access token not configured' }) };
  }

  const idempotencyKey = `cc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  try {
    const response = await fetch('https://connect.squareup.com/v2/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': '2024-01-17'
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: idempotencyKey,
        amount_money: { amount: amountCents, currency },
        location_id: locationId
      })
    });

    const data = await response.json();

    if (response.ok && data.payment?.status === 'COMPLETED') {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, paymentId: data.payment.id })
      };
    }

    const errorMsg = data.errors?.[0]?.detail || data.errors?.[0]?.code || 'Payment declined';
    return {
      statusCode: 400,
      body: JSON.stringify({ error: errorMsg })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Network error: ' + err.message })
    };
  }
};
