import http from 'http';
import { AddressInfo } from 'net';

export interface TestServer {
  url: string;
  requests: { method: string; path: string; headers: http.IncomingHttpHeaders; body: string }[];
  close(): Promise<void>;
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string, count: number) => void;

/** Starts a local HTTP server; the handler also gets the request body and a 1-based request count. */
export async function startServer(handler: Handler): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      handler(req, res, body, requests.length);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    })
  };
}

export function sendEvents(res: http.ServerResponse, events: string[], end = true): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.flushHeaders();
  for (const event of events) res.write(event);
  if (end) res.end();
}
