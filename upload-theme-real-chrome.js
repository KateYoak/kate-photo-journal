#!/usr/bin/env node
/**
 * Upload blogger-theme.xml using actual Chrome binary (non-headless) with Kate's profile.
 * Chrome can access Keychain for cookie decryption when running non-headless.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BLOG_ID = '6171160289292513153';
const THEME_FILE = path.join(__dirname, 'blogger-theme.xml');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
// Kate's actual Chrome Default profile
const CHROME_PROFILE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function ss(page, name) {
  const f = path.join(SCREENSHOT_DIR, name + '.png');
  await page.screenshot({ path: f }).catch(() => {});
  console.log(`  📸 ${name}.png`);
}

async function main() {
  const xmlContent = fs.readFileSync(THEME_FILE, 'utf8');
  console.log(`Theme XML size: ${xmlContent.length} chars`);
  console.log(`Chrome profile: ${CHROME_PROFILE}`);

  // Launch with persistent context using Kate's actual Chrome profile
  const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    channel: 'chrome',
    headless: false,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--no-process-singleton-dialog',
    ],
    timeout: 30000,
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  try {
    // 1. Check auth status
    console.log('\n1. Navigating to Blogger...');
    await page.goto('https://www.blogger.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await ss(page, 'chrome-01-blogger');

    const url = page.url();
    console.log(`   URL: ${url}`);

    if (url.includes('accounts.google.com')) {
      console.log('   ✗ Not logged in — aborting');
      await context.close();
      process.exit(1);
    }
    console.log('   ✓ Logged in');

    // 2. Go to template editor
    const editorUrl = `https://www.blogger.com/blog/template/source/${BLOG_ID}`;
    console.log(`\n2. Navigating to template editor...`);
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await ss(page, 'chrome-02-editor');
    console.log(`   URL: ${page.url()}`);

    // 3. Find the textarea
    console.log('\n3. Looking for template textarea...');
    const textarea = await page.waitForSelector('textarea', { timeout: 15000 }).catch(() => null);

    if (!textarea) {
      console.log('   ✗ No textarea found');
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      console.log(`   Title: ${title}`);
      console.log(`   Body: ${bodyText}`);
      await ss(page, 'chrome-02b-no-textarea');
      await context.close();
      process.exit(1);
    }
    console.log('   ✓ Found textarea');

    // 4. Set template content
    console.log('\n4. Setting template content...');
    await page.evaluate((content) => {
      const ta = document.querySelector('textarea');
      // Focus and select all
      ta.focus();
      ta.select();
      ta.value = content;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }, xmlContent);
    await page.waitForTimeout(1000);
    await ss(page, 'chrome-03-content-set');
    console.log('   ✓ Content set');

    // 5. Find and click Save button
    console.log('\n5. Looking for Save button...');
    const buttons = await page.$$eval('button, input[type="submit"]', els =>
      els.map(el => ({ text: (el.textContent || el.value || '').trim(), id: el.id, class: el.className.slice(0,50) }))
    );
    console.log('   Buttons:', JSON.stringify(buttons.slice(0, 15)));

    // Try to find save button by text
    const saveBtn = await page.locator('button:has-text("Save"), input[value*="Save"], button[id*="save"], button[class*="save"]').first();
    const saveBtnCount = await saveBtn.count();

    if (saveBtnCount > 0) {
      console.log('   ✓ Found save button, clicking...');
      await saveBtn.click();
      await page.waitForTimeout(5000);
      await ss(page, 'chrome-04-after-save');
      console.log('   ✓ Clicked save');
    } else {
      console.log('   ✗ No save button found');
      await ss(page, 'chrome-04-no-save');
    }

    // 6. Verify on live blog
    console.log('\n6. Checking live blog...');
    await page.goto('http://katephotodiary.blogspot.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await ss(page, 'chrome-05-live-blog');

    const hasMosaic = await page.$('.photo-mosaic').then(el => el !== null).catch(() => false);
    console.log(`   .photo-mosaic found: ${hasMosaic}`);

    if (hasMosaic) {
      console.log('\n✅ SUCCESS! Mosaic theme is live!');
    } else {
      console.log('\n⚠️  Mosaic not detected on live blog yet');
    }

  } finally {
    await context.close();
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
