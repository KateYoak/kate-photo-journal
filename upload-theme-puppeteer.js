#!/usr/bin/env node
/**
 * Uploads blogger-theme.xml to Blogger using Puppeteer + Kate's Chrome cookies.
 * Navigates to the Blogger template editor and saves the XML there.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BLOG_ID = '6171160289292513153';
const THEME_FILE = path.join(__dirname, 'blogger-theme.xml');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const PROFILE_DIR_FILE = '/tmp/puppeteer-profile-dir.txt';

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

async function screenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return file;
}

async function main() {
  const xmlContent = fs.readFileSync(THEME_FILE, 'utf8');
  console.log(`Theme size: ${xmlContent.length} chars`);

  const profileDir = fs.readFileSync(PROFILE_DIR_FILE, 'utf8').trim() + '/chrome-profile';
  console.log(`Using Chrome profile: ${profileDir}`);

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
    executablePath: process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  try {
    // Step 1: Check if we're logged in to Google
    console.log('\n1. Checking Google auth...');
    await page.goto('https://www.blogger.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await screenshot(page, '01-blogger-home');

    const url = page.url();
    console.log(`   Current URL: ${url}`);

    if (url.includes('accounts.google.com')) {
      console.log('   Not logged in — aborting');
      await browser.close();
      process.exit(1);
    }
    console.log('   ✓ Appears logged in');

    // Step 2: Navigate to theme/template editor
    const editorUrl = `https://www.blogger.com/blog/template/source/${BLOG_ID}`;
    console.log(`\n2. Going to template editor: ${editorUrl}`);
    await page.goto(editorUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await screenshot(page, '02-template-editor');
    console.log(`   URL: ${page.url()}`);

    // Step 3: Find the textarea and replace content
    console.log('\n3. Looking for template textarea...');

    // Wait for the code editor textarea
    const textarea = await page.waitForSelector('textarea.template-content, textarea[name="template"], textarea', {
      timeout: 15000,
    }).catch(() => null);

    if (!textarea) {
      await screenshot(page, '03-no-textarea');
      console.log('   ✗ No textarea found, trying different approach...');

      // Maybe there's a CodeMirror or similar editor
      const editorEl = await page.$('.CodeMirror, .ace_editor, [contenteditable="true"]');
      if (editorEl) {
        console.log('   Found code editor element');
      } else {
        console.log('   No editor found at all. Page title:', await page.title());
        await browser.close();
        process.exit(1);
      }
    } else {
      console.log('   ✓ Found textarea');
      await screenshot(page, '03-found-editor');
    }

    // Step 4: Clear and set the new content
    console.log('\n4. Setting new template content...');

    // Try multiple methods to set the content
    let success = false;

    // Method 1: Direct textarea
    if (textarea) {
      await page.evaluate((el, content) => {
        el.value = '';
        el.value = content;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, textarea, xmlContent);
      console.log('   Set textarea value');
      success = true;
    }

    // Method 2: Look for Blogger's specific template editor elements
    if (!success) {
      // Blogger template editor sometimes uses a custom editor
      const result = await page.evaluate((content) => {
        // Try window.template or window.templateEditor
        if (window.templateContent) {
          window.templateContent = content;
          return 'window.templateContent';
        }
        return null;
      }, xmlContent);
      if (result) {
        console.log(`   Set via ${result}`);
        success = true;
      }
    }

    await screenshot(page, '04-content-set');

    // Step 5: Click Save
    console.log('\n5. Looking for Save button...');
    const saveBtn = await page.$(
      'button[data-testid="save-template"], button.save-template, button[type="submit"], ' +
      'input[type="submit"], button:has-text("Save"), [jsaction*="save"]'
    ).catch(() => null);

    if (!saveBtn) {
      // Try finding any save-related button
      const buttons = await page.$$eval('button, input[type="submit"]', els =>
        els.map(el => ({ text: el.textContent?.trim() || el.value, id: el.id, class: el.className }))
      );
      console.log('   All buttons:', JSON.stringify(buttons.slice(0, 10)));
      await screenshot(page, '05-buttons');
    } else {
      console.log('   ✓ Found save button, clicking...');
      await saveBtn.click();
      await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
      await screenshot(page, '05-after-save');
      console.log('   Saved!');
    }

    // Step 6: Test the live blog
    console.log('\n6. Testing live blog...');
    const blogUrl = 'http://katephotodiary.blogspot.com/';
    await page.goto(blogUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await screenshot(page, '06-live-blog');

    // Check if mosaic grid is visible
    const hasMosaic = await page.$('.photo-mosaic') !== null;
    const hasItems = await page.$$eval('.mosaic-item', els => els.length);
    console.log(`   photo-mosaic present: ${hasMosaic}`);
    console.log(`   mosaic-item count: ${hasItems}`);

    if (hasItems > 0) {
      console.log('\n✅ SUCCESS: Mosaic grid is live!');
      // Scroll down to see more
      await page.evaluate(() => window.scrollTo(0, 300));
      await screenshot(page, '07-mosaic-scrolled');
    } else {
      console.log('\n⚠️  Mosaic items not found — checking page structure...');
      const bodyClasses = await page.$eval('body', el => el.className);
      const postCount = await page.$$eval('.post-outer, .mosaic-item, article', els => els.length);
      console.log(`   Body classes: ${bodyClasses}`);
      console.log(`   Post elements: ${postCount}`);
    }

  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}/`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
