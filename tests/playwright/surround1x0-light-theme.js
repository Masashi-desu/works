/**
 * テスト概要:
 *  - 目的: Surround1x0-AKDK 詳細ページをライトテーマで開いた際のヒーロー記事が、アクセント寄りのシャドウとグローを保持しているか確認する。
 *  - 期待値: 記事カードの box-shadow / --tw-shadow およびグローレイヤーの background-color がライトテーマ用のオレンジ系に設定されている。
 *  - 検証方法: Playwright で該当ページをローカルパスから読み込み、計測したスタイル値をログ出力しスクリーンショットを保存する。
 */
const path = require('path');
const { chromium } = require('playwright');

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
    const glow = document.querySelector('[class*="bg-accent/20"]');
    const articleBoxShadow = article ? getComputedStyle(article).boxShadow : null;
    const articleTwShadow = article ? getComputedStyle(article).getPropertyValue('--tw-shadow') : null;
    const glowColor = glow ? getComputedStyle(glow).backgroundColor : null;
    return { articleBoxShadow, articleTwShadow, glowColor, theme: document.documentElement.dataset.theme };
  });

  const screenshotPath = path.resolve(__dirname, 'output/light.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();
  console.log(JSON.stringify(measurements, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
