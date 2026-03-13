#!/usr/bin/env node
/**
 * ONE-TIME SETUP — saves your Google session so future runs are fully automated.
 * Run this, log in when the browser opens, then close it.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'playwright-profile');
const BLOG_ID = '6171160289292513153';

async function main() {
  console.log('Opening browser — please log in to Google, then close the window.');
  console.log('Profile will be saved to:', PROFILE_DIR);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ['--start-maximized'],
    viewport: null,
  });

  const page = await context.newPage();
  await page.goto('https://www.blogger.com/blog/themes/edit/' + BLOG_ID, {
    waitUntil: 'domcontentloaded',
  });

  console.log('\nWaiting for you to log in and reach the theme editor...');
  console.log('(Close the browser window when you see the Blogger theme editor)');

  // Wait until the page is on blogger with the right URL
  await page.waitForFunction(
    () => window.location.href.includes('blogger.com/blog/themes/edit'),
    { timeout: 300000 }
  ).catch(() => {});

  // Wait for the page to be fully loaded and authenticated
  await page.waitForLoadState('networkidle').catch(() => {});

  console.log('\n✅ Session saved! You can now close the browser window.');
  console.log('Future automated runs will use this saved session.\n');

  // Keep open until user closes
  await context.waitForEvent('close').catch(() => {});
  await context.close().catch(() => {});
}

main().catch(e => { console.error(e.message); process.exit(1); });
