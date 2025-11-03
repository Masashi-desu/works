#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'partials', 'meta-template.html');
const META_CONFIG_COMMENT = /<!--\s*mdw:meta-config\s*([\s\S]*?)\s*-->/i;
const START_MARKER = '<!-- mdw:meta:start -->';
const END_MARKER = '<!-- mdw:meta:end -->';

async function main() {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const files = await collectHtmlFiles(ROOT);
  let updatedCount = 0;

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    if (relative.startsWith('node_modules/')) {
      continue;
    }
    const original = await fs.readFile(file, 'utf8');
    if (!original.includes('mdw:meta-config')) {
      continue;
    }

    const configMatch = original.match(META_CONFIG_COMMENT);
    if (!configMatch) {
      console.warn(`[meta] Skipping ${relative}: config comment malformed.`);
      continue;
    }

    let config;
    try {
      config = JSON.parse(configMatch[1]);
    } catch (error) {
      console.warn(`[meta] Skipping ${relative}: failed to parse config JSON.`);
      continue;
    }

    const startIndex = original.indexOf(START_MARKER);
    const endIndex = original.indexOf(END_MARKER);
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      console.warn(`[meta] Skipping ${relative}: missing start/end markers.`);
      continue;
    }

    const indent = getIndent(original, startIndex);
    const populated = populateTemplate(template, config);
    const indentedBlock = populated
      .split('\n')
      .map((line) => (line ? indent + line : line))
      .join('\n');

    const before = original.slice(0, startIndex + START_MARKER.length);
    const after = original.slice(endIndex);
    const next = `${before}\n${indentedBlock}\n${indent}${after}`;

    if (next !== original) {
      await fs.writeFile(file, next, 'utf8');
      updatedCount += 1;
      console.log(`[meta] Updated ${relative}`);
    }
  }

  if (updatedCount === 0) {
    console.log('[meta] No files required updates.');
  }
}

function getIndent(content, markerIndex) {
  const newlineIndex = content.lastIndexOf('\n', markerIndex);
  if (newlineIndex === -1) {
    return '';
  }
  const lineStart = newlineIndex + 1;
  const indentMatch = content
    .slice(lineStart, markerIndex)
    .match(/^[\t ]*/u);
  return indentMatch ? indentMatch[0] : '';
}

function populateTemplate(template, config) {
  const data = buildTemplateData(config);
  let populated = template;

  for (const [key, value] of Object.entries(data)) {
    const pattern = new RegExp(`{{${escapeRegExp(key)}}}`, 'g');
    populated = populated.replace(pattern, value);
  }

  populated = populated
    .replace(/^[\t ]*\n/gm, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n');

  return populated;
}

function buildTemplateData(rawConfig) {
  const config = {
    siteName: 'Masahi Desu Works',
    locale: 'ja_JP',
    alternateLocales: [],
    twitterCard: 'summary_large_image',
    ogType: 'website',
    twitterSite: '',
    twitterCreator: '',
    structuredData: null,
    ...rawConfig,
  };

  const alternateLocales = Array.isArray(config.alternateLocales)
    ? config.alternateLocales
    : [];
  const alternateLocalesMarkup = alternateLocales
    .map((locale) => `<meta property="og:locale:alternate" content="${escapeHtml(locale)}">`)
    .join('\n');

  const imageMeta = [];
  if (config.image) {
    imageMeta.push(`<meta property="og:image" content="${escapeHtml(config.image)}">`);
    if (config.imageAlt) {
      imageMeta.push(`<meta property="og:image:alt" content="${escapeHtml(config.imageAlt)}">`);
    }
    if (config.imageWidth) {
      imageMeta.push(`<meta property="og:image:width" content="${escapeHtml(String(config.imageWidth))}">`);
    }
    if (config.imageHeight) {
      imageMeta.push(`<meta property="og:image:height" content="${escapeHtml(String(config.imageHeight))}">`);
    }
    imageMeta.push(`<meta name="twitter:image" content="${escapeHtml(config.image)}">`);
    if (config.imageAlt) {
      imageMeta.push(`<meta name="twitter:image:alt" content="${escapeHtml(config.imageAlt)}">`);
    }
  }

  const twitterSiteMeta = config.twitterSite
    ? `<meta name="twitter:site" content="${escapeHtml(config.twitterSite)}">`
    : '';
  const twitterCreatorMeta = config.twitterCreator
    ? `<meta name="twitter:creator" content="${escapeHtml(config.twitterCreator)}">`
    : '';

  const articleMeta = [];
  if (config.published) {
    articleMeta.push(`<meta property="article:published_time" content="${escapeHtml(config.published)}">`);
  }
  if (config.modified) {
    articleMeta.push(`<meta property="article:modified_time" content="${escapeHtml(config.modified)}">`);
  }

  let structuredDataMarkup = '';
  if (config.structuredData) {
    const json =
      typeof config.structuredData === 'string'
        ? config.structuredData
        : JSON.stringify(config.structuredData, null, 2);
    structuredDataMarkup = `<script type="application/ld+json">\n${json}\n</script>`;
  }

  return {
    description: escapeHtml(config.description || ''),
    siteName: escapeHtml(config.siteName || 'Masahi Desu Works'),
    ogType: escapeHtml(config.ogType || 'website'),
    locale: escapeHtml(config.locale || 'ja_JP'),
    alternateLocales: alternateLocalesMarkup,
    title: escapeHtml(config.title || ''),
    url: escapeHtml(config.url || ''),
    imageMeta: imageMeta.join('\n'),
    twitterCard: escapeHtml(config.twitterCard || 'summary_large_image'),
    twitterSiteMeta,
    twitterCreatorMeta,
    twitterImageMeta: '', // included with imageMeta above
    articleMeta: articleMeta.join('\n'),
    structuredData: structuredDataMarkup,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function collectHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      const nested = await collectHtmlFiles(entryPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(entryPath);
    }
  }

  return files;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
