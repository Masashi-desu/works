// テーマ設定とページ遷移演出をまとめて初期化する即時実行関数
(function () {
  const THEME_KEY = 'mdw-theme';
  const SELECTOR = '.theme-select';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const reduceMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  const TRANSITION_DURATION = 750;
  const PAGE_TRANSITION_DURATION = 600;
  const TRANSITION_PENDING_KEY = 'mdw-transition-pending';
  const WINDOW_TRANSITION_KEY = 'mdwTransitionPending';
  const BODY_FADE_CLASS = 'page-transition-fade';
  const BODY_VISIBLE_CLASS = 'page-transition-visible';
  const TRANSITION_EVENT = {
    ENTER_START: 'mdw:transition-enter-start',
    ENTER_COMPLETE: 'mdw:transition-enter-complete',
    EXIT_START: 'mdw:transition-exit-start',
    EXIT_COMPLETE: 'mdw:transition-exit-complete'
  };
  let activePreference = 'system';
  let transitionTimer = null;
  let pendingFrame = null;
  let themeOverlay = null;
  let pageTransitionInitialized = false;
  let pageTransitionExitTimer = null;
  let entranceCleanupTimer = null;
  let isEntranceActive = false;
  let hasPlayedInitialEntrance = false;

  // テーマ設定値をlight/dark/systemのいずれかに正規化する
  function normalizePreference(value) {
    return value === 'light' || value === 'dark' || value === 'system'
      ? value
      : 'system';
  }

  // ローカルストレージから保存済みのテーマ設定を取得する
  function readPreference() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (error) {
      return null;
    }
  }

  // テーマ設定をローカルストレージに保存する
  function persistPreference(value) {
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch (error) {
      /* ignore */
    }
  }

  // システム設定とユーザー指定から実際に適用するテーマを決定する
  function resolveTheme(preference) {
    if (preference === 'light' || preference === 'dark') {
      return preference;
    }
    return media.matches ? 'dark' : 'light';
  }

  // テーマ切り替え時に使用したタイマーやフレーム予約を解除する
  function clearTransitionTimers() {
    if (transitionTimer !== null) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
  }

  // テーマトランジション用オーバーレイ要素を作成・再利用して返す
  function ensureThemeOverlay() {
    if (!document.body) {
      return null;
    }
    if (themeOverlay && document.body.contains(themeOverlay)) {
      return themeOverlay;
    }
    themeOverlay = document.getElementById('mdw-theme-transition-overlay') || document.createElement('div');
    themeOverlay.id = 'mdw-theme-transition-overlay';
    themeOverlay.setAttribute('aria-hidden', 'true');
    themeOverlay.style.position = 'fixed';
    themeOverlay.style.inset = '0';
    themeOverlay.style.pointerEvents = 'none';
    themeOverlay.style.zIndex = '2147483646';
    themeOverlay.style.opacity = '0';
    themeOverlay.style.backgroundColor = 'transparent';
    themeOverlay.style.backgroundImage = 'none';
    themeOverlay.style.backgroundRepeat = 'no-repeat';
    themeOverlay.style.backgroundSize = 'cover';
    themeOverlay.style.willChange = 'opacity';
    document.body.appendChild(themeOverlay);
    return themeOverlay;
  }

  // オーバーレイ要素のスタイルを初期状態に戻す
  function resetThemeOverlay() {
    if (!themeOverlay) {
      return;
    }
    themeOverlay.style.transition = 'none';
    themeOverlay.style.opacity = '0';
    themeOverlay.style.backgroundColor = 'transparent';
    themeOverlay.style.backgroundImage = 'none';
    themeOverlay.style.backgroundPosition = '';
    themeOverlay.style.backgroundSize = '';
    themeOverlay.style.backgroundRepeat = '';
    themeOverlay.style.backgroundAttachment = '';
  }

  // 現在の背景スタイルをオーバーレイに写し取りフェードの準備をする
  function snapshotThemeOverlay() {
    const target = ensureThemeOverlay();
    if (!target) {
      return null;
    }
    const computed = window.getComputedStyle(document.body);
    target.style.transition = 'none';
    target.style.opacity = '1';
    target.style.backgroundColor = computed.backgroundColor || 'transparent';
    const backgroundImage = computed.backgroundImage;
    target.style.backgroundImage = backgroundImage && backgroundImage !== 'none' ? backgroundImage : 'none';
    target.style.backgroundPosition = computed.backgroundPosition || '';
    target.style.backgroundSize = computed.backgroundSize || '';
    target.style.backgroundRepeat = computed.backgroundRepeat || '';
    target.style.backgroundAttachment = computed.backgroundAttachment || '';
    // Force reflow before enabling the fade animation
    void target.offsetWidth;
    target.style.transition = `opacity ${TRANSITION_DURATION}ms linear`;
    return target;
  }

  // 実行中のテーマ遷移アニメーションを強制的に終了する
  function cancelThemeTransition() {
    clearTransitionTimers();
    root.classList.remove('theme-transition');
    resetThemeOverlay();
  }

  // 決定したテーマをDOM属性とセレクトUIに反映する
  function commitTheme(normalized) {
    const effective = resolveTheme(normalized);
    root.dataset.theme = effective;
    root.dataset.themePreference = normalized;
    syncSelects(normalized);
  }

  // ユーザー設定を適用し必要であればアニメーション付きでテーマを更新する
  function applyTheme(preference, options = {}) {
    const normalized = normalizePreference(preference);
    const { skipAnimation = false } = options;
    activePreference = normalized;
    const shouldAnimate = !skipAnimation && !reduceMotionMedia.matches;

    if (shouldAnimate && typeof window.requestAnimationFrame === 'function') {
      clearTransitionTimers();
      const overlayElement = snapshotThemeOverlay();
      root.classList.add('theme-transition');
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null;
        commitTheme(normalized);
        if (overlayElement) {
          overlayElement.style.opacity = '0';
        }
        transitionTimer = window.setTimeout(() => {
          cancelThemeTransition();
        }, TRANSITION_DURATION);
      });
    } else {
      cancelThemeTransition();
      commitTheme(normalized);
    }
  }

  // 全てのテーマ選択セレクト要素の表示値を同期する
  function syncSelects(value) {
    const selects = document.querySelectorAll(SELECTOR);
    selects.forEach((select) => {
      if (select.value !== value) {
        select.value = value;
      }
    });
  }

  // セレクトUIの変更イベントからテーマ設定を更新する
  function handleSelectChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.matches(SELECTOR)) {
      return;
    }
    const nextPreference = normalizePreference(target.value);
    persistPreference(nextPreference);
    applyTheme(nextPreference);
  }

  // システムのテーマ変更イベントに追随してテーマを再計算する
  function handleMediaChange() {
    if ((root.dataset.themePreference || 'system') === 'system') {
      applyTheme('system');
    }
  }

  // 他タブでの設定変更を感知しテーマを即時適用する
  function handleStorage(event) {
    if (event.key !== THEME_KEY) {
      return;
    }
    const newValue = event.newValue || 'system';
    applyTheme(newValue);
  }

  // 例外を吸収しながらストレージから値を取得する
  function safeStorageGet(store, key) {
    if (!store || typeof store.getItem !== 'function') {
      return null;
    }
    try {
      return store.getItem(key);
    } catch (error) {
      return null;
    }
  }

  // 例外を吸収しながらストレージに値を保存する
  function safeStorageSet(store, key, value) {
    if (!store || typeof store.setItem !== 'function') {
      return false;
    }
    try {
      store.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  // 例外を吸収しながらストレージから値を削除する
  function safeStorageRemove(store, key) {
    if (!store || typeof store.removeItem !== 'function') {
      return false;
    }
    try {
      store.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  // window.nameに格納されたページ状態を読み取る
  function readWindowState() {
    try {
      if (!window.name) {
        return {};
      }
      const parsed = JSON.parse(window.name);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return {};
    } catch (error) {
      return {};
    }
  }

  // ページ状態をwindow.nameに書き込み保存する
  function writeWindowState(updater) {
    const current = readWindowState();
    let next = typeof updater === 'function' ? updater(current) : updater;
    if (!next || typeof next !== 'object') {
      next = {};
    }
    try {
      window.name = JSON.stringify(next);
    } catch (error) {
      /* ignore */
    }
  }

  // ページ遷移中であることを示すフラグを読み取る
  function consumePendingTransitionFlag() {
    const fromSession = safeStorageGet(window.sessionStorage, TRANSITION_PENDING_KEY);
    const fromLocal = safeStorageGet(window.localStorage, TRANSITION_PENDING_KEY);
    const state = readWindowState();
    const fromWindow = state && typeof state === 'object' ? state[WINDOW_TRANSITION_KEY] : null;
    const hasPending = fromSession === '1' || fromLocal === '1' || fromWindow === '1';
    if (hasPending) {
      clearPendingTransitionFlag();
    }
    return hasPending;
  }

  // ページ遷移中フラグを保存する
  function persistPendingTransitionFlag() {
    safeStorageSet(window.sessionStorage, TRANSITION_PENDING_KEY, '1');
    safeStorageSet(window.localStorage, TRANSITION_PENDING_KEY, '1');
    writeWindowState((state) => ({
      ...state,
      [WINDOW_TRANSITION_KEY]: '1'
    }));
  }

  // ページ遷移中フラグを削除する
  function clearPendingTransitionFlag() {
    safeStorageRemove(window.sessionStorage, TRANSITION_PENDING_KEY);
    safeStorageRemove(window.localStorage, TRANSITION_PENDING_KEY);
    writeWindowState((state) => {
      if (!state || typeof state !== 'object' || !Object.prototype.hasOwnProperty.call(state, WINDOW_TRANSITION_KEY)) {
        return state;
      }
      const next = { ...state };
      delete next[WINDOW_TRANSITION_KEY];
      return next;
    });
  }

  // ページ遷移用のカスタムイベントをトリガーする
  function emitTransitionEvent(name, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (error) {
      /* ignore */
    }
  }

  // data-pressable要素などをキーボード操作可能にする
  function ensurePressableFocus(root) {
    const targets = Array.isArray(root) ? root : [root || document];
    targets.forEach((entry) => {
      const scope = entry instanceof Element ? entry : document;
      const pressables = scope.querySelectorAll('[data-pressable], [data-transition-direction]');
      pressables.forEach((pressable) => {
        if (pressable.getAttribute('tabindex') === null || pressable.tabIndex < 0) {
          pressable.tabIndex = 0;
        }
      });
    });
  }

  let initialPreference = readPreference();
  if (initialPreference !== 'light' && initialPreference !== 'dark' && initialPreference !== 'system') {
    initialPreference = 'system';
  }

  applyTheme(initialPreference, { skipAnimation: true });
  document.addEventListener('change', handleSelectChange);

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handleMediaChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(handleMediaChange);
  }

  if (typeof reduceMotionMedia.addEventListener === 'function') {
    reduceMotionMedia.addEventListener('change', () => {
      if (reduceMotionMedia.matches) {
        cancelThemeTransition();
      }
    });
  } else if (typeof reduceMotionMedia.addListener === 'function') {
    reduceMotionMedia.addListener((event) => {
      if (event.matches) {
        cancelThemeTransition();
      }
    });
  }

  window.addEventListener('storage', handleStorage);

  // ページ遷移アニメーションと関連イベントを初期化する
  function initPageTransitions() {
    if (pageTransitionInitialized) {
      return;
    }
    if (reduceMotionMedia.matches || !document.body) {
      return;
    }

    pageTransitionInitialized = true;

    const body = document.body;

    let isNavigating = false;
    let contentTargets = [];

    // 入場アニメーションの後処理タイマーを停止する
    function cancelEntranceCleanup() {
      if (entranceCleanupTimer !== null) {
        window.clearTimeout(entranceCleanupTimer);
        entranceCleanupTimer = null;
      }
    }

    // 遷移対象要素の一時的な変更を片付ける
    function finalizeContentTargets() {
      if (!contentTargets || contentTargets.length === 0) {
        contentTargets = [];
        return;
      }
      contentTargets.forEach((el) => {
        el.classList.remove('page-transition-target');
        el.style.removeProperty('--page-transition-order');
      });
      contentTargets = [];
    }

    // ボディとターゲット要素のフェード状態を初期化する
    function resetEntranceVisuals(options = {}) {
      const { reveal = true } = options;
      cancelEntranceCleanup();
      isEntranceActive = false;
      if (body) {
        if (reveal) {
          body.classList.add(BODY_VISIBLE_CLASS);
          body.classList.remove(BODY_FADE_CLASS);
        } else {
          body.classList.remove(BODY_VISIBLE_CLASS);
          body.classList.add(BODY_FADE_CLASS);
        }
      }
      finalizeContentTargets();
    }

    // 入場アニメーション完了時の状態更新とイベント発火を行う
    function finalizeEntranceState() {
      resetEntranceVisuals({ reveal: true });
      emitTransitionEvent(TRANSITION_EVENT.ENTER_COMPLETE, {});
    }

    // 入場アニメーション後の後処理をスケジュールする
    function scheduleEntranceCleanup() {
      cancelEntranceCleanup();
      entranceCleanupTimer = window.setTimeout(() => {
        finalizeEntranceState();
      }, PAGE_TRANSITION_DURATION + 120);
    }

    // ページ遷移対象となる要素群を抽出する
    function collectContentTargets() {
      if (!body) {
        return [];
      }
      const explicit = Array.from(document.querySelectorAll('[data-transition-fade]'));
      const direct = Array.from(body.children).filter((el) => {
        if (el.matches('script, style, link')) {
          return false;
        }
        if (el.hasAttribute('data-transition-ignore')) {
          return false;
        }
        return true;
      });
      const merged = [];
      const seen = new Set();
      [...explicit, ...direct].forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          merged.push(el);
        }
      });
      return merged;
    }

    // 遷移対象要素にアニメーション用のクラスと順序を設定する
    function prepareContentTargets(shouldAnimate) {
      contentTargets = collectContentTargets();
      contentTargets.forEach((el, index) => {
        if (!shouldAnimate) {
          el.classList.remove('page-transition-target');
          el.style.removeProperty('--page-transition-order');
          return;
        }
        el.classList.add('page-transition-target');
        el.style.setProperty('--page-transition-order', String(index));
      });
    }

    // requestAnimationFrameが2回実行されるまで待機してからコールバックを呼ぶ
    function doubleRaf(callback) {
      if (typeof callback !== 'function') {
        return;
      }
      let finished = false;
      let timeoutId = null;
      const finalize = () => {
        if (finished) {
          return;
        }
        finished = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        callback();
      };
      const raf = window.requestAnimationFrame;
      if (typeof raf === 'function') {
        raf(() => {
          raf(finalize);
        });
        timeoutId = window.setTimeout(finalize, 48);
      } else {
        timeoutId = window.setTimeout(finalize, 34);
      }
    }

    // ページ遷移の出口タイマーを解除する
    function clearExitTimer() {
      if (pageTransitionExitTimer !== null) {
        window.clearTimeout(pageTransitionExitTimer);
        pageTransitionExitTimer = null;
      }
    }

    // 入場演出用にボディのクラスを整える
    function stageBodyForEntrance() {
      if (!body) {
        return;
      }
      body.classList.add(BODY_FADE_CLASS);
      body.classList.remove(BODY_VISIBLE_CLASS);
      doubleRaf(() => {
        body.classList.add(BODY_VISIBLE_CLASS);
      });
    }

    // ボディ全体をフェードアウトさせる
    function fadeBodyOut() {
      if (!body) {
        return;
      }
      body.classList.add(BODY_FADE_CLASS);
      body.classList.remove(BODY_VISIBLE_CLASS);
    }

    // 入場アニメーションを再生する
    function playEntrance() {
      clearExitTimer();
      isNavigating = false;
      cancelEntranceCleanup();
      let shouldAnimate = consumePendingTransitionFlag();
      if (!hasPlayedInitialEntrance && !shouldAnimate) {
        shouldAnimate = true;
      }
      hasPlayedInitialEntrance = true;
      if (!shouldAnimate) {
        resetEntranceVisuals({ reveal: true });
        return;
      }
      resetEntranceVisuals({ reveal: false });
      prepareContentTargets(true);
      isEntranceActive = true;
      emitTransitionEvent(TRANSITION_EVENT.ENTER_START, {});
      stageBodyForEntrance();
      scheduleEntranceCleanup();
    }

    // 指定したURLへ遷移する
    function navigate(url) {
      window.location.href = url;
    }

    // 出口アニメーションを開始し完了後に画面遷移する
    function playExit(url) {
      if (isNavigating) {
        return;
      }
      isNavigating = true;
      clearExitTimer();
      resetEntranceVisuals({ reveal: true });
      persistPendingTransitionFlag();
      emitTransitionEvent(TRANSITION_EVENT.EXIT_START, {});
      fadeBodyOut();
      pageTransitionExitTimer = window.setTimeout(() => {
        emitTransitionEvent(TRANSITION_EVENT.EXIT_COMPLETE, {});
        navigate(url);
      }, PAGE_TRANSITION_DURATION - 40);
    }

    // 遷移アニメーションを適用すべきでないリンクを判定する
    function shouldSkipLink(anchor, event) {
      if (!anchor) {
        return true;
      }
      if (anchor.dataset.transition === 'instant') {
        return true;
      }
      if (anchor.hasAttribute('download')) {
        return true;
      }
      if (anchor.target && anchor.target !== '_self') {
        return true;
      }
      if (event.defaultPrevented || event.button !== 0) {
        return true;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return true;
      }
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return true;
      }
      if (href.startsWith('javascript:')) {
        return true;
      }
      const url = anchor.href;
      if (!url) {
        return true;
      }
      try {
        const targetUrl = new URL(url, window.location.href);
        if (targetUrl.origin !== window.location.origin) {
          return true;
        }
        if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search && targetUrl.hash !== '') {
          return true;
        }
      } catch (error) {
        return true;
      }
      return false;
    }

    // リンククリックイベントをフックしてカスタム遷移を実行する
    function handleLinkClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest('a');
      if (shouldSkipLink(anchor, event)) {
        return;
      }
      event.preventDefault();
      playExit(anchor.href);
    }

    // ページ復帰時に入場アニメーションを調整する
    function handlePageShow(event) {
      isNavigating = false;
      if (!event.persisted) {
        return;
      }
      playEntrance();
    }

    // 動きの制限設定が有効になった際に遷移演出を停止する
    function handleReduceMotionChange(event) {
      if (!event.matches) {
        return;
      }
      clearExitTimer();
      document.removeEventListener('click', handleLinkClick, true);
      window.removeEventListener('pageshow', handlePageShow);
      if (body) {
        body.classList.remove(BODY_FADE_CLASS, BODY_VISIBLE_CLASS);
      }
      finalizeEntranceState();
      prepareContentTargets(false);
      clearPendingTransitionFlag();
    }

    document.addEventListener('click', handleLinkClick, true);
    window.addEventListener('pageshow', handlePageShow);
    if (typeof reduceMotionMedia.addEventListener === 'function') {
      reduceMotionMedia.addEventListener('change', handleReduceMotionChange);
    } else if (typeof reduceMotionMedia.addListener === 'function') {
      reduceMotionMedia.addListener(handleReduceMotionChange);
    }

    playEntrance();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageTransitions, { once: true });
  } else {
    initPageTransitions();
  }

  window.mdwTheme = {
    // 現在のテーマを即時再適用しフォーカス可能要素を整える
    refresh(options = {}) {
      applyTheme(activePreference, { skipAnimation: true });
      ensurePressableFocus(options.root);
    },
    // 指定テーマを保存し必要に応じてアニメーション付きで適用する
    set(preference, options = {}) {
      const normalized = normalizePreference(preference);
      if (normalized !== preference) {
        persistPreference(normalized);
      } else {
        persistPreference(preference);
      }
      const skipAnimation = options.animate === false;
      applyTheme(normalized, { skipAnimation });
      ensurePressableFocus(options.root);
    },
    // 指定範囲に含まれる押下可能要素へフォーカスを付与できるよう調整する
    focusPressables(root) {
      ensurePressableFocus(root);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensurePressableFocus();
    }, { once: true });
  } else {
    ensurePressableFocus();
  }

  window.addEventListener('mdw:footer-loaded', (event) => {
    ensurePressableFocus(event && event.detail ? event.detail.root : undefined);
  });
})();

