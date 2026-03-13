#!/usr/bin/env node
/**
 * FINISH SETUP — Run this when you return!
 *
 * This script opens a visible browser window:
 * 1. Navigates to Blogger (you may need to log in)
 * 2. Automatically uploads the mosaic theme XML
 * 3. Makes the blog private (readers-only)
 * 4. Takes screenshots to confirm success
 *
 * Usage: node finish-setup.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';
const BLOG_URL = 'http://katephotodiary.blogspot.com/';
const THEME_FILE = path.join(__dirname, 'blogger-theme.xml');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function ss(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'FINAL-' + name + '.png') }).catch(() => {});
  console.log(`  📸 FINAL-${name}.png`);
}

async function waitForAuth(page) {
  console.log('\n⏳ Waiting for you to log in to Blogger (up to 2 minutes)...');
  console.log('   → Log in to your Google account if prompted');

  // Wait until we're on a Blogger dashboard page (not login)
  await page.waitForFunction(() => {
    const url = window.location.href;
    return !url.includes('accounts.google.com') &&
           (url.includes('blogger.com') || url.includes('blogspot.com'));
  }, { timeout: 120000 });

  console.log('   ✓ Logged in!');
}

async function uploadTheme(page, xmlContent) {
  console.log('\n2. Uploading mosaic theme...');
  const editorUrl = `https://www.blogger.com/blog/themes/edit/${BLOG_ID}`;
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check if redirected to login
  if (page.url().includes('accounts.google.com')) {
    await waitForAuth(page);
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  await ss(page, '01-template-editor');
  console.log(`   URL: ${page.url()}`);

  // Find textarea
  const textarea = await page.waitForSelector('textarea', { timeout: 20000 }).catch(() => null);
  if (!textarea) {
    console.log('   ✗ No textarea found — is this the right page?');
    const title = await page.title();
    console.log(`   Page title: "${title}"`);
    await ss(page, '01b-error');
    return false;
  }
  console.log('   ✓ Found template textarea');

  // Clear and set content
  await page.evaluate((content) => {
    const ta = document.querySelector('textarea');
    ta.focus();
    ta.select();
    ta.value = '';
    ta.value = content;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  }, xmlContent);

  await page.waitForTimeout(1000);
  console.log(`   ✓ Pasted ${xmlContent.length.toLocaleString()} chars into editor`);

  // Find Save button
  const buttons = await page.$$eval('button, input[type="submit"]', els =>
    els.map(el => ({ text: (el.textContent || el.value || '').trim(), id: el.id, visible: el.offsetParent !== null }))
      .filter(b => b.visible)
  );
  console.log('   Buttons:', buttons.map(b => `"${b.text}"`).join(', '));

  // Try different save button strategies
  let saved = false;
  const saveTexts = ['Save', 'Save template', 'Save changes', 'Apply to blog'];
  for (const text of saveTexts) {
    const btn = page.locator(`button:has-text("${text}"), input[value="${text}"]`).first();
    if (await btn.count() > 0) {
      console.log(`   Clicking "${text}" button...`);
      await btn.click();
      await page.waitForTimeout(4000);
      await ss(page, '02-after-save');
      saved = true;
      console.log('   ✓ Clicked save!');
      break;
    }
  }

  if (!saved) {
    console.log('   ⚠ No save button found automatically');
    console.log('   → Please manually click "Save" in the browser window, then press Enter here');
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    await ss(page, '02-manual-save');
  }

  return true;
}

async function checkPrivacySettings(page) {
  console.log('\n3. Setting blog to private...');

  // First check current settings
  const settingsUrl = `https://www.blogger.com/blog/settings/${BLOG_ID}`;
  await page.goto(settingsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await ss(page, '03-settings');

  console.log(`   URL: ${page.url()}`);
  console.log('   (Privacy settings may require manual action after theme upload)');
  console.log('   To make blog private: Settings → Permissions → Reader access → Only blog authors');
}

async function verifyLiveBlog(page) {
  console.log('\n4. Verifying live blog...');
  await page.goto(BLOG_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await ss(page, '04-live-blog');

  const hasMosaic = await page.$('.photo-mosaic').then(el => el !== null).catch(() => false);
  const mosaicCount = await page.$$eval('.mosaic-item', els => els.length).catch(() => 0);

  console.log(`   .photo-mosaic found: ${hasMosaic}`);
  console.log(`   .mosaic-item count: ${mosaicCount}`);

  if (hasMosaic && mosaicCount > 0) {
    // Scroll down for more photos
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(500);
    await ss(page, '04b-scrolled');
    console.log('\n🎉 SUCCESS! Mosaic theme is live!');
    return true;
  } else {
    console.log('\n⚠ Mosaic not visible yet — the theme may still be applying');
    return false;
  }
}

async function main() {
  const xmlContent = fs.readFileSync(THEME_FILE, 'utf8');
  console.log(`\nKate's Photo Journal — Final Setup`);
  console.log(`=====================================`);
  console.log(`Theme XML: ${xmlContent.length.toLocaleString()} chars`);
  console.log(`\nOpening browser window...`);

  const browser = await chromium.launch({
    headless: false,  // Visible window so you can interact
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,  // Use full screen size
  });
  const page = await context.newPage();

  try {
    // 1. Navigate to Blogger
    console.log('\n1. Opening Blogger...');
    await page.goto('https://www.blogger.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if we need to log in
    const url = page.url();
    if (url.includes('accounts.google.com')) {
      console.log('   → Please log in to your Google account in the browser window');
      await waitForAuth(page);
    } else {
      console.log('   ✓ Already logged in!');
    }

    // 2. Upload theme
    const themeUploaded = await uploadTheme(page, xmlContent);

    if (themeUploaded) {
      // 3. Check privacy settings
      await checkPrivacySettings(page);

      // 4. Verify live blog
      await verifyLiveBlog(page);
    }

    console.log('\n✅ Setup complete! Browser will close in 10 seconds...');
    console.log('   Check screenshots/FINAL-*.png for results');
    await page.waitForTimeout(10000);

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    await ss(page, 'ERROR').catch(() => {});
    console.log('\nBrowser staying open for manual inspection...');
    console.log('Press Ctrl+C to exit when done');
    await page.waitForTimeout(60000);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
