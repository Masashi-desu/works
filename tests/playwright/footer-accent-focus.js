/**
 * テスト概要:
 *  - 目的: フッターの言語・テーマセレクタがフォーカス時にアクセントのオレンジ系カラーへ変化することを確認する。
 *  - 期待値: フォーカスリングはアクセントカラー (rgb(253,139,44) 付近)、境界線は赤優位の暖色になる。
 *  - 検証方法: ローカルサーバーで製品ページを配信し、Playwright で該当セレクタをフォーカスして計測する。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../');
const PORT = 3015;
const PAGE_URL = `http://127.0.0.1:${PORT}/products/products.html`;
const EXPECTED_RGB = { r: 253, g: 139, b: 44 };

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp'
    };
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    res.end(data);
  });
}

function assertWithinRange(measured, expected, delta, label) {
  const ok =
    Math.abs(measured.r - expected.r) <= delta &&
    Math.abs(measured.g - expected.g) <= delta &&
    Math.abs(measured.b - expected.b) <= delta;
  if (!ok) {
    throw new Error(
      `${label} expected near (${expected.r}, ${expected.g}, ${expected.b}) but was (${measured.r}, ${measured.g}, ${measured.b})`
    );
  }
}

function assertWarmHue(measured, label) {
  if (!(measured.r > measured.g && measured.g >= measured.b)) {
    throw new Error(
      `${label} should be warm-toned but was (${measured.r}, ${measured.g}, ${measured.b})`
    );
  }
}

async function run() {
  const server = http.createServer(serveStatic);
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ colorScheme: 'light' });
    await context.addInitScript(() => {
      localStorage.setItem('mdw-theme', 'light');
      window.__mdwFooterReady = false;
      window.addEventListener(
        'mdw:footer-loaded',
        () => {
          window.__mdwFooterReady = true;
        },
        { once: true }
      );
    });
    const page = await context.newPage();
    await page.goto(PAGE_URL);
    await page.waitForFunction(() => window.__mdwFooterReady === true, null, {
      timeout: 60000
    });
    await page.waitForSelector('#footer-language', { timeout: 1000 });

    const results = {};
    for (const id of ['footer-language', 'footer-theme']) {
      await page.focus(`#${id}`);
      await page.waitForTimeout(50);
      results[id] = await page.$eval(`#${id}`, (el) => {
        const style = getComputedStyle(el);
        const parseChannels = (input) => {
          if (!input) {
            return null;
          }
          const matches = input.match(/[\d.]+/g);
          if (!matches || matches.length < 3) {
            return null;
          }
          const [r, g, b] = matches.slice(0, 3).map(Number);
          if ([r, g, b].some(Number.isNaN)) {
            return null;
          }
          return { r, g, b, raw: input };
        };
        return {
          border: parseChannels(style.borderColor),
          ring: parseChannels(style.getPropertyValue('--tw-ring-color'))
        };
      });
    }

    const langBorder = results['footer-language'].border;
    const langRing = results['footer-language'].ring;
    const themeBorder = results['footer-theme'].border;
    const themeRing = results['footer-theme'].ring;

    if (!langBorder || !langRing || !themeBorder || !themeRing) {
      console.error('Raw style snapshot:', JSON.stringify(results, null, 2));
      throw new Error('Failed to parse colors from computed styles');
    }

    const tolerance = 20;
    assertWarmHue(langBorder, 'Language border color');
    assertWithinRange(langRing, EXPECTED_RGB, tolerance, 'Language ring color');
    assertWarmHue(themeBorder, 'Theme border color');
    assertWithinRange(themeRing, EXPECTED_RGB, tolerance, 'Theme ring color');

    console.log('Playwright MPC: footer selects use accent orange on focus.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
