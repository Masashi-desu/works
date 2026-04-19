/**
 * テスト概要:
 *  - 目的: 旧ワークツリーと Tailwind 廃止後の新ワークツリーで、主要ページのレイアウトとレスポンシブ挙動が大きく変化していないか比較する。
 *  - 期待値: 指定要素の存在・テキスト・矩形サイズ・ページ全体の高さが許容差内で一致し、desktop/mobile・light/dark の各条件でデグレが起きていない。
 *  - 検証方法: BASELINE_ROOT と CANDIDATE_ROOT を静的配信し、Playwright で両方を巡回して主要セレクタの bounding box とテキストを比較する。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASELINE_ROOT = process.env.BASELINE_ROOT;
const CANDIDATE_ROOT = process.env.CANDIDATE_ROOT;
const BASELINE_PORT = Number(process.env.BASELINE_PORT || 4310);
const CANDIDATE_PORT = Number(process.env.CANDIDATE_PORT || 4311);

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'mobile', width: 390, height: 1200 }
];

const THEMES = ['light', 'dark'];

const PAGE_CASES = [
  {
    name: 'home',
    path: '/index.html',
    selectors: ['header', '[data-i18n="heroTitle"]', '[data-i18n="cardTitle"]']
  },
  {
    name: 'catalog',
    path: '/products/index.html',
    selectors: ['#product-controls', '#product-grid', '#product-grid a:nth-of-type(1)']
  },
  {
    name: 'typefetch',
    path: '/products/TypeFetch/index.html',
    selectors: ['main > *:first-child', '[data-mdw-media]:first-of-type', 'section[aria-labelledby="purchase-card-title"]']
  },
  {
    name: 'surround',
    path: '/products/Surround1x0-AKDK/index.html',
    selectors: ['main > *:first-child', 'main article > div:first-child', 'figure[data-mdw-media]']
  },
  {
    name: 'retreat',
    path: '/products/RetreatScreen/index.html',
    selectors: ['main > *:first-child', '#details > *:first-child', 'section:nth-of-type(4) > *:first-child']
  },
  {
    name: 'privacy',
    path: '/products/RetreatScreen/privacy.html',
    selectors: ['header', 'main section:nth-of-type(1)', 'main section:nth-of-type(5)'],
    viewports: ['desktop']
  },
  {
    name: 'support',
    path: '/products/RetreatScreen/support.html',
    selectors: ['header', 'main section:nth-of-type(1)', 'main section:nth-of-type(4)'],
    viewports: ['desktop']
  }
];

function createStaticHandler(rootDir) {
  return (req, res) => {
    const urlPath = req.url.split('?')[0];
    let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, ''));
    if (filePath.endsWith(path.sep)) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!filePath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      res.end(data);
    });
  };
}

function startServer(rootDir, port) {
  return new Promise((resolve) => {
    const server = http.createServer(createStaticHandler(rootDir));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function compareNumber(label, baseline, candidate) {
  const tolerance = Math.max(32, Math.abs(baseline) * 0.12);
  if (Math.abs(candidate - baseline) > tolerance) {
    throw new Error(`${label} differed too much: baseline=${baseline}, candidate=${candidate}, tolerance=${tolerance}`);
  }
}

function compareSnapshot(pageName, selector, baseline, candidate) {
  if (!baseline || !candidate) {
    throw new Error(`${pageName}: missing snapshot for ${selector}`);
  }
  if (baseline.text !== candidate.text) {
    throw new Error(`${pageName}: text mismatch for ${selector}: "${baseline.text}" !== "${candidate.text}"`);
  }
  compareNumber(`${pageName}:${selector}:x`, baseline.rect.x, candidate.rect.x);
  compareNumber(`${pageName}:${selector}:width`, baseline.rect.width, candidate.rect.width);
}

async function collectPageState(page, selectors) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(350);
  return page.evaluate((selectorList) => {
    const snapshots = {};
    selectorList.forEach((selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        snapshots[selector] = null;
        return;
      }
      const rect = element.getBoundingClientRect();
      snapshots[selector] = {
        text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
        rect: {
          x: Number(rect.x.toFixed(2)),
          y: Number(rect.y.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2))
        }
      };
    });
    return {
      snapshots,
      scrollHeight: document.documentElement.scrollHeight,
      theme: document.documentElement.dataset.theme
    };
  }, selectors);
}

async function capturePage(baseUrl, pagePath, viewport, theme) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, colorScheme: theme });
  await context.addInitScript((targetTheme) => {
    try {
      localStorage.setItem('mdw-theme', targetTheme);
    } catch (error) {
      // ignore storage write errors
    }
  }, theme);
  const page = await context.newPage();
  await page.goto(`${baseUrl}${pagePath}`, { waitUntil: 'networkidle' });
  return { browser, page };
}

async function main() {
  if (!BASELINE_ROOT || !CANDIDATE_ROOT) {
    throw new Error('BASELINE_ROOT and CANDIDATE_ROOT must be provided.');
  }

  const baselineServer = await startServer(BASELINE_ROOT, BASELINE_PORT);
  const candidateServer = await startServer(CANDIDATE_ROOT, CANDIDATE_PORT);

  try {
    for (const pageCase of PAGE_CASES) {
      const applicableViewports = VIEWPORTS.filter((entry) => !pageCase.viewports || pageCase.viewports.includes(entry.name));

      for (const viewport of applicableViewports) {
        for (const theme of THEMES) {
          const baselineCapture = await capturePage(`http://127.0.0.1:${BASELINE_PORT}`, pageCase.path, viewport, theme);
          const candidateCapture = await capturePage(`http://127.0.0.1:${CANDIDATE_PORT}`, pageCase.path, viewport, theme);

          try {
            const baselineState = await collectPageState(baselineCapture.page, pageCase.selectors);
            const candidateState = await collectPageState(candidateCapture.page, pageCase.selectors);

            if (baselineState.theme !== candidateState.theme) {
              throw new Error(`${pageCase.name}:${viewport.name}:${theme}: resolved theme mismatch (${baselineState.theme} !== ${candidateState.theme})`);
            }

            compareNumber(`${pageCase.name}:${viewport.name}:${theme}:scrollHeight`, baselineState.scrollHeight, candidateState.scrollHeight);

            pageCase.selectors.forEach((selector) => {
              compareSnapshot(`${pageCase.name}:${viewport.name}:${theme}`, selector, baselineState.snapshots[selector], candidateState.snapshots[selector]);
            });
          } finally {
            await baselineCapture.browser.close();
            await candidateCapture.browser.close();
          }
        }
      }
    }
  } finally {
    await new Promise((resolve) => baselineServer.close(resolve));
    await new Promise((resolve) => candidateServer.close(resolve));
  }

  console.log('Migration regression comparison passed for all configured pages, themes, and viewports.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
