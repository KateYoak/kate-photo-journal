#!/usr/bin/env node
const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'playwright-profile');

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true, viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  await page.goto('http://katephotodiary.blogspot.com/', {
    waitUntil: 'networkidle', timeout: 45000
  }).catch(() => {});
  await page.waitForTimeout(3000);

  const imageInfo = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.post-thumbnail, .post img, img.post-thumbnail'));
    return imgs.slice(0, 6).map(img => ({
      src: img.src,
      naturalW: img.naturalWidth,
      naturalH: img.naturalHeight,
      displayW: img.clientWidth,
      displayH: img.clientHeight,
      complete: img.complete,
    }));
  });

  console.log('Image URLs and sizes:');
  imageInfo.forEach((img, i) => {
    console.log(`\n[${i}] ${img.src.slice(-80)}`);
    console.log(`    natural: ${img.naturalW}x${img.naturalH}, display: ${img.displayW}x${img.displayH}, complete: ${img.complete}`);
  });

  await context.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
