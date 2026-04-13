// ============================================
// Cora's Creations — EasyPost Shipping Label
// Netlify Serverless Function
// ============================================
// Required env vars (set in Netlify dashboard):
//   EASYPOST_API_KEY  — from app.easypost.com/account/api-keys
//
// Cora's return address — update these values:
const FROM_ADDRESS = {
  name:    "Cora's Creations",
  street1: 'YOUR_STREET_ADDRESS',   // ← update
  city:    'YOUR_CITY',             // ← update
  state:   'YOUR_STATE',            // ← e.g. WA
  zip:     'YOUR_ZIP',              // ← e.g. 98101
  country: 'US',
  phone:   'YOUR_PHONE',            // ← update
};

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const EASYPOST_KEY = process.env.EASYPOST_API_KEY;
  if (!EASYPOST_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing EasyPost API key' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { name, address, city, state, zip, service, items } = body;

  // Build headers for EasyPost REST API
  const authHeader = 'Basic ' + Buffer.from(EASYPOST_KEY + ':').toString('base64');
  const headers = {
    'Authorization': authHeader,
    'Content-Type':  'application/json',
  };

  try {
    // 1. Create shipment
    const shipRes = await fetch('https://api.easypost.com/v2/shipments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        shipment: {
          to_address: { name, street1: address, city, state, zip, country: 'US' },
          from_address: FROM_ADDRESS,
          parcel: {
            length: 10, width: 8, height: 4,
            weight: 16, // oz — adjust per product weight
          },
        }
      }),
    });
    const shipment = await shipRes.json();
    if (!shipment.id) throw new Error('Shipment creation failed');

    // 2. Find matching UPS rate
    const rate = shipment.rates?.find(r =>
      r.carrier === 'UPS' && r.service === service
    ) || shipment.rates?.find(r => r.carrier === 'UPS')
      || shipment.rates?.[0];

    if (!rate) throw new Error('No rate found');

    // 3. Buy the label
    const buyRes = await fetch(`https://api.easypost.com/v2/shipments/${shipment.id}/buy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rate: { id: rate.id } }),
    });
    const purchased = await buyRes.json();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        tracking_number: purchased.tracking_code,
        label_url:       purchased.postage_label?.label_url,
        carrier:         rate.carrier,
        service:         rate.service,
        rate:            rate.rate,
      }),
    };

  } catch (err) {
    console.error('EasyPost error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
