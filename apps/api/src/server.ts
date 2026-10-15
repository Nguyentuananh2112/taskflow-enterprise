import { createServer, type RequestListener, type Server } from 'node:http';

/**
 * HTTP server cho app Express. Socket.io (Phase 3) gắn vào server này:
 * `new Server(httpServer, …)`, và đăng ký closer `realtime` trong graceful shutdown.
 *
 * `keepAliveTimeout` > idle timeout của load balancer (thường 60s) để LB không gửi request
 * vào kết nối Node vừa đóng (lỗi 502 ngắt quãng).
 */
export function createHttpServer(app: RequestListener): Server {
  const server = createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
  return server;
}

export function listen(server: Server, port: number, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
