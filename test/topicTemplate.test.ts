import { describe, expect, it } from 'vitest';
import { resolveTopicTemplates, sanitizeTopicValue, validateTopicTemplate } from '../src/topicTemplate';

describe('resolveTopicTemplates', () => {
  it('fills {name} and message fields', () => {
    expect(resolveTopicTemplates(['{name}/{imoNumber}'], 'ferry', '{"imoNumber":9876543}')).toEqual(['ferry/9876543']);
  });

  it('resolves nested field paths across several templates', () => {
    expect(resolveTopicTemplates(['{name}', '{ship.id}'], 'n', '{"ship":{"id":"x"}}')).toEqual(['n', 'x']);
  });

  it('does not parse the message when only {name} is used', () => {
    expect(resolveTopicTemplates(['{name}'], 'n', 'not json')).toEqual(['n']);
  });

  it.each([
    ['missing', '{}'],
    ['null', '{"id":null}'],
    ['empty string', '{"id":""}'],
    ['object', '{"id":{"a":1}}']
  ])('skips the message when the field is %s', (_label, data) => {
    expect(resolveTopicTemplates(['{name}/{id}'], 'n', data)).toBeUndefined();
  });

  it('throws when a field is needed and the message is not JSON', () => {
    expect(() => resolveTopicTemplates(['{id}'], 'n', 'not json')).toThrow();
  });

  it('sanitizes placeholder values but keeps literal separators', () => {
    expect(resolveTopicTemplates(['{name}/{v}'], 'a/b+c', '{"v":"x#y"}')).toEqual(['a_b_c/x_y']);
  });
});

describe('sanitizeTopicValue', () => {
  it('replaces MQTT wildcards, separators and NUL', () => {
    expect(sanitizeTopicValue('a+b#c/d\0e')).toBe('a_b_c_d_e');
  });
});

describe('validateTopicTemplate', () => {
  it('accepts templates without literal wildcards', () => {
    expect(() => validateTopicTemplate('sensors/{id}')).not.toThrow();
  });

  it.each(['sensors/+/{id}', 'sensors/#'])('rejects %s', (template) => {
    expect(() => validateTopicTemplate(template)).toThrow(/wildcards/);
  });
});
