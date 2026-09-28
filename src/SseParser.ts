/** A dispatched Server-Sent Event. */
export interface SseEvent {
  /** Event payload; multiple `data:` lines are joined with `\n`. */
  data: string;
  /** Event type from the `event:` field, `message` when not set. */
  event: string;
  /** Last event ID seen on the stream, if any. */
  id?: string;
}

/**
 * Line-based parser following the WHATWG Server-Sent Events format.
 * Feed it lines without their line terminator; events are dispatched on blank lines.
 */
export class SseParser {
  private dataLines: string[] = [];
  private eventType = '';
  private firstLine = true;

  /** ID of the last event seen, sent as `Last-Event-ID` on reconnect. */
  public lastEventId?: string;
  /** Reconnection delay requested by the server via `retry:`. */
  public retryMs?: number;

  constructor(private readonly onEvent: (event: SseEvent) => void) {}

  public push(line: string): void {
    if (this.firstLine) {
      this.firstLine = false;
      line = line.replace(/^\uFEFF/, '');
    }

    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'data':
        this.dataLines.push(value);
        break;
      case 'event':
        this.eventType = value;
        break;
      case 'id':
        if (!value.includes('\0')) this.lastEventId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retryMs = Number(value);
        break;
    }
  }

  /** Discards a partially received event, e.g. when the stream ends. */
  public reset(): void {
    this.dataLines = [];
    this.eventType = '';
    this.firstLine = true;
  }

  private dispatch(): void {
    if (this.dataLines.length > 0) {
      this.onEvent({
        data: this.dataLines.join('\n'),
        event: this.eventType || 'message',
        id: this.lastEventId
      });
    }
    this.dataLines = [];
    this.eventType = '';
  }
}
