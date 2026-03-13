#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';
const PROFILE_DIR = path.join(__dirname, 'playwright-profile');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

async function ss(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'DBG-' + name + '.png'), fullPage: true });
  console.log(`  📸 DBG-${name}.png`);
}

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, args: ['--start-maximized'], viewport: null,
  });
  const page = await context.newPage();

  await page.goto(`https://www.blogger.com/blog/themes/edit/${BLOG_ID}`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(3000);
  await ss(page, '01-full');

  const info = await page.evaluate(() => {
    // ALL buttons including hidden
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .map(el => ({
        text: (el.textContent || el.value || '').trim().slice(0, 60),
        id: el.id,
        class: el.className.slice(0, 60),
        jsaction: el.getAttribute('jsaction')?.slice(0, 80),
        ariaLabel: el.getAttribute('aria-label'),
        visible: el.offsetParent !== null,
        rect: el.getBoundingClientRect(),
      }));

    // jsaction elements (Google uses jsaction for click handlers)
    const jsactionEls = Array.from(document.querySelectorAll('[jsaction]'))
      .filter(el => el.getAttribute('jsaction')?.includes('save') || el.textContent?.toLowerCase().includes('save'))
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 60),
        jsaction: el.getAttribute('jsaction'),
        class: el.className.slice(0, 60),
      }));

    return { allBtns, jsactionEls };
  });

  console.log('\nAll buttons:');
  info.allBtns.forEach(b => console.log(`  [${b.visible ? 'V' : 'H'}] "${b.text}" id="${b.id}" jsaction="${b.jsaction}" aria="${b.ariaLabel}"`));

  console.log('\nSave-related jsaction elements:');
  info.jsactionEls.forEach(e => console.log(`  ${e.tag} "${e.text}" jsaction="${e.jsaction}"`));

  // Try Ctrl+S
  console.log('\nTrying Ctrl+S...');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2000);
  await ss(page, '02-after-ctrl-s');

  console.log('\nBrowser open 30s for inspection...');
  await page.waitForTimeout(30000);
  await context.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
