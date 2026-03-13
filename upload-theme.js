#!/usr/bin/env node
/**
 * Uploads blogger-theme.xml to the blog via Blogger AtomPub template API.
 * Uses credentials from ~/.clasprc.json (OAuth2 with refresh token).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BLOG_ID = '6171160289292513153';
const CLASPRC = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.clasprc.json'), 'utf8'));

async function getAccessToken() {
  const { clientId, clientSecret } = CLASPRC.oauth2ClientSettings;
  const { refresh_token, access_token, expiry_date } = CLASPRC.token;

  // Use existing access token if still valid (5 min buffer)
  if (access_token && expiry_date && Date.now() < expiry_date - 300000) {
    console.log('Using cached access token');
    return access_token;
  }

  console.log('Refreshing access token...');
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  console.log('✓ Got fresh access token');
  return data.access_token;
}

async function getBlogUrl(token) {
  const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.url;
}

async function uploadTheme(token, xmlContent) {
  const url = `https://www.blogger.com/feeds/${BLOG_ID}/template/default`;
  console.log(`Uploading theme to: ${url}`);
  console.log(`Template size: ${xmlContent.length} bytes`);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/atom+xml',
    },
    body: xmlContent,
  });

  const text = await res.text();
  if (res.ok) {
    console.log(`✓ Theme uploaded successfully (HTTP ${res.status})`);
  } else {
    console.error(`✗ Upload failed (HTTP ${res.status})`);
    console.error(text.substring(0, 500));
    throw new Error(`HTTP ${res.status}`);
  }
  return res.status;
}

async function main() {
  const themeFile = path.join(__dirname, 'blogger-theme.xml');
  if (!fs.existsSync(themeFile)) {
    throw new Error('blogger-theme.xml not found');
  }
  const xmlContent = fs.readFileSync(themeFile, 'utf8');
  console.log(`Read theme: ${xmlContent.length} chars`);

  const token = await getAccessToken();
  const blogUrl = await getBlogUrl(token);
  console.log(`Blog URL: ${blogUrl}`);

  await uploadTheme(token, xmlContent);

  console.log('\nDone! Blog URL for testing:', blogUrl);
  // Write blog URL to a temp file for the test script
  fs.writeFileSync(path.join(__dirname, '.blog-url'), blogUrl);
}

main().catch(err => { console.error(err); process.exit(1); });
