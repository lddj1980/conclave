import express, { Request, Response } from 'express';
import cors from 'cors';
import { createMcpServer } from './mcp/server.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import apiRouter from './routes/api.js';
import { randomUUID } from 'node:crypto';

import { rateLimiter } from './middleware/rate-limiter.js';

import { seedHouseBots, runHouseBotsLoop } from './engine/house-bots.js';
import { runTimeoutsLoop } from './engine/timeouts.js';

const PORT = process.env.PORT || 3012;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const mcpServer = createMcpServer();

  // If started with --stdio, run as standard MCP command line server
  if (process.argv.includes('--stdio') || process.env.CONCLAVE_TRANSPORT === 'stdio') {
    // Redirect console logs to stderr so stdout remains clean for MCP JSON-RPC protocol
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => originalError('[INFO]', ...args);

    void withTimeout(seedHouseBots(), 8000, 'House bots seed')
      .then(() => {
        runHouseBotsLoop();
        runTimeoutsLoop();
        console.log('House bots ready.');
      })
      .catch((err) => {
        console.error('House bots bootstrap skipped:', err.message);
      });
    
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    originalError('Conclave MCP Server running on Stdio');
    return;
  }

  // Seed standard bots without blocking API startup
  void withTimeout(seedHouseBots(), 8000, 'House bots seed')
    .then(() => {
      runHouseBotsLoop();
      runTimeoutsLoop();
      console.log('House bots ready.');
    })
    .catch((err) => {
      console.error('House bots bootstrap skipped:', err.message);
    });

  // Otherwise, run Express server with REST API + SSE MCP transport
  const app = express();
  app.use(cors());

  const allowOrigin = (origin: string | undefined) => {
    if (!origin || origin === 'null') return true;
    if (origin.startsWith('vscode-webview://')) return true;
    if (origin.startsWith('vscode-file://')) return true;
    if (origin.startsWith('vscode://')) return true;
    if (origin.startsWith('file://')) return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  };

  type StreamMode = 'json' | 'sse';
  class StreamableHttpTransport {
    onclose?: () => void;
    onerror?: (error: unknown) => void;
    onmessage?: (message: any) => void;

    private _notificationRes: Response | null = null;
    private _pending:
      | {
          requestId: string | number | null | undefined;
          res: Response;
          mode: StreamMode;
          resolve: () => void;
        }
      | null = null;

    async start() {}

    async close() {
      try {
        this._notificationRes?.end();
      } catch (e) {}
      this._notificationRes = null;
      this.onclose?.();
    }

    attachNotificationStream(res: Response | null) {
      this._notificationRes = res;
    }

    clearNotificationStreamIf(res: Response) {
      if (this._notificationRes === res) this._notificationRes = null;
    }

    private async handleMessage(message: unknown) {
      let parsedMessage: any;
      try {
        parsedMessage = JSONRPCMessageSchema.parse(message);
      } catch (error) {
        this.onerror?.(error);
        throw error;
      }
      this.onmessage?.(parsedMessage);
    }

    async handleHttpPost(message: unknown, res: Response, mode: StreamMode) {
      const requestId =
        message && typeof message === 'object' && 'id' in (message as any) ? ((message as any).id as any) : undefined;

      if (mode === 'sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }

      if (!requestId) {
        await this.handleMessage(message);
        if (!res.headersSent) res.status(202).end('Accepted');
        return;
      }

      if (this._pending) {
        res.status(409).json({ error: 'Another request is in progress for this session' });
        return;
      }

      await new Promise<void>((resolve) => {
        this._pending = { requestId, res, mode, resolve };
        void this.handleMessage(message).catch(() => {});
      });
    }

    async send(message: any) {
      try {
        const pending = this._pending;
        const out = message;
        if (pending) {
          if (pending.mode === 'sse') {
            pending.res.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
            const sameId = 'id' in out ? out.id === pending.requestId : false;
            if (sameId) {
              pending.res.end();
              this._pending = null;
              pending.resolve();
            }
            return;
          }

          pending.res.status(200).json(out);
          this._pending = null;
          pending.resolve();
          return;
        }

        if (this._notificationRes) {
          this._notificationRes.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
        }
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  const httpSessions = new Map<
    string,
    {
      transport: StreamableHttpTransport;
      server: ReturnType<typeof createMcpServer>;
      lastSeenAt: number;
    }
  >();

  const getSessionIdHeader = (req: Request) => {
    const h = req.header('mcp-session-id') || req.header('Mcp-Session-Id');
    return h ? String(h) : null;
  };

  const createHttpSession = async () => {
    const server = createMcpServer();
    const transport = new StreamableHttpTransport();
    await server.connect(transport as any);
    const sessionId = randomUUID();
    httpSessions.set(sessionId, { server, transport, lastSeenAt: Date.now() });
    return { sessionId, server, transport };
  };

  app.get('/mcp', async (req, res) => {
    if (!allowOrigin(req.headers.origin as any)) return res.status(403).send('Forbidden');
    const sessionId = getSessionIdHeader(req);
    if (!sessionId) return res.status(400).send('Missing Mcp-Session-Id');
    const session = httpSessions.get(sessionId);
    if (!session) return res.status(404).send('Session not found');
    session.lastSeenAt = Date.now();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    session.transport.attachNotificationStream(res);

    req.on('close', () => {
      session.transport.clearNotificationStreamIf(res);
    });
  });

  app.post('/mcp', express.json({ limit: '4mb' }), async (req, res) => {
    if (!allowOrigin(req.headers.origin as any)) return res.status(403).send('Forbidden');

    const accept = String(req.headers.accept || '');
    const wantsSse = accept.includes('text/event-stream');
    const mode: StreamMode = wantsSse ? 'sse' : 'json';

    const message = req.body;
    const method = message && typeof message === 'object' && 'method' in message ? String((message as any).method) : null;

    let sessionId = getSessionIdHeader(req);
    let session = sessionId ? httpSessions.get(sessionId) : null;

    // HTTP-tolerant mode:
    // Some MCP HTTP clients fail to persist Mcp-Session-Id between calls.
    // Instead of hard-failing non-initialize requests, create a fresh session
    // and let tools work with explicit agentId/agentName + agentToken.
    if (!session) {
      const created = await createHttpSession();
      sessionId = created.sessionId;
      session = httpSessions.get(sessionId) || null;
    }

    if (!sessionId || !session) return res.status(500).send('Failed to create session');
    session.lastSeenAt = Date.now();
    res.setHeader('Mcp-Session-Id', sessionId);

    await session.transport.handleHttpPost(message, res, mode);
  });

  app.delete('/mcp', async (req, res) => {
    if (!allowOrigin(req.headers.origin as any)) return res.status(403).send('Forbidden');
    const sessionId = getSessionIdHeader(req);
    if (!sessionId) return res.status(400).send('Missing Mcp-Session-Id');
    const session = httpSessions.get(sessionId);
    if (!session) return res.status(404).send('Session not found');
    await session.transport.close();
    httpSessions.delete(sessionId);
    res.status(204).end();
  });

  // SSE MCP connection endpoint
  const sseSessions = new Map<string, { transport: SSEServerTransport; server: ReturnType<typeof createMcpServer> }>();

  app.get('/sse', async (req, res) => {
    console.log('New client connecting via SSE');
    // Each client connection gets its own transport
    const transport = new SSEServerTransport('/message', res);
    const sessionId = String((transport as any).sessionId || '');
    if (!sessionId) {
      res.status(500).send('Failed to initialize SSE transport session');
      return;
    }
    const sessionServer = createMcpServer();
    sseSessions.set(sessionId, { transport, server: sessionServer });

    await sessionServer.connect(transport);

    req.on('close', () => {
      console.log('SSE connection closed');
      const s = sseSessions.get(sessionId);
      sseSessions.delete(sessionId);
      void s?.server.close().catch(() => {});
    });
  });

  app.post('/message', async (req, res) => {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId) return res.status(400).send('Missing sessionId');
    const session = sseSessions.get(sessionId);
    if (!session) return res.status(404).send('Session not found');
    await session.transport.handlePostMessage(req, res);
  });

  // JSON parsing should come after MCP endpoints because SSEServerTransport reads the raw request body.
  app.use(express.json());

  // REST API for Frontend Dashboard
  app.use('/api', rateLimiter(120, 60000));
  app.use('/api', apiRouter);

  app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` Conclave Backend & API: http://localhost:${PORT}`);
    console.log(` Conclave MCP SSE Server: http://localhost:${PORT}/sse`);
    console.log(`=========================================`);
  });
}

main().catch((error) => {
  console.error('Fatal server startup error:', error);
  process.exit(1);
});
