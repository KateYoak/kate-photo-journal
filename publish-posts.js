#!/usr/bin/env node
/**
 * Publishes all draft posts on the blog.
 */

const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';
const CLASPRC = JSON.parse(fs.readFileSync(path.join(__dirname, '.clasprc.json'), 'utf8'));

async function getAccessToken() {
  const { clientId, clientSecret } = CLASPRC.oauth2ClientSettings;
  const { refresh_token, access_token, expiry_date } = CLASPRC.token;
  if (access_token && expiry_date && Date.now() < expiry_date - 300000) {
    return access_token;
  }
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token, grant_type: 'refresh_token' });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function getAllDrafts(token) {
  const posts = [];
  let pageToken = null;
  do {
    const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?status=draft&maxResults=25${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.items) posts.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return posts;
}

async function publishPost(token, postId) {
  const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/${postId}/publish`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Publish failed for ${postId}: HTTP ${res.status} — ${text.substring(0, 200)}`);
  }
  return await res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const token = await getAccessToken();
  const drafts = await getAllDrafts(token);
  console.log(`Found ${drafts.length} draft posts`);

  let published = 0;
  for (const post of drafts) {
    try {
      await publishPost(token, post.id);
      published++;
      console.log(`✓ Published [${published}/${drafts.length}]: ${post.title}`);
      await sleep(500);  // avoid rate limiting
    } catch (e) {
      console.error(`✗ ${post.title}: ${e.message}`);
    }
  }

  console.log(`\nDone: ${published}/${drafts.length} posts published`);
  console.log('Blog URL: http://katephotodiary.blogspot.com/');
}

main().catch(err => { console.error(err); process.exit(1); });
