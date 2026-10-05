import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Renderer } from 'ogl';
import App from './App';
import Lightfall from './Lightfall';

vi.mock('ogl', () => {
  const fake = () => class { constructor() { this.gl = { canvas: document.createElement('canvas'), drawingBufferWidth: 1, drawingBufferHeight: 1 }; } setSize() {} render() {} destroy() {} remove() {} };
  return { Renderer: vi.fn(fake()), Program: fake(), Mesh: fake(), Triangle: fake() };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Lightfall background', () => {
  it('is created once: re-rendering the page does not rebuild the WebGL context', () => {
    const { rerender } = render(<App />);
    expect(Renderer).toHaveBeenCalledTimes(1);

    rerender(<App />);
    rerender(<App />);

    expect(Renderer).toHaveBeenCalledTimes(1);
  });

  it('leaves the page working when WebGL is not available', () => {
    Renderer.mockImplementationOnce(() => { throw new TypeError("Cannot set properties of null (setting 'renderer')"); });

    expect(() => render(<Lightfall colors={['#fff']} backgroundColor="#000" />)).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });
});
