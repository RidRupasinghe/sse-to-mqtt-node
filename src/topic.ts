import {StreamConfig, TopicContext, TopicResolver} from './types';

export function getByPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
        if (current == null || typeof current !== 'object') {
            return undefined;
        }
        return (current as Record<string, unknown>)[key];
    }, value);
}

export function parseJson(payload: string): unknown {
    try {
        return JSON.parse(payload);
    } catch {
        return undefined;
    }
}

export function resolveTopic(
    topic: TopicResolver,
    topicKey: string | undefined,
    payload: string,
    stream: StreamConfig,
): string | null {
    const parsed = parseJson(payload);
    const ctx: TopicContext = {payload, parsed, stream};

    if (typeof topic === 'function') {
        return topic(ctx) ?? null;
    }

    if (topicKey) {
        if (parsed === undefined) {
            return null;
        }
        const keyValue = getByPath(parsed, topicKey);
        if (keyValue == null || keyValue === '') {
            return null;
        }
        return [topic, stream.name, String(keyValue)].filter(Boolean).join('/');
    }

    return [topic, stream.name].filter(Boolean).join('/');
}
