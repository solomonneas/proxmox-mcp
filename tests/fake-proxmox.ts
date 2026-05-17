import { createServer, Server, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  path: string;
  authHeader: string | null;
  body: string;
}

export interface FakeRoute {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

export interface FakeProxmox {
  baseUrl: string;
  requests: CapturedRequest[];
  routes: FakeRoute[];
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeProxmox(routes: FakeRoute[] = []): Promise<FakeProxmox> {
  const fake: FakeProxmox = {
    baseUrl: "",
    requests: [],
    routes: [...routes],
    reset() { fake.requests.length = 0; fake.routes.length = 0; },
    close: () => Promise.resolve(),
  };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      fake.requests.push({
        method: req.method ?? "GET",
        path: req.url ?? "/",
        authHeader: req.headers.authorization ?? null,
        body,
      });
      const route = fake.routes.find((r) => r.method === req.method && r.path === req.url);
      if (!route) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ message: `no fake route for ${req.method} ${req.url}` }));
        return;
      }
      res.statusCode = route.status;
      res.setHeader("content-type", "application/json");
      res.end(typeof route.body === "string" ? route.body : JSON.stringify(route.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  fake.baseUrl = `http://127.0.0.1:${port}`;
  fake.close = () => new Promise<void>((r) => server.close(() => r()));
  return fake;
}
