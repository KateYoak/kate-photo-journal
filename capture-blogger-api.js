#!/usr/bin/env node
/**
 * Use Playwright to capture network requests made when saving a Blogger template.
 * We inject an auth cookie trick: navigate to accounts.google.com first,
 * then use the OAuth2 implicit flow to get a web session.
 *
 * Actually — we use page.route() to intercept and analyze requests.
 * We load the template editor as an unauthenticated user, then
 * analyze what requests the page would make on save.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BLOG_ID = '6171160289292513153';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture all network requests
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('blogger') || req.url().includes('batchexecute')) {
      requests.push({ url: req.url(), method: req.method(), postData: req.postData()?.slice(0, 200) });
    }
  });

  // Load Blogger's main JS to find template save function signatures
  console.log('Fetching Blogger template editor JS...');

  // First get the list of JS files from Blogger's homepage
  await page.goto('https://www.blogger.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

  const scripts = await page.$$eval('script[src]', els => els.map(e => e.src).filter(s => s.includes('blogger') || s.includes('_/BloggerUi')));
  console.log('Blogger scripts:', scripts.slice(0, 5));

  // Look for the template editor specific bundle
  const allScripts = await page.$$eval('script[src]', els => els.map(e => e.src));
  console.log('\nAll scripts:', allScripts.slice(0, 10));

  // Check what happens when we navigate to template editor without auth
  console.log('\nNavigating to template editor...');
  await page.goto(`https://www.blogger.com/blog/template/source/${BLOG_ID}`, {
    waitUntil: 'domcontentloaded', timeout: 15000
  });

  const url = page.url();
  const title = await page.title();
  console.log(`Redirected to: ${url}`);
  console.log(`Title: ${title}`);

  // Let's look at Blogger's source for template save patterns
  const bloggerScripts = await page.$$eval('script[src]', els => els.map(e => e.src));
  console.log('\nScripts on template editor page:', bloggerScripts.slice(0, 5));

  await browser.close();

  // Now let's fetch the Blogger home page and look for template API patterns in the JS
  console.log('\n\nLooking for template API in Blogger JS...');
  const { chromium: chromium2 } = require('playwright');
  const b2 = await chromium2.launch({ headless: true });
  const p2 = await b2.newPage();

  // Find the main Blogger bundle
  const resp = await p2.goto('https://www.blogger.com/', { waitUntil: 'networkidle', timeout: 20000 });
  const bloggerJsUrls = await p2.$$eval('script[src]', els =>
    els.map(e => e.src).filter(s => s.length > 30 && (s.includes('blogger') || s.includes('BloggerUi') || s.includes('jsbin')))
  );
  console.log('Blogger JS URLs:', bloggerJsUrls.slice(0, 5));

  for (const jsUrl of bloggerJsUrls.slice(0, 3)) {
    const jsContent = await p2.evaluate(async (url) => {
      const res = await fetch(url);
      const text = await res.text();
      // Look for template-related function names
      const matches = text.match(/(saveTemplate|putTemplate|templateContent|templateXml|blog\.template)[^;]{0,100}/g);
      return matches ? matches.slice(0, 5) : [];
    }, jsUrl);
    if (jsContent.length > 0) {
      console.log(`\nIn ${jsUrl.slice(-50)}:`);
      jsContent.forEach(m => console.log('  ', m));
    }
  }

  await b2.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
