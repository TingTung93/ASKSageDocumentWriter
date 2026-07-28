import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = process.env.ASD_PROXY_HOST || '127.0.0.1';
const port = Number(process.env.ASD_PROXY_PORT || 4173);
const root = resolve(fileURLToPath(new URL('../release', import.meta.url)));
const upstream = 'https://api.genai.mil';
const proxyPrefix = '/api/genai';
const maxBodyBytes = 10 * 1024 * 1024;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || host}`);
    if (url.pathname === proxyPrefix || url.pathname.startsWith(`${proxyPrefix}/`)) {
      await proxyGenAI(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    response.end(`Proxy server error: ${message}`);
  }
});

server.listen(port, host, () => {
  console.log(`Ask Sage Document Writer: http://${host}:${port}`);
  console.log(`GenAI.mil proxy: http://${host}:${port}${proxyPrefix}/v1`);
});

async function proxyGenAI(request, response, url) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.writeHead(405, { Allow: 'GET, POST' });
    response.end();
    return;
  }

  const upstreamPath = url.pathname.slice(proxyPrefix.length);
  if (upstreamPath !== '/v1/models' && upstreamPath !== '/v1/chat/completions') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Unsupported GenAI.mil proxy route.' } }));
    return;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Missing bearer API key.' } }));
    return;
  }

  const body = request.method === 'POST' ? await readBody(request) : undefined;
  const upstreamResponse = await fetch(`${upstream}${upstreamPath}`, {
    method: request.method,
    headers: {
      Authorization: authorization,
      ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json',
  };
  const retryAfter = upstreamResponse.headers.get('retry-after');
  if (retryAfter) headers['Retry-After'] = retryAfter;
  response.writeHead(upstreamResponse.status, headers);
  response.end(responseBody);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error('Request body exceeds 10 MB.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = normalize(decodeURIComponent(requested)).replace(/^([/\\])+/, '');
  const filePath = resolve(join(root, normalized));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    const fallback = join(root, 'index.html');
    const html = await readFile(fallback);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(html);
    return;
  }

  if (!info.isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}
