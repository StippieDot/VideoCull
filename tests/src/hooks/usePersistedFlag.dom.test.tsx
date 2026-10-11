// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { usePersistedFlag } from '../../../src/hooks/usePersistedFlag';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('usePersistedFlag', () => {
  test('starts from the fallback and remembers a change for the next mount', () => {
    const first = renderHook(() => usePersistedFlag('test.flag', true));
    expect(first.result.current[0]).toBe(true);

    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);

    const second = renderHook(() => usePersistedFlag('test.flag', true));
    expect(second.result.current[0]).toBe(false);
  });

  test('accepts an updater function', () => {
    const { result } = renderHook(() => usePersistedFlag('test.toggle', false));
    act(() => result.current[1]((current) => !current));
    expect(result.current[0]).toBe(true);
  });

  test('keeps working for the session when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });

    const { result } = renderHook(() => usePersistedFlag('test.blocked', true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});
