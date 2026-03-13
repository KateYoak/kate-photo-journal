#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

async function ss(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'FIND-' + name + '.png') });
  console.log(`  📸 FIND-${name}.png`);
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  // Go to Blogger dashboard
  console.log('Opening Blogger dashboard...');
  await page.goto('https://www.blogger.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await ss(page, '01-dashboard');
  console.log('URL:', page.url());

  // Find the blog and click Theme
  console.log('\nLooking for blog link...');
  const blogLink = await page.locator(`text="${BLOG_ID}"`).first().count();
  console.log('Blog ID link count:', blogLink);

  // Try to navigate to theme page
  const themeUrls = [
    `https://www.blogger.com/blog/theme/edit/${BLOG_ID}`,
    `https://www.blogger.com/blog/template/edit/${BLOG_ID}`,
    `https://draft.blogger.com/blog/template/source/${BLOG_ID}`,
    `https://www.blogger.com/blog/template/source/${BLOG_ID}`,
  ];

  for (const url of themeUrls) {
    console.log(`\nTrying: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    const title = await page.title();
    const currentUrl = page.url();
    console.log(`  → Title: "${title}", URL: ${currentUrl}`);
    if (!title.includes('Not Found') && !title.includes('404')) {
      await ss(page, '02-theme-editor');
      console.log('  ✓ FOUND WORKING URL:', url);
      break;
    }
  }

  // If none worked, navigate to theme from dashboard
  console.log('\nNavigating from dashboard to theme settings...');
  await page.goto(`https://www.blogger.com/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click on the blog
  const blogLinks = await page.$$eval('a', els =>
    els.map(e => ({ href: e.href, text: e.textContent?.trim() }))
       .filter(e => e.href.includes(BLOG_ID) || e.text.includes('Photo Diary'))
  );
  console.log('Blog-related links:', JSON.stringify(blogLinks.slice(0, 5)));

  await ss(page, '03-dashboard-final');
  console.log('\nBrowser staying open 30s for inspection...');
  await page.waitForTimeout(30000);
  await browser.close();
}

const BLOG_ID_CONST = '6171160289292513153';
main().catch(e => console.error(e.message));
