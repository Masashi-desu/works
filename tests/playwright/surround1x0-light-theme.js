/**
 * テスト概要:
 *  - 目的: Surround1x0-AKDK 詳細ページをライトテーマで開いた際のヒーロー記事が、アクセント寄りのシャドウとグローを保持しているか確認する。
 *  - 期待値: 記事カードの box-shadow と背景グローレイヤーの background-color がライトテーマ用のオレンジ系に設定されている。
 *  - 検証方法: Playwright で該当ページをローカルパスから読み込み、計測したスタイル値を検証してスクリーンショットを保存する。
 */
const path = require('path');
const { chromium } = require('playwright');

function parseChannels(input) {
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
}

function assertWarmTone(channels, label) {
  if (!channels) {
    throw new Error(`${label} is missing`);
  }
  if (!(channels.r > channels.g && channels.g >= channels.b)) {
    throw new Error(`${label} should be warm-toned, got ${channels.raw}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ colorScheme: 'light' });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('mdw-theme', 'light');
    } catch (error) {
      // ignore storage write errors
    }
  });

  const page = await context.newPage();
  const filePath = path.resolve(__dirname, '../../products/Surround1x0-AKDK/index.html');
  await page.goto(`file://${filePath}`);
  await page.waitForTimeout(500);

  const measurements = await page.evaluate(() => {
    const article = document.querySelector('article');
    const glow = document.querySelector('.page-orb--surround-accent');
    const articleBoxShadow = article ? getComputedStyle(article).boxShadow : null;
    const glowColor = glow ? getComputedStyle(glow).backgroundColor : null;
    return { articleBoxShadow, glowColor, theme: document.documentElement.dataset.theme };
  });

  const articleShadow = parseChannels(measurements.articleBoxShadow);
  const glowColor = parseChannels(measurements.glowColor);

  if (measurements.theme !== 'light') {
    throw new Error(`Expected light theme, got ${measurements.theme}`);
  }

  assertWarmTone(articleShadow, 'Article shadow');
  assertWarmTone(glowColor, 'Glow color');

  const screenshotPath = path.resolve(__dirname, 'output/light.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();
  console.log(JSON.stringify({ ...measurements, articleShadow, glowColor }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
