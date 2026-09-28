#!/usr/bin/env node
import dotenv from 'dotenv';
import {SseToMqtt} from './bridge';
import {loadConfig, resolveConfigPath} from './config';

dotenv.config();

function printUsage(): void {
    console.log(`Usage: sse-to-mqtt --config <path>

Bridge one or more Server-Sent Events streams to MQTT.

Options:
  -c, --config <path>   JSON config file (or SSE_TO_MQTT_CONFIG)
  -h, --help            Show this help
`);
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        printUsage();
        return;
    }

    const configPath = resolveConfigPath(argv);
    if (!configPath) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const config = loadConfig(configPath);
    const bridge = new SseToMqtt(config);

    const shutdown = async () => {
        await bridge.stop();
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void shutdown();
    });
    process.on('SIGTERM', () => {
        void shutdown();
    });

    bridge.start();
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
