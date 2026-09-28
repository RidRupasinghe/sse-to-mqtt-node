import fs from 'fs';
import path from 'path';
import {BridgeConfigFile} from './types';

export function interpolateEnv(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.replace(/\$\{([^}]+)}/g, (_, key: string) => process.env[key] ?? '');
    }
    if (Array.isArray(value)) {
        return value.map(interpolateEnv);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, interpolateEnv(nested)]),
        );
    }
    return value;
}

export function loadConfig(configPath: string): BridgeConfigFile {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Config file not found: ${resolved}`);
    }

    const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as BridgeConfigFile;
    return interpolateEnv(raw) as BridgeConfigFile;
}

export function resolveConfigPath(argv: string[]): string | undefined {
    const flagIndex = argv.findIndex((arg) => arg === '--config' || arg === '-c');
    if (flagIndex >= 0) {
        return argv[flagIndex + 1];
    }

    const inline = argv.find((arg) => arg.startsWith('--config='));
    if (inline) {
        return inline.slice('--config='.length);
    }

    return process.env.SSE_TO_MQTT_CONFIG;
}
