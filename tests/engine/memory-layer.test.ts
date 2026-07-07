import { describe, expect, it } from 'vitest';
import { chooseMemoryLayer } from '../../src/engine/memory-layer.js';

describe('chooseMemoryLayer', () => {
  it('routes an untagged lesson to the project layer, unchanged', () => {
    expect(chooseMemoryLayer('this repo pins react 18')).toEqual({
      layer: 'project',
      content: 'this repo pins react 18',
    });
  });

  it('routes a [type]-tagged lesson to the type layer and strips the tag', () => {
    expect(chooseMemoryLayer('[type] fetch fresh docs before writing client code')).toEqual({
      layer: 'type',
      content: 'fetch fresh docs before writing client code',
    });
  });

  it('routes a [global]-tagged lesson to the global layer and strips the tag', () => {
    expect(chooseMemoryLayer('[global] never commit secrets')).toEqual({
      layer: 'global',
      content: 'never commit secrets',
    });
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(chooseMemoryLayer('  [TYPE]   prefer small functions')).toEqual({
      layer: 'type',
      content: 'prefer small functions',
    });
  });

  it('never infers global from an untagged lesson that merely mentions the word', () => {
    // Conservative by construction: global requires the explicit tag.
    expect(chooseMemoryLayer('avoid global mutable state').layer).toBe('project');
  });

  it('leaves an unrecognized bracketed prefix as a project lesson', () => {
    const lesson = '[note] a bracketed word that is not a layer tag';
    expect(chooseMemoryLayer(lesson)).toEqual({ layer: 'project', content: lesson });
  });
});
