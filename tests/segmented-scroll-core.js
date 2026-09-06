/**
 * テスト概要:
 *  - 目的: 共通 segmented scroll の停止位置インデックスと segment 表示同期が、画面固有の DOM に依存せず動作することを確認する。
 *  - 期待値: ID の一意性、active/content index、補助 stop の contentAnchor、方向・最近傍探索、refresh 時の ID 保持、active class・ARIA・indicator が公開 API の契約どおりになる。
 *  - 検証方法: Node の組み込み test/assert と最小限の fake DOM オブジェクトを使い、`site/shared/segmented-scroll.js` を CommonJS API として直接検証する。
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createScrollController,
  createSegmentController,
  createStopIndex
} = require('../site/shared/segmented-scroll.js');

function createFakeClassList() {
  const tokens = new Set();
  return {
    add(token) {
      tokens.add(token);
    },
    contains(token) {
      return tokens.has(token);
    },
    remove(token) {
      tokens.delete(token);
    },
    toggle(token, force) {
      const enabled = force === undefined ? !tokens.has(token) : Boolean(force);
      if (enabled) {
        tokens.add(token);
      } else {
        tokens.delete(token);
      }
      return enabled;
    }
  };
}

function createFakeStyle() {
  const properties = new Map();
  return {
    getPropertyValue(name) {
      return properties.get(name) || '';
    },
    setProperty(name, value) {
      properties.set(name, value);
    }
  };
}

function createFakeControl(id, rect) {
  const attributes = new Map();
  return {
    id,
    classList: createFakeClassList(),
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    getBoundingClientRect() {
      return { ...rect };
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };
}

test('stop ID の重複を拒否する', () => {
  const index = createStopIndex();

  assert.throws(
    () => index.setStops([{ id: 'intro' }, { id: 'intro', role: 'auxiliary' }]),
    /Duplicate segmented scroll stop id: intro/
  );
});

test('active index と content index を役割ごとに管理する', () => {
  const index = createStopIndex({ initialId: 'details' });
  index.setStops([
    { id: 'intro' },
    { id: 'details', role: 'content' },
    { id: 'footer', role: 'auxiliary', contentAnchor: 'previous' }
  ]);

  assert.deepEqual(index.getState(), {
    activeId: 'details',
    activeIndex: 1,
    activeContentId: 'details',
    activeContentIndex: 1,
    size: 3
  });

  assert.equal(index.activate('footer').id, 'footer');
  assert.deepEqual(index.getState(), {
    activeId: 'footer',
    activeIndex: 2,
    activeContentId: 'details',
    activeContentIndex: 1,
    size: 3
  });

  assert.equal(index.activate('intro').id, 'intro');
  assert.equal(index.getState().activeContentId, 'intro');
  assert.equal(index.getState().activeContentIndex, 0);
});

test('auxiliary stop の previous anchor は直前の content stop を参照する', () => {
  const index = createStopIndex();
  index.setStops([
    { id: 'first' },
    { id: 'first-note', role: 'auxiliary', contentAnchor: 'previous' },
    { id: 'second' },
    { id: 'second-note', role: 'auxiliary', contentAnchor: 'previous' }
  ]);

  index.activate('first-note');
  assert.equal(index.getState().activeContentId, 'first');

  index.activate('second-note');
  assert.equal(index.getState().activeContentId, 'second');
});

test('実測 top の順序で方向移動と最近傍 stop を解決する', () => {
  const index = createStopIndex();
  const tops = new Map([
    ['third', 300],
    ['first', 100],
    ['second', 200],
    ['footer', 420]
  ]);
  const readTop = (stop) => tops.get(stop.id);
  index.setStops([
    { id: 'third' },
    { id: 'first' },
    { id: 'footer', role: 'auxiliary', contentAnchor: 'previous' },
    { id: 'second' }
  ]);

  assert.deepEqual(
    index.getOrderedStops(readTop).map((stop) => stop.id),
    ['first', 'second', 'third', 'footer']
  );
  assert.equal(index.findDirectional(1, 100, 'first', readTop).id, 'second');
  assert.equal(index.findDirectional(-1, 300, 'third', readTop).id, 'second');
  assert.equal(index.findDirectional(1, 205, '', readTop).id, 'third');
  assert.equal(index.findDirectional(-1, 205, '', readTop).id, 'second');
  assert.deepEqual(index.findNearest(264, readTop), {
    stop: { id: 'third', top: 300 },
    distance: 36
  });
});

test('動的 refresh は残っている active ID と content ID を保持する', () => {
  const index = createStopIndex({ initialId: 'first' });
  let liveStops = [
    { id: 'first' },
    { id: 'second' },
    { id: 'footer', role: 'auxiliary', contentAnchor: 'previous' }
  ];
  const scroll = createScrollController({
    window: {},
    document: { documentElement: {} },
    reduceMotion: { matches: true },
    index,
    getStops: () => liveStops
  });

  scroll.refresh();
  scroll.setActive('second');
  assert.equal(scroll.getState().activeId, 'second');

  liveStops = [
    { id: 'new-first' },
    { id: 'footer', role: 'auxiliary', contentAnchor: 'previous' },
    { id: 'second' }
  ];
  scroll.refresh();

  assert.equal(scroll.getState().activeId, 'second');
  assert.equal(scroll.getState().activeContentId, 'second');
  assert.equal(scroll.getState().activeIndex, 2);
  assert.equal(scroll.getState().activeContentIndex, 2);
});

test('segment controller は class・ARIA・indicator を active stop と同期する', () => {
  const index = createStopIndex({ initialId: 'first' });
  index.setStops([{ id: 'first' }, { id: 'second' }]);

  const first = createFakeControl('first', { left: 24, width: 44 });
  const second = createFakeControl('second', { left: 92, width: 58 });
  const track = {
    clientLeft: 1,
    style: createFakeStyle(),
    getBoundingClientRect() {
      return { left: 12, width: 180 };
    }
  };
  const segments = createSegmentController({
    index,
    controls: [first, second],
    track
  });

  assert.equal(segments.activate('second').id, 'second');
  assert.equal(first.classList.contains('is-active'), false);
  assert.equal(first.getAttribute('aria-current'), 'false');
  assert.equal(second.classList.contains('is-active'), true);
  assert.equal(second.getAttribute('aria-current'), 'true');
  assert.equal(track.style.getPropertyValue('--segment-x'), '79px');
  assert.equal(track.style.getPropertyValue('--segment-width'), '58px');
  assert.equal(index.getState().activeId, 'second');
});

test('destroy は listener と保留中の navigation state を破棄して再 mount 可能にする', () => {
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const rootClassList = createFakeClassList();
  const document = {
    body: { scrollHeight: 300 },
    documentElement: {
      classList: rootClassList,
      clientHeight: 100,
      scrollHeight: 300,
      scrollTop: 0
    }
  };
  const window = {
    document,
    innerHeight: 100,
    scrollY: 0,
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    cancelAnimationFrame() {},
    clearTimeout(id) {
      timers.delete(id);
    },
    matchMedia() {
      return { matches: false };
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type);
      if (handlers) {
        handlers.delete(handler);
      }
    },
    requestAnimationFrame() {
      return 1;
    },
    scrollTo({ top }) {
      this.scrollY = top;
    },
    setTimeout(handler) {
      timerId += 1;
      timers.set(timerId, handler);
      return timerId;
    }
  };
  const controller = createScrollController({
    window,
    document,
    managedClass: 'is-managed',
    reduceMotion: { matches: false },
    getStops: () => [
      { id: 'first', getTop: () => 0 },
      { id: 'second', getTop: () => 100 }
    ]
  });

  controller.mount();
  assert.equal(rootClassList.contains('is-managed'), true);
  assert.equal(controller.goTo('second'), true);
  assert.equal(controller.getState().pendingId, 'second');
  assert.equal(controller.getState().locked, true);

  controller.destroy();
  assert.equal(rootClassList.contains('is-managed'), false);
  assert.equal(controller.getState().pendingId, '');
  assert.equal(controller.getState().locked, false);
  assert.equal(controller.getState().mounted, false);
  assert.equal(timers.size, 0);
  assert.equal(Array.from(listeners.values()).every((handlers) => handlers.size === 0), true);

  controller.mount();
  assert.equal(controller.getState().pendingId, '');
  assert.equal(controller.getState().mounted, true);
  controller.destroy();
});
