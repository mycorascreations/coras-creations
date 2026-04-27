// Cora's Creations — Order notification email via Resend
const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid request' }); }

  const { subject, message, to } = body;
  if (!subject || !message) return json(400, { error: 'Missing subject or message' });

  const resendKey   = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.NOTIFICATION_EMAIL || 'mikecpeters82@icloud.com';

  console.log('[send-notification] resendKey present:', !!resendKey, '| recipient:', to || notifyEmail);

  if (!resendKey) {
    console.error('[send-notification] RESEND_API_KEY is not set in environment variables!');
    return json(500, { error: 'Email service not configured' });
  }

  // 'to' can be a specific address (e.g. customer confirmation) or defaults to admin
  const recipient = to || notifyEmail;

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <h2 style="color:#7c3aed;">✨ ${esc(subject)}</h2>
      <div style="background:#f5f5ff;padding:1rem;border-radius:8px;white-space:pre-wrap;line-height:1.7;">
        ${esc(message).replace(/\n/g,'<br>')}
      </div>
      <p style="color:#888;font-size:0.8rem;margin-top:1rem;">Cora's Creations — automated order notification</p>
    </div>`;

  const payload = {
    from:    "Cora's Creations <orders@mycorascreations.com>",
    to:      [recipient],
    subject: subject,
    html:    htmlBody
  };

  const sent = await sendResend(payload, resendKey);
  if (!sent) return json(500, { error: 'Failed to send email' });
  return json(200, { success: true });
};

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sendResend(payload, apiKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('[send-notification] Resend status:', res.statusCode, '| body:', data.slice(0, 300));
        resolve(res.statusCode === 200 || res.statusCode === 201);
      });
    });
    req.on('error', (err) => {
      console.error('[send-notification] Resend network error:', err.message);
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}
