/*
 * Segmented scroll navigation
 *
 * The core deliberately knows nothing about page selectors, product data, history
 * rules, or carousel implementations. Pages describe ordered stops and inject the
 * few policies that differ between screens.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MDWSegmentedScroll = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_TIMINGS = Object.freeze({
    navigationLockMs: 720,
    settleMs: 640,
    wheelThreshold: 86,
    wheelResetMs: 180,
    touchThreshold: 48,
    touchIntentThreshold: 10,
    touchMomentumSettleMs: 520,
    alignmentFrames: 36,
    touchActivityStaleMs: 1100,
    verticalIntentRatio: 1.25,
    zoomThreshold: 1.02
  });

  const DEFAULT_OBSERVER_THRESHOLDS = Object.freeze([0.42, 0.58, 0.72]);

  function createStopIndex(options = {}) {
    let stops = [];
    let activeId = options.initialId || '';
    let activeContentId = options.initialContentId || '';

    function setStops(nextStops) {
      const normalized = Array.isArray(nextStops) ? nextStops.filter(Boolean) : [];
      const ids = new Set();
      normalized.forEach((stop) => {
        if (!stop || typeof stop.id !== 'string' || !stop.id) {
          throw new TypeError('Each segmented scroll stop requires a non-empty string id.');
        }
        if (ids.has(stop.id)) {
          throw new Error(`Duplicate segmented scroll stop id: ${stop.id}`);
        }
        ids.add(stop.id);
      });
      stops = normalized.slice();

      const fallback = getById(options.initialId) || getFirstContentStop() || stops[0] || null;
      if (!getById(activeId)) {
        activeId = fallback ? fallback.id : '';
      }
      const activeContent = getById(activeContentId);
      if (!activeContent || getRole(activeContent) !== 'content') {
        const active = getById(activeId);
        activeContentId = active && getRole(active) === 'content'
          ? active.id
          : ((getFirstContentStop() || {}).id || '');
      }
      if (activeId) {
        activate(activeId);
      }
      return getState();
    }

    function getStops() {
      return stops.slice();
    }

    function getById(id) {
      return stops.find((stop) => stop.id === id) || null;
    }

    function getFirstContentStop() {
      return stops.find((stop) => getRole(stop) === 'content') || null;
    }

    function activate(id) {
      const stop = getById(id);
      if (!stop) {
        return null;
      }
      activeId = stop.id;
      if (getRole(stop) === 'content') {
        activeContentId = stop.id;
      } else {
        const anchoredContent = resolveContentAnchor(stop);
        if (anchoredContent) {
          activeContentId = anchoredContent.id;
        }
      }
      return stop;
    }

    function resolveContentAnchor(stop) {
      if (typeof stop.contentAnchor === 'function') {
        const requestedId = stop.contentAnchor({
          stop,
          stops: getStops(),
          activeContentId
        });
        const requested = getById(requestedId);
        return requested && getRole(requested) === 'content' ? requested : null;
      }
      if (typeof stop.contentAnchor === 'string' && stop.contentAnchor !== 'previous') {
        const requested = getById(stop.contentAnchor);
        return requested && getRole(requested) === 'content' ? requested : null;
      }
      if (stop.contentAnchor !== 'previous') {
        return null;
      }
      const stopIndex = stops.indexOf(stop);
      for (let index = stopIndex - 1; index >= 0; index -= 1) {
        if (getRole(stops[index]) === 'content') {
          return stops[index];
        }
      }
      return null;
    }

    function getOrderedStops(readTop) {
      if (typeof readTop !== 'function') {
        return stops.slice();
      }
      return stops
        .map((stop, order) => ({
          ...stop,
          top: Number(readTop(stop)),
          __order: order
        }))
        .filter((stop) => Number.isFinite(stop.top))
        .sort((left, right) => left.top - right.top || left.__order - right.__order)
        .map(({ __order, ...stop }) => stop);
    }

    function findDirectional(direction, currentTop, preferredId, readTop) {
      if (direction === 0) {
        return null;
      }
      const ordered = getOrderedStops(readTop);
      if (preferredId) {
        const preferredIndex = ordered.findIndex((stop) => stop.id === preferredId);
        if (preferredIndex >= 0) {
          return ordered[preferredIndex + direction] || null;
        }
      }
      const tolerance = 1;
      if (direction > 0) {
        return ordered.find((stop) => stop.top > currentTop + tolerance) || null;
      }
      for (let index = ordered.length - 1; index >= 0; index -= 1) {
        if (ordered[index].top < currentTop - tolerance) {
          return ordered[index];
        }
      }
      return null;
    }

    function findNearest(currentTop, readTop) {
      const ordered = getOrderedStops(readTop);
      let nearest = null;
      let distance = Infinity;
      ordered.forEach((stop) => {
        const candidateDistance = Math.abs(stop.top - currentTop);
        if (candidateDistance < distance) {
          nearest = stop;
          distance = candidateDistance;
        }
      });
      return nearest ? { stop: nearest, distance } : null;
    }

    function getState() {
      return {
        activeId,
        activeIndex: stops.findIndex((stop) => stop.id === activeId),
        activeContentId,
        activeContentIndex: stops.findIndex((stop) => stop.id === activeContentId),
        size: stops.length
      };
    }

    return Object.freeze({
      setStops,
      getStops,
      getById,
      getOrderedStops,
      findDirectional,
      findNearest,
      activate,
      getState
    });
  }

  function createSegmentController(options = {}) {
    if (!options.index) {
      throw new TypeError('createSegmentController requires a stop index.');
    }
    const index = options.index;
    const track = options.track || null;
    const activeClass = options.activeClass || 'is-active';
    const ariaAttribute = options.ariaAttribute || 'aria-current';
    const xProperty = options.xProperty || '--segment-x';
    const widthProperty = options.widthProperty || '--segment-width';

    function getControls() {
      const controls = typeof options.getControls === 'function'
        ? options.getControls()
        : options.controls;
      return Array.isArray(controls) ? controls.filter(Boolean) : Array.from(controls || []).filter(Boolean);
    }

    function getTargetId(control) {
      return typeof options.getTargetId === 'function' ? options.getTargetId(control) : control.id;
    }

    function render(targetId = index.getState().activeId) {
      let activeControl = null;
      getControls().forEach((control) => {
        const active = getTargetId(control) === targetId;
        if (control.classList) {
          control.classList.toggle(activeClass, active);
        }
        if (typeof control.setAttribute === 'function') {
          control.setAttribute(ariaAttribute, active ? 'true' : 'false');
        }
        if (active) {
          activeControl = control;
        }
      });
      if (activeControl && typeof options.revealControl === 'function') {
        options.revealControl(activeControl, { targetId, index });
      }
      updateIndicator(activeControl);
      return activeControl;
    }

    function activate(targetId) {
      const stop = index.activate(targetId);
      if (!stop) {
        return null;
      }
      render(stop.id);
      return stop;
    }

    function updateIndicator(control) {
      const activeControl = control || getControls().find((candidate) => getTargetId(candidate) === index.getState().activeId);
      if (!track || !activeControl || !track.style) {
        return;
      }
      const measurement = typeof options.measureIndicator === 'function'
        ? options.measureIndicator(activeControl, track)
        : measureRelativeRect(activeControl, track);
      if (!measurement || !Number.isFinite(measurement.x) || !Number.isFinite(measurement.width)) {
        return;
      }
      track.style.setProperty(xProperty, `${measurement.x}px`);
      track.style.setProperty(widthProperty, `${measurement.width}px`);
    }

    return Object.freeze({
      activate,
      render,
      updateIndicator
    });
  }

  function createScrollController(options = {}) {
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const doc = options.document || (win ? win.document : null);
    if (!win || !doc) {
      throw new TypeError('createScrollController requires a window and document.');
    }

    const timings = { ...DEFAULT_TIMINGS, ...(options.timings || {}) };
    const reduceMotion = options.reduceMotion || win.matchMedia('(prefers-reduced-motion: reduce)');
    const index = options.index || createStopIndex({ initialId: options.initialId });
    const segments = options.segments || null;
    const rootElement = options.rootElement || doc.documentElement;
    const eventTarget = options.eventTarget || win;
    const observerThresholds = options.observerThresholds || DEFAULT_OBSERVER_THRESHOLDS;
    const listenerDisposers = [];

    let mounted = false;
    let observer = null;
    let navigationLockUntil = 0;
    let pendingId = '';
    let settleTimer = null;
    let alignmentFrame = null;
    let restTimer = null;
    let restSampleScrollY = null;
    let touchPointsActive = 0;
    let lastTouchEventAt = 0;
    let wheelDeltaY = 0;
    let wheelResetTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchHandled = false;
    let touchStartStopId = '';

    function getStops() {
      return typeof options.getStops === 'function' ? options.getStops() : [];
    }

    function getViewportHeight() {
      const viewport = win.visualViewport;
      return Math.round(viewport && viewport.height ? viewport.height : (win.innerHeight || doc.documentElement.clientHeight));
    }

    function getScrollY() {
      return Number.isFinite(win.scrollY) ? win.scrollY : (doc.documentElement.scrollTop || 0);
    }

    function getDocumentBottom() {
      const documentHeight = Math.max(doc.body ? doc.body.scrollHeight : 0, doc.documentElement.scrollHeight);
      return Math.max(0, Math.round(documentHeight - getViewportHeight()));
    }

    function readStopTop(stop) {
      if (!stop) {
        return null;
      }
      const context = {
        window: win,
        document: doc,
        stop,
        viewportHeight: getViewportHeight(),
        scrollY: getScrollY(),
        documentBottom: getDocumentBottom()
      };
      if (typeof stop.getTop === 'function') {
        const customTop = Number(stop.getTop(context));
        return Number.isFinite(customTop) ? customTop : null;
      }
      if (stop.align === 'document-end') {
        return context.documentBottom;
      }
      if (!stop.element || typeof stop.element.getBoundingClientRect !== 'function') {
        return null;
      }
      const rect = stop.element.getBoundingClientRect();
      if (stop.align === 'end') {
        return Math.max(0, Math.round(rect.bottom + context.scrollY - context.viewportHeight));
      }
      return Math.max(0, Math.round(rect.top + context.scrollY));
    }

    function activateStop(stopOrId, source = 'programmatic', force = false) {
      const id = typeof stopOrId === 'string' ? stopOrId : (stopOrId && stopOrId.id);
      const previousId = index.getState().activeId;
      const stop = segments ? segments.activate(id) : index.activate(id);
      if (!stop) {
        return null;
      }
      if ((force || previousId !== stop.id) && typeof options.onActiveChange === 'function') {
        options.onActiveChange({
          source,
          stop,
          ...index.getState()
        });
      }
      return stop;
    }

    function renderActiveSegment() {
      if (segments) {
        segments.render(index.getState().activeId);
      }
    }

    function refresh() {
      index.setStops(getStops());
      setupObserver();
      activateStop(index.getState().activeId, 'refresh', true);
      return getState();
    }

    function setupObserver() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (!mounted || !('IntersectionObserver' in win)) {
        renderActiveSegment();
        return;
      }
      const observedStops = index.getStops().filter((stop) => stop.element && stop.observe !== false && getRole(stop) === 'content');
      if (observedStops.length === 0) {
        renderActiveSegment();
        return;
      }
      observer = new win.IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (options.visibleClass && entry.target.classList) {
            entry.target.classList.toggle(options.visibleClass, entry.isIntersecting);
          }
          if (typeof options.onVisibilityChange === 'function') {
            const stop = index.getStops().find((candidate) => candidate.element === entry.target) || null;
            options.onVisibilityChange({ entry, stop, visible: entry.isIntersecting });
          }
        });
        if (isNavigationLocked()) {
          renderActiveSegment();
          return;
        }
        const positionStop = findStopAtCurrentPosition(true);
        if (positionStop) {
          activateStop(positionStop, 'position');
          return;
        }
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!visible) {
          return;
        }
        const stop = index.getStops().find((candidate) => candidate.element === visible.target);
        if (stop) {
          activateStop(stop, 'observer');
        }
      }, { threshold: observerThresholds });
      observedStops.forEach((stop) => observer.observe(stop.element));
      renderActiveSegment();
    }

    function mount() {
      if (mounted) {
        return getState();
      }
      mounted = true;
      refresh();
      if (rootElement && options.managedClass && index.getStops().length > 0) {
        rootElement.classList.add(options.managedClass);
      }
      listen(eventTarget, 'wheel', handleWheel, { passive: false });
      listen(eventTarget, 'scroll', handleScroll, { passive: true });
      listen(eventTarget, 'touchstart', handleTouchStart, { passive: true });
      listen(eventTarget, 'touchmove', handleTouchMove, { passive: false });
      listen(eventTarget, 'touchend', handleTouchEnd, { passive: true });
      listen(eventTarget, 'touchcancel', handleTouchEnd, { passive: true });
      listen(win, 'resize', renderActiveSegment);
      return getState();
    }

    function destroy() {
      listenerDisposers.splice(0).forEach((dispose) => dispose());
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      clearSettleTimer();
      clearWheelAccumulation();
      cancelScrollAlignment();
      if (restTimer !== null) {
        win.clearTimeout(restTimer);
        restTimer = null;
      }
      if (rootElement && options.managedClass) {
        rootElement.classList.remove(options.managedClass);
      }
      navigationLockUntil = 0;
      pendingId = '';
      restSampleScrollY = null;
      touchPointsActive = 0;
      lastTouchEventAt = 0;
      touchHandled = false;
      touchStartStopId = '';
      mounted = false;
    }

    function listen(target, type, handler, listenerOptions) {
      if (!target || typeof target.addEventListener !== 'function') {
        return;
      }
      target.addEventListener(type, handler, listenerOptions);
      listenerDisposers.push(() => target.removeEventListener(type, handler, listenerOptions));
    }

    function prefersReducedMotion() {
      return Boolean(reduceMotion && reduceMotion.matches);
    }

    function isNavigationLocked() {
      return Date.now() < navigationLockUntil;
    }

    function lockFor(duration) {
      navigationLockUntil = Date.now() + duration;
    }

    function clearWheelAccumulation() {
      wheelDeltaY = 0;
      if (wheelResetTimer !== null) {
        win.clearTimeout(wheelResetTimer);
        wheelResetTimer = null;
      }
    }

    function clearSettleTimer() {
      if (settleTimer !== null) {
        win.clearTimeout(settleTimer);
        settleTimer = null;
      }
    }

    function cancelScrollAlignment() {
      if (alignmentFrame !== null) {
        win.cancelAnimationFrame(alignmentFrame);
        alignmentFrame = null;
      }
    }

    function enforceScrollAlignment(stopId) {
      cancelScrollAlignment();
      let framesLeft = timings.alignmentFrames;
      const step = () => {
        alignmentFrame = null;
        const stop = index.getById(stopId);
        const targetTop = readStopTop(stop);
        if (targetTop === null) {
          return;
        }
        if (Math.abs(getScrollY() - targetTop) > 1) {
          win.scrollTo({ top: targetTop, behavior: 'auto' });
        }
        framesLeft -= 1;
        if (framesLeft > 0) {
          alignmentFrame = win.requestAnimationFrame(step);
        }
      };
      step();
    }

    function settle(stopId, delay = timings.settleMs) {
      clearSettleTimer();
      settleTimer = win.setTimeout(() => {
        settleTimer = null;
        if (!pendingId || pendingId !== stopId) {
          return;
        }
        const stop = index.getById(stopId);
        pendingId = '';
        if (!stop) {
          return;
        }
        enforceScrollAlignment(stop.id);
        activateStop(stop, 'settle');
      }, prefersReducedMotion() ? 80 : delay);
    }

    function goTo(stopOrId, navigationOptions = {}) {
      const stop = typeof stopOrId === 'string' ? index.getById(stopOrId) : index.getById(stopOrId && stopOrId.id);
      if (!stop) {
        return false;
      }
      cancelScrollAlignment();
      clearSettleTimer();
      lockFor(prefersReducedMotion() ? 160 : Math.max(timings.navigationLockMs, timings.settleMs + 140));
      pendingId = stop.id;
      activateStop(stop, navigationOptions.source || 'programmatic');
      if (typeof options.onNavigate === 'function') {
        options.onNavigate({ stop, options: navigationOptions, state: getState() });
      }
      const behavior = navigationOptions.behavior || (prefersReducedMotion() ? 'auto' : 'smooth');
      if (typeof stop.scroll === 'function') {
        stop.scroll({
          behavior,
          top: readStopTop(stop),
          window: win,
          document: doc,
          stop
        });
      } else {
        const top = readStopTop(stop);
        if (top === null) {
          pendingId = '';
          return false;
        }
        win.scrollTo({ top, behavior });
      }
      settle(stop.id, navigationOptions.settleMs || timings.settleMs);
      return true;
    }

    function move(direction, navigationOptions = {}) {
      const preferredId = navigationOptions.fromId || index.getState().activeId;
      const target = index.findDirectional(direction, getScrollY(), preferredId, readStopTop);
      return target ? goTo(target.id, navigationOptions) : false;
    }

    function getDirectionalStop(direction, event, preferredId = '') {
      const eventStopId = preferredId || getEventStopId(event);
      return index.findDirectional(direction, getScrollY(), eventStopId, readStopTop);
    }

    function navigateDirection(direction, event, preferredId = '') {
      const target = getDirectionalStop(direction, event, preferredId);
      if (!target) {
        clearWheelAccumulation();
        return false;
      }
      if (event && event.cancelable) {
        event.preventDefault();
      }
      if (isNavigationLocked()) {
        return true;
      }
      clearWheelAccumulation();
      return goTo(target.id, { source: event ? event.type : 'direction', updateHistory: false });
    }

    function normalizeWheelDelta(event) {
      if (event.deltaMode === 1) {
        return event.deltaY * 16;
      }
      if (event.deltaMode === 2) {
        return event.deltaY * getViewportHeight();
      }
      return event.deltaY;
    }

    function handleWheel(event) {
      const gesture = {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        horizontalDominant: Math.abs(event.deltaX) > Math.abs(event.deltaY),
        shiftKey: event.shiftKey
      };
      if (typeof options.shouldYieldWheel === 'function' && options.shouldYieldWheel(event, gesture)) {
        return;
      }
      const deltaY = normalizeWheelDelta(event);
      if (Math.abs(deltaY) < 1) {
        return;
      }
      const direction = deltaY > 0 ? 1 : -1;
      if (!getDirectionalStop(direction, event)) {
        clearWheelAccumulation();
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      if (isNavigationLocked()) {
        return;
      }
      if (wheelDeltaY !== 0 && Math.sign(wheelDeltaY) !== direction) {
        wheelDeltaY = 0;
      }
      wheelDeltaY += deltaY;
      if (wheelResetTimer !== null) {
        win.clearTimeout(wheelResetTimer);
      }
      wheelResetTimer = win.setTimeout(clearWheelAccumulation, timings.wheelResetMs);
      if (Math.abs(wheelDeltaY) >= timings.wheelThreshold) {
        navigateDirection(direction, event);
      }
    }

    function markTouchActivity(event) {
      lastTouchEventAt = Date.now();
      touchPointsActive = event && event.touches ? event.touches.length : 0;
    }

    function handleTouchStart(event) {
      markTouchActivity(event);
      scheduleRestAlignmentCheck(timings.touchActivityStaleMs + 320);
      if (!event.touches || event.touches.length !== 1) {
        touchStartStopId = '';
        return;
      }
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
      touchHandled = false;
      touchStartStopId = getEventStopId(event);
    }

    function handleTouchMove(event) {
      markTouchActivity(event);
      if (!event.touches || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      const deltaX = touchStartX - touch.clientX;
      const deltaY = touchStartY - touch.clientY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      const gesture = {
        deltaX,
        deltaY,
        absDeltaX,
        absDeltaY,
        horizontalDominant: absDeltaX > absDeltaY,
        verticalIntent: absDeltaY >= timings.touchIntentThreshold && absDeltaY >= absDeltaX * timings.verticalIntentRatio
      };
      if (typeof options.shouldYieldTouch === 'function' && options.shouldYieldTouch(event, gesture)) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      if (!gesture.verticalIntent) {
        return;
      }
      const direction = deltaY > 0 ? 1 : -1;
      if (!getDirectionalStop(direction, event, touchStartStopId)) {
        return;
      }
      if (touchHandled || absDeltaY < timings.touchThreshold) {
        return;
      }
      touchHandled = navigateDirection(direction, event, touchStartStopId);
    }

    function handleTouchEnd(event) {
      markTouchActivity(event);
      if (touchHandled && pendingId) {
        lockFor(prefersReducedMotion() ? 160 : timings.touchMomentumSettleMs + 140);
        settle(pendingId, timings.touchMomentumSettleMs);
      }
      touchHandled = false;
      touchStartStopId = '';
      if (touchPointsActive === 0) {
        scheduleRestAlignmentCheck(timings.touchMomentumSettleMs + 200);
      }
    }

    function getEventStopId(event) {
      if (!event) {
        return '';
      }
      const stop = index.getStops().find((candidate) => {
        const region = candidate.eventRegion || null;
        return region && eventIncludesElement(event, region);
      });
      return stop ? stop.id : '';
    }

    function handleScroll() {
      if (!isNavigationLocked()) {
        const stop = findStopAtCurrentPosition(false);
        if (stop) {
          activateStop(stop, 'position');
        }
      }
      if (shouldMonitorRestAlignment()) {
        scheduleRestAlignmentCheck(260);
      }
    }

    function findStopAtCurrentPosition(auxiliaryOnly) {
      const current = getScrollY();
      let match = null;
      let matchDistance = Infinity;
      index.getOrderedStops(readStopTop).forEach((stop) => {
        if (auxiliaryOnly && getRole(stop) === 'content') {
          return;
        }
        const distance = Math.abs(stop.top - current);
        const tolerance = getActivationTolerance(stop);
        if (distance <= tolerance && distance < matchDistance) {
          match = stop;
          matchDistance = distance;
        }
      });
      return match;
    }

    function getActivationTolerance(stop) {
      if (typeof stop.activationTolerance === 'function') {
        return Number(stop.activationTolerance({ stop, viewportHeight: getViewportHeight() })) || 0;
      }
      if (Number.isFinite(stop.activationTolerance)) {
        return stop.activationTolerance;
      }
      if (getRole(stop) !== 'content' && stop.element) {
        return Math.max(12, stop.element.offsetHeight * 0.4);
      }
      return Math.max(4, Math.round(getViewportHeight() * 0.02));
    }

    function shouldMonitorRestAlignment() {
      if (typeof options.monitorRestAlignment === 'boolean') {
        return options.monitorRestAlignment;
      }
      return 'ontouchstart' in win || win.matchMedia('(any-pointer: coarse)').matches;
    }

    function scheduleRestAlignmentCheck(delay) {
      if (!shouldMonitorRestAlignment()) {
        return;
      }
      if (restTimer !== null) {
        win.clearTimeout(restTimer);
      }
      restTimer = win.setTimeout(runRestAlignmentCheck, delay);
    }

    function runRestAlignmentCheck() {
      restTimer = null;
      const touchRecentlyActive = touchPointsActive > 0 && (Date.now() - lastTouchEventAt) < timings.touchActivityStaleMs;
      if (touchRecentlyActive || isNavigationLocked() || pendingId || alignmentFrame !== null) {
        restSampleScrollY = null;
        scheduleRestAlignmentCheck(320);
        return;
      }
      touchPointsActive = 0;
      if ((win.visualViewport && win.visualViewport.scale > timings.zoomThreshold) || index.getStops().length === 0) {
        return;
      }
      const current = getScrollY();
      if (restSampleScrollY === null || Math.abs(restSampleScrollY - current) > 2) {
        restSampleScrollY = current;
        scheduleRestAlignmentCheck(220);
        return;
      }
      restSampleScrollY = null;
      const nearest = index.findNearest(current, readStopTop);
      if (!nearest) {
        return;
      }
      const tolerance = Math.max(4, Math.round(getViewportHeight() * 0.02));
      if (nearest.distance > tolerance) {
        lockFor(prefersReducedMotion() ? 160 : 480);
        enforceScrollAlignment(nearest.stop.id);
      }
      activateStop(nearest.stop, 'rest');
    }

    function getState() {
      return {
        ...index.getState(),
        pendingId,
        locked: isNavigationLocked(),
        mounted,
        aligning: alignmentFrame !== null
      };
    }

    return Object.freeze({
      index,
      mount,
      refresh,
      destroy,
      goTo,
      move,
      setActive: activateStop,
      readStopTop,
      getState
    });
  }

  function createViewportCssSync(options = {}) {
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const rootElement = options.rootElement || (win ? win.document.documentElement : null);
    const disposers = [];
    let mounted = false;

    function sync() {
      if (!win || !rootElement) {
        return null;
      }
      const viewport = win.visualViewport;
      const width = Math.round(viewport && viewport.width ? viewport.width : win.innerWidth);
      const height = Math.round(viewport && viewport.height ? viewport.height : win.innerHeight);
      if (options.widthProperty && width > 0) {
        rootElement.style.setProperty(options.widthProperty, `${width}px`);
      }
      if (options.heightProperty && height > 0) {
        rootElement.style.setProperty(options.heightProperty, `${height}px`);
      }
      if (typeof options.onChange === 'function') {
        options.onChange({ width, height });
      }
      return { width, height };
    }

    function listen(target, type) {
      if (!target || typeof target.addEventListener !== 'function') {
        return;
      }
      target.addEventListener(type, sync);
      disposers.push(() => target.removeEventListener(type, sync));
    }

    function mount() {
      if (!win || !rootElement || mounted) {
        return sync();
      }
      mounted = true;
      listen(win, 'resize');
      listen(win, 'orientationchange');
      listen(win.visualViewport, 'resize');
      return sync();
    }

    function destroy() {
      disposers.splice(0).forEach((dispose) => dispose());
      mounted = false;
    }

    return Object.freeze({ mount, sync, destroy });
  }

  function measureRelativeRect(control, track) {
    if (typeof control.getBoundingClientRect !== 'function' || typeof track.getBoundingClientRect !== 'function') {
      return null;
    }
    const controlRect = control.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    // Absolute-positioned indicators are positioned from the track's padding
    // box, while the measured control offset is relative to its border box.
    // Remove the inline border so the indicator shares the control's edges.
    const trackBorderLeft = Number.isFinite(track.clientLeft) ? track.clientLeft : 0;
    return {
      x: controlRect.left - trackRect.left - trackBorderLeft,
      width: controlRect.width
    };
  }

  function eventIncludesElement(event, element) {
    if (!event || !element) {
      return false;
    }
    if (typeof event.composedPath === 'function') {
      return event.composedPath().includes(element);
    }
    const EventNode = element.ownerDocument && element.ownerDocument.defaultView
      ? element.ownerDocument.defaultView.Node
      : (typeof Node !== 'undefined' ? Node : null);
    return Boolean(EventNode && event.target instanceof EventNode && element.contains(event.target));
  }

  function getRole(stop) {
    return stop && stop.role === 'auxiliary' ? 'auxiliary' : 'content';
  }

  return Object.freeze({
    version: '1.0.0',
    DEFAULT_TIMINGS,
    createStopIndex,
    createSegmentController,
    createScrollController,
    createViewportCssSync
  });
});
