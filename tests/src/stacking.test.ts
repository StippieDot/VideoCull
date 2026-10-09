import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

function zIndexOf(file: string, selector: string): number {
  const css = readFileSync(join(__dirname, '../../src', file), 'utf8');
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} in ${file}`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return Number(/z-index:\s*(\d+)/.exec(block)?.[1]);
}

test('dialogs that wait for an answer sit above the fixed title bar, so they also block its menus', () => {
  const titleBar = zIndexOf('components/TitleBar.css', '.title-bar');
  expect(zIndexOf('App.css', '.drop-modal-backdrop')).toBeGreaterThan(titleBar);
  expect(zIndexOf('App.css', '.shortcuts-overlay')).toBeGreaterThan(titleBar);
});
