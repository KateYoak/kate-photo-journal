#!/usr/bin/env node
/**
 * Screenshots:
 * 1. Local mosaic theme preview (built from Blogger feed data)
 * 2. Live blog (current Dynamic Views with published posts)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';
const BLOG_URL = 'http://katephotodiary.blogspot.com/';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function buildMosaicHtml() {
  // Fetch actual post data from Blogger JSON feed
  const feedUrl = `https://www.blogger.com/feeds/${BLOG_ID}/posts/summary?max-results=20&alt=json`;
  let posts = [];
  try {
    const res = await fetch(feedUrl);
    const data = await res.json();
    posts = (data.feed.entry || []).map(e => ({
      title: e.title.$t,
      url: (e.link.find(l => l.rel === 'alternate') || {}).href || '#',
      thumbnail: e.media$thumbnail
        ? e.media$thumbnail.url.replace('/s72-c/', '/s400-c/').replace('/s72/', '/s400/')
        : null,
    })).filter(p => p.thumbnail);
    console.log(`Fetched ${posts.length} posts with thumbnails`);
  } catch(e) {
    console.log(`Feed failed (${e.message}), using placeholders`);
    posts = Array.from({length: 16}, (_, i) => ({
      title: `Week of March 2–8, 2026 — March ${2 + i} `,
      url: '#',
      thumbnail: `https://picsum.photos/seed/${i+1}/400/400`,
    }));
  }

  const postHtml = posts.map((p, i) => `
    <div class="mosaic-item${i % 7 === 0 ? ' big' : ''}">
      <a href="${p.url}">
        <img class="mosaic-img" src="${p.thumbnail}" alt="" loading="eager"/>
        <div class="mosaic-caption">
          <span class="mosaic-title">${p.title.replace(/</g, '&lt;')}</span>
        </div>
      </a>
    </div>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=1100"/>
  <title>Kate's Photo Diary — Mosaic Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #eeaa00; }

    .blog-header {
      background: #cc6611;
      padding: 30px 40px;
      color: #fff;
    }
    .blog-header h1 { font-size: 48px; font-weight: normal; text-shadow: 1px 2px 3px rgba(0,0,0,.2); }
    .blog-header p { font-size: 18px; opacity: 0.85; margin-top: 6px; }

    .blog-content {
      background: #fff;
      max-width: 960px;
      margin: 0 auto;
      padding: 20px 10px;
      box-shadow: 0 0 40px rgba(0,0,0,.15);
    }

    /* ===== Photo Mosaic Grid ===== */
    .photo-mosaic {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      grid-auto-rows: 220px;
      gap: 4px;
      background: #111;
    }

    .mosaic-item {
      position: relative;
      overflow: hidden;
      background: #222;
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
      color: #fff; font-size: 13px; font-weight: bold;
      display: block; line-height: 1.4;
    }

    .page-nav {
      padding: 16px 10px;
      text-align: center;
      font-size: 14px;
      color: #888;
    }
  </style>
</head><body>
  <div class="blog-header">
    <h1>Kate's Photo Diary</h1>
    <p>A weekly photo journal — March 2026</p>
  </div>
  <div class="blog-content">
    <div class="photo-mosaic">
${postHtml}
    </div>
    <div class="page-nav">← Older posts | Newer posts →</div>
  </div>
</body></html>`;

  const file = path.join(SCREENSHOT_DIR, 'mosaic-preview.html');
  fs.writeFileSync(file, html);
  return file;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    // === 1. Local mosaic preview ===
    console.log('\n=== 1. Mosaic theme preview ===');
    const htmlFile = await buildMosaicHtml();
    console.log(`Preview HTML: ${htmlFile}`);

    const previewPage = await browser.newPage();
    await previewPage.setViewportSize({ width: 1400, height: 900 });
    await previewPage.goto('file://' + htmlFile, { waitUntil: 'domcontentloaded' });
    // Wait for images to load
    await previewPage.waitForFunction(() => {
      const imgs = document.querySelectorAll('.mosaic-img');
      const loaded = Array.from(imgs).filter(i => i.complete && i.naturalWidth > 0);
      console.log('imgs loaded:', loaded.length, '/', imgs.length);
      return loaded.length >= Math.min(imgs.length, 4); // wait for at least 4
    }, { timeout: 15000 }).catch(() => console.log('  (some images timed out — proceeding)'));

    await previewPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'mosaic-01-preview.png') });
    console.log('  📸 mosaic-01-preview.png');

    // Scroll down to see more
    await previewPage.evaluate(() => window.scrollBy(0, 500));
    await previewPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'mosaic-02-scrolled.png') });
    console.log('  📸 mosaic-02-scrolled.png');
    await previewPage.close();

    // === 2. Live blog screenshot ===
    console.log('\n=== 2. Live blog (Dynamic Views) ===');
    const livePage = await browser.newPage();
    await livePage.setViewportSize({ width: 1400, height: 900 });
    try {
      await livePage.goto(BLOG_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await livePage.waitForTimeout(4000); // let JS render
      await livePage.screenshot({ path: path.join(SCREENSHOT_DIR, 'live-blog-01.png') });
      console.log('  📸 live-blog-01.png');
    } catch(e) {
      console.log(`  Live blog screenshot failed: ${e.message}`);
    }
    await livePage.close();

  } finally {
    await browser.close();
  }

  // Report
  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
  console.log(`\n✅ Done! Screenshots in ${SCREENSHOT_DIR}:`);
  files.forEach(f => console.log(`   ${f} (${Math.round(fs.statSync(path.join(SCREENSHOT_DIR, f)).size / 1024)}KB)`));
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
