const PLACEHOLDER = /\{([^{}]+)\}/g;
// Characters MQTT forbids in published topics (+, #, NUL) plus the level separator
const UNSAFE_VALUE = /[+#/\0]/g;

/** Replaces characters that would break or restructure an MQTT topic. */
export function sanitizeTopicValue(value: string): string {
  return value.replace(UNSAFE_VALUE, '_');
}

/** Throws if the literal (non-placeholder) part of a template contains MQTT wildcards. */
export function validateTopicTemplate(template: string): void {
  const literal = template.replace(PLACEHOLDER, '');
  if (/[+#\0]/.test(literal)) {
    throw new Error(`Topic "${template}" must not contain MQTT wildcards (+, #)`);
  }
}

// Parses the message only if a template needs a field from it
class LazyJson {
  private parsed = false;
  private value: unknown;

  constructor(private readonly raw: string) {}

  public get(path: string): unknown {
    if (!this.parsed) {
      this.value = JSON.parse(this.raw);
      this.parsed = true;
    }

    return path.split('.').reduce<unknown>(
      (current, key) => (current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined),
      this.value
    );
  }
}

/**
 * Fills `{name}` with the connection name and `{field.path}` with fields of the JSON message.
 * Returns undefined when any placeholder has no value, meaning the message should be skipped.
 * Throws if a field placeholder is used and the message is not valid JSON.
 */
export function resolveTopicTemplates(templates: string[], connectionName: string, data: string): string[] | undefined {
  const message = new LazyJson(data);
  const resolved: string[] = [];

  for (const template of templates) {
    let unresolved = false;

    const segment = template.replace(PLACEHOLDER, (_match: string, key: string) => {
      const value = key === 'name' ? connectionName : message.get(key);

      if (value === undefined || value === null || value === '' || typeof value === 'object') {
        unresolved = true;
        return '';
      }
      return sanitizeTopicValue(String(value));
    });

    if (unresolved) return undefined;
    resolved.push(segment);
  }

  return resolved;
}
