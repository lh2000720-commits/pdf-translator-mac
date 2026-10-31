// Package-private HTTP surface used by the Web panel. Same trust gate as the host /api channel.
const PREFIX = '/pdf-translator-mac';

function json(res, status, body) {
  const buffer = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buffer.length,
    'cache-control': 'no-store',
  });
  res.end(buffer);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('请求内容过大。');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx host context that provides webServer + connection
 * @param {import('./manager.js').TranslationManager} manager
 * @returns {() => void} disposer
 */
export function registerRoutes(ctx, manager) {
  const webServer = ctx.webServer;
  const connection = ctx.connection;
  const routes = {
    status: () => manager.status(),
    inspect: (body) => manager.inspect(body.path),
    start: (body) => manager.start(body),
    cancel: (body) => manager.cancel(body.taskId),
    open: (body) => manager.open(body.taskId, body.kind),
    list: (body) => manager.listDir(body.path),
    pick: (body) => manager.pick(body.kind),
    defaults: (body) => manager.saveDefaults(body),
  };

  return webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => {
      const rejection = connection.requestRejection(req);
      if (rejection !== undefined) {
        json(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' });
        return;
      }
      const url = new URL(req.url || '/', 'http://local');
      const action = url.pathname.replace(PREFIX + '/api/', '').replace(/\/+$/, '');
      const route = routes[action];
      if (!route) {
        json(res, 404, { ok: false, error: 'unknown action' });
        return;
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      readBody(req)
        .then((body) => route(body))
        .then((value) => json(res, 200, { ok: true, ...value }))
        .catch((error) => {
          const message = error?.message || String(error);
          console.error('[pdf-translator-mac] api error:', message);
          json(res, 400, { ok: false, error: message });
        });
    },
  });
}
