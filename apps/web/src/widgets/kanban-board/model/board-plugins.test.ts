import { DragDropManager, Draggable, StyleInjector } from '@dnd-kit/dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createBoardPlugins } from './a11y-announcements';

// Lỗi HIGH (F, E2E build prod): StyleInjector của @dnd-kit/dom chèn <style> KHÔNG nonce khi kéo ⇒ CSP
// `style-src 'self' 'nonce-…'` chặn ⇒ overlay kẹt, không thả được. Kiểm trên manager THẬT.

// jsdom thiếu API layout/animation mà plugin dùng khi kéo (Scroller: elementFromPoint; Feedback khi
// thả: getAnimations, matchMedia) — stub trung tính cho riêng file này.
const STUBS: Array<[object, string, unknown]> = [
  [Document.prototype, 'elementFromPoint', () => null],
  [Document.prototype, 'getAnimations', () => []],
  [Element.prototype, 'getAnimations', () => []],
  [
    window,
    'matchMedia',
    () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  ],
];
const added: Array<[object, string]> = [];
beforeAll(() => {
  for (const [target, name, value] of STUBS) {
    if (typeof (target as Record<string, unknown>)[name] === 'function') continue;
    Object.defineProperty(target, name, { value, configurable: true });
    added.push([target, name]);
  }
});
afterAll(() => {
  added.forEach(([target, name]) => Reflect.deleteProperty(target, name));
});
afterEach(() => {
  document.head.querySelectorAll('style').forEach((el) => el.remove());
});

describe('createBoardPlugins', () => {
  it('StyleInjector (plugin lõi) nhận nonce', () => {
    const manager = new DragDropManager({ plugins: createBoardPlugins('nonce-abc') });
    expect(manager.registry.plugins.get(StyleInjector)?.options).toEqual({ nonce: 'nonce-abc' });
    manager.destroy();
  });

  it('kéo thật trên manager: MỌI thẻ <style> plugin chèn vào document đều mang nonce', async () => {
    const manager = new DragDropManager({ plugins: createBoardPlugins('nonce-abc') });
    const element = document.createElement('div');
    document.body.append(element);
    const draggable = new Draggable({ id: 'card', element }, manager);
    manager.registry.register(draggable);
    const before = document.querySelectorAll('style').length;
    manager.actions.start({ source: draggable, coordinates: { x: 0, y: 0 } });
    await new Promise((r) => setTimeout(r, 0));
    const injected = [...document.querySelectorAll('style')].slice(before);
    expect(injected.length).toBeGreaterThan(0); // Cursor / PreventSelection / Feedback đăng ký CSS khi kéo
    expect(injected.map((el) => el.getAttribute('nonce'))).toEqual(injected.map(() => 'nonce-abc'));
    manager.actions.stop({ canceled: true });
    element.remove();
    manager.destroy();
  });

  it('không có nonce (test/dev không proxy) ⇒ không đặt thuộc tính nonce rỗng', () => {
    const manager = new DragDropManager({ plugins: createBoardPlugins(undefined) });
    expect(manager.registry.plugins.get(StyleInjector)?.options ?? {}).toEqual({});
    manager.destroy();
  });
});
