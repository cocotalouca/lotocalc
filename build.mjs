/* ============================================================================
 * LOTOCALC — empacotador
 * ----------------------------------------------------------------------------
 * Junta index.html, o CSS e os scripts num único arquivo autocontido em
 * dist/lotocalc.html — bom para mandar por e-mail, abrir offline ou publicar.
 *
 *   node build.mjs
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(RAIZ, 'dist', 'lotocalc.html');

function ler(rel) {
  return fs.readFileSync(path.join(RAIZ, rel), 'utf8');
}

let html = ler('index.html');
const embutidos = [];

// <link rel="stylesheet" href="assets/css/...">  →  <style>
html = html.replace(
  /[ \t]*<link rel="stylesheet" href="(assets\/[^"]+)">\r?\n/g,
  (_, href) => {
    embutidos.push(href);
    return `<style>\n${ler(href).trim()}\n</style>\n`;
  }
);

// <script src="assets/js/...">  →  <script>
html = html.replace(
  /[ \t]*<script src="(assets\/[^"]+)"><\/script>\r?\n/g,
  (_, src) => {
    embutidos.push(src);
    return `<script>\n${ler(src).trim()}\n</script>\n`;
  }
);

const pendentes = html.match(/(?:href|src)="assets\/[^"]+"/g);
if (pendentes) {
  console.error('Sobraram referências externas:', pendentes.join(', '));
  process.exit(1);
}

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, html, 'utf8');

/* Variante para hospedagens que embrulham o conteúdo no próprio esqueleto
   <html><head>…</head><body>: sai sem doctype, sem <html>/<head>/<body> e sem
   os metas que o embrulho já fornece. */
const fragmento = html
  .replace(/<!DOCTYPE html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/[ \t]*<meta charset="utf-8">\r?\n/i, '')
  .replace(/[ \t]*<meta name="viewport"[^>]*>\r?\n/i, '')
  .replace(/<title>/i, '<script>document.documentElement.lang = "pt-BR";</script>\n<title>')
  .trim() + '\n';

const SAIDA_FRAG = path.join(RAIZ, 'dist', 'lotocalc.fragmento.html');
fs.writeFileSync(SAIDA_FRAG, fragmento, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`dist/lotocalc.html — ${kb} KB, ${embutidos.length} arquivos embutidos:`);
embutidos.forEach((f) => console.log('  · ' + f));
console.log(`dist/lotocalc.fragmento.html — ${(Buffer.byteLength(fragmento, 'utf8') / 1024).toFixed(1)} KB`);
