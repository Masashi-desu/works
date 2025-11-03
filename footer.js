(function () {
  async function injectFooter(footerEl) {
    const src = footerEl.dataset.footerSrc || 'partials/footer.html';
    let injectedRoots = [];
    try {
      const response = await fetch(src, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Failed to fetch footer: ${response.status}`);
      }
      const markup = await response.text();
      const template = document.createElement('template');
      template.innerHTML = markup.trim();
      const fragment = template.content;
      injectedRoots = Array.from(fragment.children);
      if (injectedRoots.length === 0) {
        throw new Error('Footer markup did not contain any root elements.');
      }
      footerEl.replaceWith(fragment);
    } catch (error) {
      console.error(error);
      footerEl.innerHTML = '<p class="text-xs text-slate-400">Footer failed to load.</p>';
      injectedRoots = [footerEl];
    }

    if (window.mdwTheme && typeof window.mdwTheme.refresh === 'function') {
      window.mdwTheme.refresh();
    }

    const rootDetail = injectedRoots.length === 1 ? injectedRoots[0] : injectedRoots;
    const event = new CustomEvent('mdw:footer-loaded', { detail: { root: rootDetail } });
    window.dispatchEvent(event);
  }

  function init() {
    const targets = document.querySelectorAll('[data-include="footer"]');
    targets.forEach((el) => {
      injectFooter(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
