// Cora's Creations — Email diagnostic (safe to leave deployed, no sensitive data exposed)
const https = require('https');

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const resendKey   = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.NOTIFICATION_EMAIL || 'mikecpeters82@icloud.com';

  // Report config status without exposing key value
  const config = {
    RESEND_API_KEY_set: !!resendKey,
    RESEND_API_KEY_prefix: resendKey ? resendKey.slice(0, 6) + '...' : 'NOT SET',
    NOTIFICATION_EMAIL: notifyEmail,
    timestamp: new Date().toISOString()
  };

  if (!resendKey) {
    return { statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'RESEND_API_KEY not set', config }) };
  }

  // Send a real test email
  const payload = JSON.stringify({
    from: "Cora's Creations <orders@mycorascreations.com>",
    to: [notifyEmail],
    subject: `🔧 Email Test — Cora's Creations ${new Date().toLocaleTimeString('en-US',{timeZone:'America/Chicago'})} CT`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <h2 style="color:#7c3aed;">✅ Email system working!</h2>
      <p>This test email confirms Resend is configured correctly.</p>
      <p style="color:#555;">Sent at: ${new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})} Central</p>
    </div>`
  });

  const result = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.write(payload);
    req.end();
  });

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      config,
      resend_status: result.status,
      resend_response: result.body,
      success: result.status === 200 || result.status === 201
    })
  };
};
