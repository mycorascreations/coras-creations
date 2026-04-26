// Cora's Creations — Custom Order Handler
// Pipeline: receive form → Sightengine moderation → Resend email with attachment

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

  const { name, email, itemType, colors, budget, details, photoUrl, fileData, fileName, fileType } = body;

  // ── Step 1: Content moderation (only if a file was attached) ──────────────
  if (fileData && fileName) {
    const sightUser   = process.env.SIGHTENGINE_API_USER;
    const sightSecret = process.env.SIGHTENGINE_API_SECRET;

    if (!sightUser || !sightSecret) {
      return json(500, { error: 'Moderation service not configured' });
    }

    const imageBuffer = Buffer.from(fileData, 'base64');
    const modResult   = await moderateImage(imageBuffer, fileName, fileType || 'image/jpeg', sightUser, sightSecret);

    if (!modResult.safe) {
      return json(400, {
        error: 'Your image was flagged for inappropriate content and could not be submitted. Please use a different photo.'
      });
    }
  }

  // ── Step 2: Send email via Resend ─────────────────────────────────────────
  const resendKey       = process.env.RESEND_API_KEY;
  const notifyEmail     = process.env.NOTIFICATION_EMAIL || 'mikecpeters30@gmail.com';

  if (!resendKey) return json(500, { error: 'Email service not configured' });

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <h2 style="color:#7c3aed;">✨ New Custom Order — Cora's Creations</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#555;width:140px;"><strong>Name</strong></td><td>${esc(name)}</td></tr>
        <tr><td style="padding:6px 0;color:#555;"><strong>Email</strong></td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#555;"><strong>Item Type</strong></td><td>${esc(itemType)}</td></tr>
        <tr><td style="padding:6px 0;color:#555;"><strong>Colors / Theme</strong></td><td>${esc(colors)}</td></tr>
        <tr><td style="padding:6px 0;color:#555;"><strong>Budget</strong></td><td>${esc(budget)}</td></tr>
        ${photoUrl ? `<tr><td style="padding:6px 0;color:#555;"><strong>Photo Link</strong></td><td><a href="${esc(photoUrl)}">${esc(photoUrl)}</a></td></tr>` : ''}
      </table>
      <h3 style="margin-top:1.5rem;color:#7c3aed;">Vision / Details</h3>
      <p style="background:#f5f5ff;padding:1rem;border-radius:8px;line-height:1.7;">${esc(details).replace(/\n/g, '<br>')}</p>
      ${fileData ? '<p style="color:#059669;font-size:0.9rem;">📎 Reference photo attached.</p>' : ''}
    </div>
  `;

  const payload = {
    from: "Cora's Creations <onboarding@resend.dev>",
    to:   [notifyEmail],
    reply_to: email,
    subject: `Custom Order Request — ${name}`,
    html: htmlBody
  };

  if (fileData && fileName) {
    payload.attachments = [{ filename: fileName, content: fileData }];
  }

  const sent = await sendResend(payload, resendKey);
  if (!sent) return json(500, { error: 'Failed to send notification email. Please try again.' });

  // ── Step 3: Save to Firebase Firestore ───────────────────────────────────
  try {
    const now = new Date();
    const dateReceived = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
    const timeReceived = now.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: true });
    const orderNumber  = 'CO-' + Date.now().toString(36).toUpperCase();

    await saveToFirestore({
      orderNumber,
      orderType:     'custom',
      status:        'new_custom',
      dateReceived,
      timeReceived,
      fullName:      name,
      email,
      itemType,
      colors,
      budget,
      details,
      photoUrl:      photoUrl || '',
      hasAttachment: !!(fileData && fileName),
    });
  } catch(e) {
    console.warn('Firestore save failed (non-fatal):', e.message);
  }

  return json(200, { success: true });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function moderateImage(imageBuffer, filename, mimetype, apiUser, apiSecret) {
  return new Promise((resolve) => {
    const boundary = 'CCBoundary' + Date.now().toString(36);

    const beforeFile = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`
    );
    const afterFile = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="models"\r\n\r\nnudity,weapon,gore\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="api_user"\r\n\r\n${apiUser}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="api_secret"\r\n\r\n${apiSecret}\r\n` +
      `--${boundary}--\r\n`
    );

    const multipart = Buffer.concat([beforeFile, imageBuffer, afterFile]);

    const req = https.request({
      hostname: 'api.sightengine.com',
      path: '/1.0/check.json',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipart.length
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          console.log('Sightengine response:', JSON.stringify(r));

          // If API returned an error (bad credentials, etc.) — BLOCK the image
          if (r.status !== 'success') {
            console.error('Sightengine API error:', r.error || r);
            resolve({ safe: false, reason: 'moderation_error' });
            return;
          }

          // Check explicit content using correct Sightengine field names
          // nudity.safe = probability image is SFW (high = safe)
          // nudity.sexual_activity / sexual_display / erotica = explicit content scores
          const nudity = r.nudity ?? {};
          const hasExplicitNudity =
            (nudity.sexual_activity ?? 0) > 0.1 ||
            (nudity.sexual_display   ?? 0) > 0.1 ||
            (nudity.erotica          ?? 0) > 0.15 ||
            (nudity.safe             ?? 1) < 0.7;

          const goreSafe   = (r.gore?.prob ?? 0) < 0.2;
          const weaponSafe = Object.values(r.weapon?.classes ?? {}).every(p => p < 0.5);
          const safe       = !hasExplicitNudity && goreSafe && weaponSafe;

          console.log('Moderation result:', {
            nudity_safe: nudity.safe,
            sexual_activity: nudity.sexual_activity,
            sexual_display: nudity.sexual_display,
            erotica: nudity.erotica,
            hasExplicitNudity,
            goreSafe,
            weaponSafe,
            safe
          });
          resolve({ safe, detail: r });
        } catch(e) {
          console.error('Sightengine parse error:', e.message, 'raw:', data.slice(0, 200));
          resolve({ safe: false, reason: 'parse_error' }); // BLOCK on parse error
        }
      });
    });

    req.on('error', (e) => {
      console.error('Sightengine network error:', e.message);
      resolve({ safe: false, reason: 'network_error' }); // BLOCK if moderation unreachable
    });
    req.write(multipart);
    req.end();
  });
}

function saveToFirestore(data) {
  return new Promise((resolve, reject) => {
    // Build Firestore REST document fields
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      else fields[k] = { stringValue: String(v ?? '') };
    }
    const body = JSON.stringify({ fields });
    const apiKey = 'AIzaSyBCXQ8mkQxhSoarijKvFjIjnJ0upfeqoiI';
    const path   = `/v1/projects/cora-s-creations/databases/(default)/documents/orders?key=${apiKey}`;

    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path,
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) resolve(JSON.parse(d));
        else reject(new Error(`Firestore ${res.statusCode}: ${d.slice(0,200)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendResend(payload, apiKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(res.statusCode === 200 || res.statusCode === 201));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}
