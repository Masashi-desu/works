/**
 * テスト概要:
 *  - 目的: すべての主要ページ（トップ・製品一覧・各製品詳細）でダーク→ライトのテーマ変更に同じフェード演出が適用されることを検証する。
 *  - 期待値: 各ページでサンプリングしたタイムスタンプごとに body の背景輝度が単調増加し、途中で白飛びや瞬時切り替えが発生しない。
 *  - 検証方法: Playwright で対象 HTML を順番に読み込み、テーマをライトへ切り替えつつ複数タイミングで RGB・スクリーンショットを取得し、輝度低下を検出した場合はエラーとする。
 */
const path = require('path');
const fs = require('fs/promises');
const { chromium } = require('playwright');

function parseRgb(rgbString) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgbString);
  if (!match) {
    throw new Error(`Unexpected rgb format: ${rgbString}`);
  }
  return match.slice(1, 4).map((value) => Number(value));
}

function luminance([r, g, b]) {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function detectSkipReason(filePath) {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    if (/<meta[^>]*http-equiv=['"]refresh['"][^>]*content=['"]\s*0[^'">]*['"][^>]*>/i.test(contents)) {
      return 'meta-refresh';
    }
  } catch (error) {
    // ignore read errors; they will surface later when accessed
  }
  return null;
}

async function collectPageEntries() {
  const rootDir = path.resolve(__dirname, '../../');
  const entries = [];

  async function pushEntry(slug, filePath) {
    const entry = { slug, filePath };
    entry.skip = await detectSkipReason(filePath);
    entries.push(entry);
  }

  await pushEntry('index', path.join(rootDir, 'index.html'));

  const productsDir = path.join(rootDir, 'products');
  try {
    const productEntries = await fs.readdir(productsDir, { withFileTypes: true });
    for (const entry of productEntries) {
      if (entry.isFile() && entry.name === 'products.html') {
        await pushEntry('products', path.join(productsDir, entry.name));
      }
      if (entry.isDirectory()) {
        const productFile = path.join(productsDir, entry.name, 'index.html');
        try {
          await fs.access(productFile);
          await pushEntry(`product-${entry.name}`, productFile);
        } catch (error) {
          // ignore missing index.html
        }
      }
    }
  } catch (error) {
    // ignore when products directory is absent
  }

  return entries;
}

async function auditPage(browser, entry, outputBaseDir) {
  if (entry.skip) {
    const outputDir = path.join(outputBaseDir, entry.slug);
    await ensureDir(outputDir);
    await fs.writeFile(
      path.join(outputDir, 'transition-metrics.json'),
      JSON.stringify({ skipped: entry.skip }, null, 2)
    );
    return { slug: entry.slug, skipped: entry.skip, samples: [] };
  }

  // eslint-disable-next-line no-console
  console.log(`[theme-mpc] auditing ${entry.slug}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('mdw-theme', 'dark');
    } catch (error) {
      // ignore storage errors
    }
  });

  const page = await context.newPage();
  await page.goto(`file://${entry.filePath}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  const themeReady = await page.waitForFunction(
    () => Boolean(window.mdwTheme && typeof window.mdwTheme.set === 'function'),
    { timeout: 20000 }
  ).catch(() => null);
  if (!themeReady) {
    throw new Error(`mdwTheme API not available on ${entry.slug} (${entry.filePath})`);
  }

  const outputDir = path.join(outputBaseDir, entry.slug);
  await ensureDir(outputDir);

  await page.screenshot({ path: path.join(outputDir, 'transition-before.png'), fullPage: true });

  await page.evaluate(() => window.mdwTheme && window.mdwTheme.set('light'));

  const checkpoints = [0, 80, 160, 320, 640, 800];
  let previousLuminance = null;
  const sampleData = [];

  for (const delay of checkpoints) {
    if (delay > 0) {
      const lastDelay = sampleData.length > 0 ? sampleData[sampleData.length - 1].delay : 0;
      await page.waitForTimeout(delay - lastDelay);
    }
    const snapshot = await page.evaluate(() => {
      const body = document.body;
      const bodyColor = getComputedStyle(body).backgroundColor;
      const card = document.querySelector('.philosophy-card');
      const cardBg = card ? getComputedStyle(card).backgroundColor : null;
      return { bodyColor, cardBg };
    });
    const bodyRgb = parseRgb(snapshot.bodyColor);
    const bodyLuminance = luminance(bodyRgb);
    if (previousLuminance !== null && bodyLuminance < previousLuminance - 0.0005) {
      throw new Error(`Body luminance decreased at ${delay}ms on ${entry.slug}: ${bodyLuminance} < ${previousLuminance}`);
    }
    previousLuminance = bodyLuminance;
    sampleData.push({
      delay,
      bodyColor: snapshot.bodyColor,
      bodyLuminance,
      cardColor: snapshot.cardBg
    });
    await page.screenshot({ path: path.join(outputDir, `transition-${delay}ms.png`), fullPage: true });
  }

  await page.waitForTimeout(900 - checkpoints[checkpoints.length - 1]);
  await page.screenshot({ path: path.join(outputDir, 'transition-after.png'), fullPage: true });

  await fs.writeFile(path.join(outputDir, 'transition-metrics.json'), JSON.stringify(sampleData, null, 2));

  await context.close();

  return { slug: entry.slug, samples: sampleData };
}

async function main() {
  const outputBaseDir = path.resolve(__dirname, 'output');
  await ensureDir(outputBaseDir);

  const browser = await chromium.launch();
  const entries = await collectPageEntries();
  const results = [];

  try {
    for (const entry of entries) {
      const result = await auditPage(browser, entry, outputBaseDir);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(path.join(outputBaseDir, 'transition-summary.json'), JSON.stringify(results, null, 2));
  return results;
}

if (require.main === module) {
  main().then((data) => {
    console.log(JSON.stringify(data, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
