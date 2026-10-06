import { describe, it, expect } from 'vitest';
import { classLabel } from './classLabels';

describe('classLabel', () => {
  it.each([
    ['healthy', 'Healthy'],
    ['fin_rot', 'Fin rot'],
    ['dermatomycosis', 'Dermatomycosis'],
    ['hexamitosis', 'Hexamitosis'],
    ['mycobacteriosis', 'Mycobacteriosis'],
    ['oodiniosis', 'Oodiniosis'],
    ['plistophorosis', 'Plistophorosis'],
  ])('names the class %s "%s"', (code, label) => {
    expect(classLabel(code)).toBe(label);
  });

  it('shows a code it does not know with spaces and a capital letter', () => {
    expect(classLabel('swim_bladder')).toBe('Swim bladder');
  });

  it('does not break on a missing code', () => {
    expect(classLabel(undefined)).toBe('Unknown');
    expect(classLabel('')).toBe('Unknown');
  });
});
