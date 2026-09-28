import {EventEmitter} from 'events';
import {consoleLogger} from './logger';
import {MQTTPublisher} from './mqttPublisher';
import {SseStream} from './sseStream';
import {resolveTopic} from './topic';
import {Logger, SseToMqttOptions} from './types';

export class SseToMqtt extends EventEmitter {
    private readonly publisher: MQTTPublisher;
    private readonly streams: SseStream[] = [];
    private readonly logger: Logger;
    private running = false;

    constructor(private readonly options: SseToMqttOptions) {
        super();

        if (!options.streams?.length) {
            throw new Error('At least one SSE stream is required');
        }
        if (!options.topic) {
            throw new Error('MQTT topic or topic resolver is required');
        }

        this.logger = options.logger ?? consoleLogger;
        this.publisher = new MQTTPublisher(options.mqtt, this.logger);
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;

        for (const stream of this.options.streams) {
            const sse = new SseStream(
                stream,
                (payload) => this.handleMessage(payload, stream),
                this.logger,
                this.options.reconnect,
            );
            this.streams.push(sse);
            sse.start();
        }
    }

    async stop(): Promise<void> {
        this.running = false;
        for (const stream of this.streams) {
            stream.stop();
        }
        this.streams.length = 0;
        await this.publisher.close();
    }

    private handleMessage(payload: string, stream: SseToMqttOptions['streams'][number]): void {
        const topic = resolveTopic(this.options.topic, this.options.topicKey, payload, stream);
        if (!topic) {
            return;
        }

        this.emit('message', {topic, payload, stream});
        this.publisher.publish(topic, payload);
    }
}
