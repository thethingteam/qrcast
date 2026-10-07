import { afterEach, expect, test, vi } from 'vitest';
import { Emitter } from '../src/internal/emitter.js';

interface Events {
  frame: { frame: number };
  state: { state: string };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('delivers payloads to listeners of that event only', () => {
  const emitter = new Emitter<Events>();
  const frames: number[] = [];
  const states: string[] = [];
  emitter.on('frame', ({ frame }) => frames.push(frame));
  emitter.on('state', ({ state }) => states.push(state));
  emitter.emit('frame', { frame: 1 });
  emitter.emit('frame', { frame: 2 });
  expect(frames).toEqual([1, 2]);
  expect(states).toEqual([]);
});

test('the function returned by on removes the listener', () => {
  const emitter = new Emitter<Events>();
  const frames: number[] = [];
  const off = emitter.on('frame', ({ frame }) => frames.push(frame));
  emitter.emit('frame', { frame: 1 });
  off();
  off();
  emitter.emit('frame', { frame: 2 });
  expect(frames).toEqual([1]);
});

test('a throwing listener is reported and the others still run', () => {
  const reportError = vi.fn();
  vi.stubGlobal('reportError', reportError);
  const emitter = new Emitter<Events>();
  const failure = new Error('listener bug');
  const frames: number[] = [];
  emitter.on('frame', () => {
    throw failure;
  });
  emitter.on('frame', ({ frame }) => frames.push(frame));
  emitter.emit('frame', { frame: 1 });
  expect(reportError).toHaveBeenCalledWith(failure);
  expect(frames).toEqual([1]);
});

test('clear removes every listener', () => {
  const emitter = new Emitter<Events>();
  const listener = vi.fn();
  emitter.on('frame', listener);
  emitter.clear();
  emitter.emit('frame', { frame: 1 });
  expect(listener).not.toHaveBeenCalled();
});