// 言語切り替え時のトランジションを管理する即時実行関数
(function () {
  const DEFAULT_DURATION = 320;
  const reduceMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  // ユーザーがモーション削減を要求しているかを判定する
  function prefersReducedMotion() {
    return reduceMotionQuery ? reduceMotionQuery.matches : false;
  }

  // アニメーションの継続時間を正の数値に整える
  function normalizeDuration(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : DEFAULT_DURATION;
  }

  // 言語変更時のフェードトランジション制御を提供する
  function createLanguageTransition(updateFn, options = {}) {
    if (typeof updateFn !== 'function') {
      throw new TypeError('updateFn must be a function');
    }
    const duration = normalizeDuration(options.duration);
    let isAnimating = false;
    let pending = null;
    let lastLocale;
    let fadeOutTimer = null;
    let fadeInTimer = null;
    const orphanOverlay = typeof document !== 'undefined'
      ? document.getElementById('mdw-lang-transition-overlay')
      : null;
    if (orphanOverlay && orphanOverlay.parentNode) {
      orphanOverlay.parentNode.removeChild(orphanOverlay);
    }

    // 遅延タイマーをまとめて解除する
    function clearTimers() {
      if (fadeOutTimer !== null) {
        window.clearTimeout(fadeOutTimer);
        fadeOutTimer = null;
      }
      if (fadeInTimer !== null) {
        window.clearTimeout(fadeInTimer);
        fadeInTimer = null;
      }
    }

    // アニメーション終了後のクリーンアップを行う
    function cleanup(body) {
      clearTimers();
      isAnimating = false;
      if (body) {
        body.removeAttribute('data-lang-transition');
        body.style.removeProperty('--lang-transition-duration');
      }
      const next = pending;
      pending = null;
      if (next) {
        apply(next.locale, { ...next.options, animate: true });
      }
    }

    // 指定ロケールの適用と必要に応じた遷移アニメーションを実行する
    function apply(locale, applyOptions = {}) {
      const targetLocale = locale;
      const animate = Boolean(applyOptions.animate);
      const body = document.body;

      if (isAnimating) {
        pending = { locale: targetLocale, options: applyOptions };
        return;
      }

      const shouldAnimate = animate && body && !prefersReducedMotion() && targetLocale !== lastLocale;
      if (!shouldAnimate) {
        clearTimers();
        lastLocale = updateFn(targetLocale, applyOptions) || targetLocale;
        return;
      }

      isAnimating = true;
      clearTimers();
      body.style.setProperty('--lang-transition-duration', `${duration}ms`);
      body.setAttribute('data-lang-transition', 'out');
      void body.offsetWidth; // Safari にフェーズ初期化を伝える
      fadeOutTimer = window.setTimeout(() => {
        lastLocale = updateFn(targetLocale, applyOptions) || targetLocale;
        if (!body) {
          cleanup(body);
          return;
        }
        void body.offsetWidth;
        window.requestAnimationFrame(() => {
          if (!body) {
            cleanup(body);
            return;
          }
          body.setAttribute('data-lang-transition', 'ready');
          void body.offsetWidth;
          window.requestAnimationFrame(() => {
            if (!body) {
              cleanup(body);
              return;
            }
            void body.offsetWidth;
            body.setAttribute('data-lang-transition', 'in');
            fadeInTimer = window.setTimeout(() => {
              cleanup(body);
            }, duration);
          });
        });
      }, duration);
    }

    return { apply };
  }

  window.MDWLanguageTransition = {
    // 言語切り替え用のトランジションインスタンスを生成する
    create(updateFn, options) {
      return createLanguageTransition(updateFn, options);
    }
  };

  if (reduceMotionQuery && typeof reduceMotionQuery.addEventListener === 'function') {
    reduceMotionQuery.addEventListener('change', () => {
      if (prefersReducedMotion()) {
        document.body && document.body.removeAttribute('data-lang-transition');
      }
    });
  }
})();
