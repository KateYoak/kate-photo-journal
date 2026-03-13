#!/usr/bin/env node
/**
 * Screenshots the live blog + builds a local HTML preview of the mosaic theme.
 * No auth needed — screenshots the public blog.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BLOG_URL = 'http://katephotodiary.blogspot.com/';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const API_KEY = 'AIzaSyD-9tSrke72PluDDyZ-RjTqX_bKS9zZXTQ'; // public API key if needed

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function screenshot(page, name, options = {}) {
  const file = path.join(SCREENSHOT_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: false, timeout: 60000, ...options });
  console.log(`  📸 ${name}.png saved`);
  return file;
}

async function screenshotLiveBlog(page) {
  console.log('\n=== Live blog (current Dynamic Views) ===');
  await page.goto(BLOG_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 5000)); // let Dynamic Views JS render
  await screenshot(page, 'live-01-home', { fullPage: false });

  const title = await page.title();
  const postCount = await page.$$eval('.post, article, [class*="post"]', els => els.length).catch(() => 0);
  console.log(`  Title: ${title}`);
  console.log(`  Post-like elements: ${postCount}`);
}

async function screenshotMosaicPreview(page) {
  console.log('\n=== Local mosaic preview ===');

  // Fetch actual thumbnail URLs from the live blog's JSON feed
  const feedUrl = `https://www.blogger.com/feeds/6171160289292513153/posts/summary?max-results=20&alt=json`;
  let posts = [];
  try {
    const res = await fetch(feedUrl);
    const data = await res.json();
    posts = (data.feed.entry || []).map(e => ({
      title: e.title.$t,
      url: (e.link.find(l => l.rel === 'alternate') || {}).href || '#',
      thumbnail: e.media$thumbnail ? e.media$thumbnail.url.replace('/s72-c/', '/s400-c/') : null,
    })).filter(p => p.thumbnail);
    console.log(`  Fetched ${posts.length} posts with thumbnails from feed`);
  } catch(e) {
    console.log(`  Feed fetch failed: ${e.message}. Using placeholder images.`);
    posts = Array.from({length: 16}, (_, i) => ({
      title: `Photo ${i+1} — March 2026`,
      url: '#',
      thumbnail: `https://picsum.photos/seed/${i+1}/400/400`,
    }));
  }

  // Build mock HTML page with mosaic grid
  const postHtml = posts.map((p, i) => `
    <div class="mosaic-item${i % 7 === 0 ? ' big' : ''}">
      <a href="${p.url}">
        <img class="mosaic-img" src="${p.thumbnail}" alt="${p.title.replace(/"/g, '&quot;')}" loading="lazy"/>
        <div class="mosaic-caption">
          <span class="mosaic-title">${p.title}</span>
        </div>
      </a>
    </div>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=1100"/>
  <title>Kate's Photo Diary — Mosaic Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #eeaa00; padding: 0; }

    /* Simulated blog header */
    .blog-header {
      background: #cc6611;
      padding: 30px 40px;
      color: #fff;
    }
    .blog-header h1 { font-size: 48px; font-weight: normal; }
    .blog-header p { font-size: 18px; opacity: 0.8; margin-top: 6px; }

    .blog-content {
      background: #fff;
      max-width: 960px;
      margin: 0 auto;
      padding: 20px 10px;
      box-shadow: 0 0 40px rgba(0,0,0,.15);
    }

    /* === Photo Mosaic Grid === */
    .photo-mosaic {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      grid-auto-rows: 220px;
      gap: 4px;
      padding: 0;
      margin: -15px -15px 10px -15px;
      background: #111;
    }

    .mosaic-item {
      position: relative;
      overflow: hidden;
      background: #222;
      cursor: pointer;
    }

    .mosaic-item.big {
      grid-column: span 2;
      grid-row: span 2;
    }

    .mosaic-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: transform 0.4s ease, opacity 0.4s ease;
    }

    .mosaic-item:hover .mosaic-img {
      transform: scale(1.06);
      opacity: 0.88;
    }

    .mosaic-caption {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,0.72));
      padding: 32px 12px 12px;
      transform: translateY(100%);
      transition: transform 0.3s ease;
    }

    .mosaic-item:hover .mosaic-caption {
      transform: translateY(0);
    }

    .mosaic-title {
      color: #fff;
      font-size: 13px;
      font-weight: bold;
      display: block;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="blog-header">
    <h1>Kate's Photo Diary</h1>
    <p>Weekly photo journal</p>
  </div>
  <div class="blog-content">
    <div class="photo-mosaic">
${postHtml}
    </div>
  </div>
</body>
</html>`;

  const previewFile = path.join(__dirname, 'screenshots', 'mosaic-preview.html');
  fs.writeFileSync(previewFile, html);
  console.log(`  Wrote ${previewFile}`);

  await page.goto('file://' + previewFile, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 5000));  // wait for images to partially load
  await screenshot(page, 'mosaic-01-preview');
  await page.setViewport({ width: 1400, height: 2000 });
  await new Promise(r => setTimeout(r, 2000));
  await screenshot(page, 'mosaic-02-preview-tall');
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  try {
    // Skip live blog (Dynamic Views is slow to render in headless)
    // await screenshotLiveBlog(page);
    await screenshotMosaicPreview(page);
  } finally {
    await browser.close();
  }

  console.log('\n✅ Done! Screenshots in:', SCREENSHOT_DIR);
  console.log('  live-01-home.png  — current blog with published posts');
  console.log('  mosaic-01-preview.png  — mosaic theme mock');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
