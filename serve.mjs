/* ============================================================================
 * LOTOCALC — servidor estático de desenvolvimento
 * ----------------------------------------------------------------------------
 * O app abre direto pelo index.html; isto existe só para quem prefere HTTP
 * ao editar (recarregar sem cache, testar em outro aparelho da rede).
 *
 *   node serve.mjs [porta]
 * ==========================================================================*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.argv[2]) || 4173;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';

  const arquivo = path.resolve(RAIZ, '.' + rel);
  if (!arquivo.startsWith(RAIZ)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('fora da raiz');
    return;
  }

  fs.readFile(arquivo, (erro, dados) => {
    if (erro) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('não encontrado: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'cache-control': 'no-store'
    }).end(dados);
  });
}).listen(PORTA, () => {
  console.log('lotocalc em http://localhost:' + PORTA);
});
