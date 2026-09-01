import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins the parts it is given with single spaces', () => {
    expect(cn('tg-btn', 'tg-btn--primary')).toBe('tg-btn tg-btn--primary');
  });

  it('returns an empty string when given nothing', () => {
    expect(cn()).toBe('');
  });

  it('drops every falsy value', () => {
    expect(cn('a', false, 'b', null, 'c', undefined, 'd')).toBe('a b c d');
  });

  it('drops the empty string, which is what a false && "x" guard leaves behind', () => {
    expect(cn('', 'a', '')).toBe('a');
  });

  it('drops a whitespace-only part instead of emitting a double space', () => {
    expect(cn('a', '   ', 'b')).toBe('a b');
  });

  it('trims the parts it keeps', () => {
    expect(cn('  a  ', ' b')).toBe('a b');
  });

  it('returns an empty string when everything is falsy', () => {
    expect(cn(false, null, undefined, '')).toBe('');
  });

  it('leaves interior whitespace alone, so a multi-class string stays intact', () => {
    expect(cn('a b', 'c')).toBe('a b c');
  });

  it('never leads or trails with a space', () => {
    const result = cn(undefined, 'only', false);
    expect(result).toBe('only');
    expect(result.startsWith(' ')).toBe(false);
    expect(result.endsWith(' ')).toBe(false);
  });
});
