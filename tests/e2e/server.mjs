import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixtureUrl = new URL('../fixtures/editor.html', import.meta.url);
const server = createServer(async (request, response) => {
  const pageUrl = new URL(request.url ?? '/', 'http://127.0.0.1').pathname === '/' ? fixtureUrl : null;
  if (pageUrl === null) {
    response.writeHead(404).end('Not found');
    return;
  }
  const html = await readFile(fileURLToPath(pageUrl));
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
});

server.listen(4173, '127.0.0.1');
