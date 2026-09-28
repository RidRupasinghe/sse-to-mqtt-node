import { describe, expect, it } from 'vitest';
import { SseEvent, SseParser } from '../src/SseParser';

function parse(lines: string[]): { events: SseEvent[]; parser: SseParser } {
  const events: SseEvent[] = [];
  const parser = new SseParser((event) => events.push(event));
  lines.forEach((line) => parser.push(line));
  return { events, parser };
}

describe('SseParser', () => {
  it('dispatches an event on a blank line', () => {
    expect(parse(['data: hello', '']).events).toEqual([{ data: 'hello', event: 'message', id: undefined }]);
  });

  it('joins multi-line data with newlines', () => {
    expect(parse(['data: a', 'data: b', '']).events[0].data).toBe('a\nb');
  });

  it('strips only one leading space from values', () => {
    expect(parse(['data:  two', '']).events[0].data).toBe(' two');
    expect(parse(['data:none', '']).events[0].data).toBe('none');
  });

  it('reads event type and id, and keeps the id for later events', () => {
    const { events, parser } = parse(['event: tick', 'id: 7', 'data: x', '', 'data: y', '']);
    expect(events).toEqual([
      { data: 'x', event: 'tick', id: '7' },
      { data: 'y', event: 'message', id: '7' }
    ]);
    expect(parser.lastEventId).toBe('7');
  });

  it('ignores comments and unknown fields', () => {
    expect(parse([': keep-alive', 'foo: bar', 'data: x', '']).events).toHaveLength(1);
  });

  it('does not dispatch when there is no data', () => {
    expect(parse(['event: tick', 'id: 1', '']).events).toEqual([]);
  });

  it('dispatches an empty data field', () => {
    expect(parse(['data', '']).events[0].data).toBe('');
  });

  it('accepts only integer retry values', () => {
    expect(parse(['retry: 1500']).parser.retryMs).toBe(1500);
    expect(parse(['retry: 1.5']).parser.retryMs).toBeUndefined();
  });

  it('ignores ids containing NUL', () => {
    expect(parse(['id: a\0b']).parser.lastEventId).toBeUndefined();
  });

  it('strips a leading byte order mark', () => {
    expect(parse(['﻿data: x', '']).events[0].data).toBe('x');
  });

  it('drops a partial event on reset', () => {
    const { events, parser } = parse(['data: partial']);
    parser.reset();
    parser.push('');
    expect(events).toEqual([]);
  });
});
