#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const OUTPUT_PATH = path.resolve(__dirname, '..', 'assets', 'social', 'site-default.png');
const VIEWPORT = { width: 1200, height: 630, deviceScaleFactor: 2 };

async function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function generate() {
  await ensureDirExists(OUTPUT_PATH);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; }
        html, body {
          height: 100%;
          margin: 0;
        }
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at 20% 20%, rgba(56, 249, 215, 0.35), transparent 55%),
                      radial-gradient(circle at 85% 40%, rgba(99, 102, 241, 0.45), transparent 60%),
                      linear-gradient(135deg, #0f172a, #182a4a 45%, #214d6b 68%, #38f9d7 100%);
          font-family: 'Outfit', 'Inter', 'Helvetica Neue', system-ui, -apple-system, sans-serif;
          color: #f8fafc;
        }
        .card {
          width: 1080px;
          padding: 88px 120px;
          border-radius: 40px;
          background: rgba(10, 18, 35, 0.55);
          backdrop-filter: blur(28px);
          box-shadow: 0 50px 120px -60px rgba(56, 249, 215, 0.35), 0 30px 80px -60px rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.25);
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .headline {
          font-size: 72px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin: 0;
        }
        .subline {
          font-size: 26px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          margin: 0;
          color: rgba(226, 232, 240, 0.75);
        }
        .footer {
          margin-top: auto;
          display: flex;
          gap: 24px;
          align-items: center;
          font-size: 20px;
          color: rgba(226, 232, 240, 0.65);
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
        .glow {
          width: 54px;
          height: 54px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(56, 249, 215, 0.95), rgba(99, 102, 241, 0.85));
          box-shadow: 0 20px 40px -16px rgba(56, 249, 215, 0.6);
        }
      </style>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap" rel="stylesheet">
    </head>
    <body>
      <div class="card">
        <p class="subline">Designing Ideas Into Motion</p>
        <h1 class="headline">Masahi_desu Works</h1>
        <div class="footer">
          <div class="glow"></div>
          <span>macOS Tools</span>
          <span>Hardware Prototypes</span>
        </div>
      </div>
    </body>
    </html>
  `;

  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUTPUT_PATH, type: 'png' });
  await browser.close();
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
