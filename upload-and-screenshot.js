#!/usr/bin/env node
/**
 * Upload blogger-theme.xml using saved session, then take screenshots.
 * Runs fully automated — no user interaction needed.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';
const BLOG_URL = 'http://katephotodiary.blogspot.com/';
const THEME_FILE = path.join(__dirname, 'blogger-theme.xml');
const PROFILE_DIR = path.join(__dirname, 'playwright-profile');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function ss(page, name) {
  const f = path.join(SCREENSHOT_DIR, name + '.png');
  await page.screenshot({ path: f, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return f;
}

async function findEditorAndSetContent(page, xmlContent) {
  // Wait for page to settle
  await page.waitForTimeout(3000);

  // Dump all editor-like elements
  const info = await page.evaluate(() => ({
    textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
      class: el.className, id: el.id, visible: el.offsetParent !== null, len: el.value.length
    })),
    codeMirror: !!document.querySelector('.CodeMirror'),
    cm6: !!document.querySelector('.cm-editor'),
    ace: !!document.querySelector('.ace_editor'),
    title: document.title,
    url: location.href,
  }));
  console.log('  Editor info:', JSON.stringify(info));

  // Try CodeMirror 5
  if (info.codeMirror) {
    console.log('  Using CodeMirror 5');
    await page.evaluate((content) => {
      const cm = document.querySelector('.CodeMirror').CodeMirror;
      cm.setValue(content);
    }, xmlContent);
    return true;
  }

  // Try CodeMirror 6
  if (info.cm6) {
    console.log('  Using CodeMirror 6');
    await page.evaluate((content) => {
      const view = document.querySelector('.cm-editor').__vue__?.$editor
        || document.querySelector('.cm-editor').cmView?.view;
      if (view) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
        return true;
      }
      return false;
    }, xmlContent);
    return true;
  }

  // Try textarea
  if (info.textareas.length > 0) {
    console.log('  Using textarea');
    await page.evaluate((content) => {
      const ta = document.querySelector('textarea');
      ta.focus();
      ta.value = content;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }, xmlContent);
    return true;
  }

  // Try Ace editor
  if (info.ace) {
    console.log('  Using Ace editor');
    await page.evaluate((content) => {
      const aceEditorEl = document.querySelector('.ace_editor');
      const editor = ace.edit(aceEditorEl);
      editor.setValue(content, -1);
    }, xmlContent);
    return true;
  }

  return false;
}

async function findAndClickSave(page) {
  const buttons = await page.$$eval('button, input[type="submit"]', els =>
    els.filter(el => el.offsetParent !== null)
       .map(el => ({ text: (el.textContent || el.value || '').trim(), id: el.id, class: el.className.slice(0,50) }))
  );
  console.log('  Visible buttons:', buttons.map(b => `"${b.text}"`).join(', '));

  // Try aria-label="Save" first (Blogger uses icon buttons)
  const ariaBtn = page.locator('[aria-label="Save"]').first();
  if (await ariaBtn.count() > 0) {
    await ariaBtn.click();
    console.log('  Clicked [aria-label="Save"]');
    await page.waitForTimeout(4000);
    return true;
  }

  for (const text of ['Save', 'Save template', 'Apply to Blog', 'Save changes']) {
    const btn = page.locator(`button:has-text("${text}")`).first();
    if (await btn.count() > 0) {
      await btn.click();
      console.log(`  Clicked "${text}"`);
      await page.waitForTimeout(4000);
      return true;
    }
  }
  return false;
}

async function main() {
  const xmlContent = fs.readFileSync(THEME_FILE, 'utf8');
  console.log(`Theme: ${path.basename(THEME_FILE)} (${xmlContent.length.toLocaleString()} chars)`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ['--no-sandbox'],
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    // 1. Navigate to theme editor
    console.log('\n1. Opening theme editor...');
    await page.goto(`https://www.blogger.com/blog/themes/edit/${BLOG_ID}`, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await ss(page, 'upload-01-editor');
    console.log(`   URL: ${page.url()}`);
    console.log(`   Title: ${await page.title()}`);

    // 2. Set content
    console.log('\n2. Setting theme content...');
    const set = await findEditorAndSetContent(page, xmlContent);
    if (!set) {
      await ss(page, 'upload-02-no-editor');
      console.log('  ✗ Could not find editor element');
      await context.close();
      process.exit(1);
    }
    await ss(page, 'upload-02-content-set');
    console.log('  ✓ Content set');

    // 3. Save
    console.log('\n3. Saving...');
    const saved = await findAndClickSave(page);
    await ss(page, 'upload-03-after-save');
    if (saved) {
      console.log('  ✓ Saved');
    } else {
      console.log('  ✗ Could not find save button');
    }

    // 4. Screenshot live blog
    console.log('\n4. Screenshotting live blog...');
    await page.goto(BLOG_URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    // Wait for images to load
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('.post-thumbnail, .post img'));
      const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0);
      return imgs.length === 0 || loaded.length >= Math.min(imgs.length, 6);
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await ss(page, 'upload-04-live-top');
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(1500);
    await ss(page, 'upload-04-live-scroll');

    console.log('\n✅ Done');

  } finally {
    await context.close();
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
