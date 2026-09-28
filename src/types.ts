export type HttpMethod = 'GET' | 'POST';

export interface OAuth2ClientCredentials {
    type: 'oauth2-client-credentials';
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope?: string;
}

export interface StreamConfig {
    /** Used as a MQTT topic segment when present. */
    name?: string;
    url: string;
    method?: HttpMethod;
    headers?: Record<string, string>;
    body?: unknown;
    auth?: OAuth2ClientCredentials;
}

export interface MqttConfig {
    brokerUrl: string;
    username?: string;
    password?: string;
    clientId?: string;
    qos?: 0 | 1 | 2;
    retain?: boolean;
}

export interface TopicContext {
    payload: string;
    parsed: unknown;
    stream: StreamConfig;
}

export type TopicResolver = string | ((ctx: TopicContext) => string | null | undefined);

export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface ReconnectOptions {
    initialMs?: number;
    maxMs?: number;
}

export interface SseToMqttOptions {
    streams: StreamConfig[];
    mqtt: MqttConfig;
    /**
     * MQTT topic or topic builder.
     * When a string, the published topic is `topic[/stream.name][/topicKey value]`.
     */
    topic: TopicResolver;
    /** JSON path used as the last topic segment, e.g. `imoNumber` or `vessel.id`. */
    topicKey?: string;
    reconnect?: ReconnectOptions;
    logger?: Logger;
}

export interface BridgeConfigFile extends SseToMqttOptions {
    topic: string;
}
