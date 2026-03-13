#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const THEME_FILE = path.join(__dirname, 'blogger-theme.xml');

async function ss(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'INSP-' + name + '.png'), fullPage: false });
  console.log(`  📸 INSP-${name}.png`);
}

async function main() {
  const xmlContent = fs.readFileSync(THEME_FILE, 'utf8');
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto('https://www.blogger.com/blog/themes/edit/' + BLOG_ID, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(3000);
  await ss(page, '01-editor');
  console.log('Title:', await page.title());

  // Inspect page structure
  const info = await page.evaluate(() => {
    return {
      textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
        class: el.className, id: el.id, visible: el.offsetParent !== null, valueLen: el.value.length
      })),
      codeMirror: !!document.querySelector('.CodeMirror'),
      aceEditor: !!document.querySelector('.ace_editor'),
      contentEditable: Array.from(document.querySelectorAll('[contenteditable]')).map(el => ({
        tag: el.tagName, class: el.className.slice(0, 60)
      })),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(t => t),
      inputs: Array.from(document.querySelectorAll('input[type="submit"], input[type="button"]')).map(i => i.value),
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src || f.id || 'no-src'),
    };
  });
  console.log('\nPage structure:');
  console.log(JSON.stringify(info, null, 2));

  // Look for any element that might be the editor
  const allEditableEls = await page.evaluate(() => {
    const results = [];
    // Check for common code editor patterns
    const selectors = [
      'textarea', '.CodeMirror', '.ace_editor', '[contenteditable="true"]',
      '.template-content', '[class*="editor"]', '[class*="code"]', '[id*="editor"]',
      'div[role="textbox"]', '.cm-content',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        results.push({ selector: sel, count: els.length, firstClass: els[0].className.slice(0, 80) });
      }
    }
    return results;
  });
  console.log('\nEditable elements:', JSON.stringify(allEditableEls, null, 2));

  console.log('\nBrowser staying open 60s — look at the editor structure...');
  await page.waitForTimeout(60000);
  await browser.close();
}

main().catch(e => console.error(e.message));
