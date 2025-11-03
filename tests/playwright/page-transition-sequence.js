const path = require('path');
const { chromium } = require('playwright');

async function waitForEnter(page, description) {
  await page.waitForFunction(() => {
    const events = window.__transitionEvents || [];
    return events.some((entry) => entry.type === 'enter-start');
  }, null, { timeout: 2000 });

  try {
    await page.waitForFunction(() => {
      const events = window.__transitionEvents || [];
      return events.some((entry) => entry.type === 'enter-complete');
    }, null, { timeout: 2000 });
  } catch (error) {
    throw new Error(`Missing enter complete event after ${description}: ${error.message}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  const productData = require(path.resolve(__dirname, '../../products/index.json'));
  const footerMarkup = '<footer data-test="injected">Playwright Footer</footer>';

  await context.addInitScript(({ data, footer }) => {
    window.__transitionEvents = [];
    const record = (type, event) => {
      const detail = event?.detail || {};
      window.__transitionEvents.push({
        page: window.location.pathname,
        type,
        direction: detail.direction || null,
        timestamp: performance.now()
      });
    };
    window.addEventListener('mdw:transition-exit-start', (event) => record('exit-start', event));
    window.addEventListener('mdw:transition-exit-complete', (event) => record('exit-complete', event));
    window.addEventListener('mdw:transition-enter-start', (event) => record('enter-start', event));
    window.addEventListener('mdw:transition-enter-complete', (event) => record('enter-complete', event));

    const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    const normalizeUrl = (input) => {
      if (!input) {
        return '';
      }
      if (typeof input === 'string') {
        return input;
      }
      if (typeof input === 'object' && 'url' in input) {
        return input.url;
      }
      return '';
    };

    window.fetch = async (input, init) => {
      const url = normalizeUrl(input);
      if (/index\.json($|\?)/.test(url)) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('partials/footer.html')) {
        return new Response(footer, {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      }
      if (originalFetch) {
        return originalFetch(input, init);
      }
      throw new Error('Fetch not supported in this environment');
    };
  }, { data: productData, footer: footerMarkup });
  const page = await context.newPage();
  const indexPath = path.resolve(__dirname, '../../index.html');
  await page.goto(`file://${indexPath}`);

  // Navigate to products (rightward exit expected -> leftward entrance)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.click('a[data-transition-direction="right"]')
  ]);
  await waitForEnter(page, 'navigating to products');

  // Navigate quickly to first internal product card (another rightward exit)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.click('#product-grid a[data-transition-direction="right"]')
  ]);
  await waitForEnter(page, 'navigating to product detail');

  // Immediate back navigation via left-arrow link (leftward exit -> rightward entrance)
  await page.waitForSelector('a[data-transition-direction="left"]', { state: 'visible' });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.click('a[data-transition-direction="left"]')
  ]);
  await waitForEnter(page, 'returning to products');

  await browser.close();
  // eslint-disable-next-line no-console
  console.log('Page transition animations triggered successfully for consecutive navigations.');
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
