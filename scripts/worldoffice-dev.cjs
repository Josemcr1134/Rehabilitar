/* Servidor local para probar el backend /api/worldoffice con `npm start`.
 *
 *   1. Crear el archivo .env.local en la raíz del proyecto (NO se sube a GitHub):
 *        WO_API_TOKEN=token-de-world-office
 *        APP_ACCESS_KEY=una-clave-que-inventes
 *   2. En una terminal:  npm run wo:dev     (queda escuchando en http://localhost:3001)
 *   3. En otra terminal: npm start          (proxy.conf.json envía /api/worldoffice aquí)
 *
 * En producción no se usa este archivo: Vercel ejecuta api/worldoffice.js
 * directamente y las variables se configuran en Vercel › Settings › Environment Variables.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const archivoEnv = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(archivoEnv)) {
  for (const linea of fs.readFileSync(archivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !esComentario(linea) && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} else {
  console.warn('Aviso: no existe .env.local — el backend responderá que faltan WO_API_TOKEN y APP_ACCESS_KEY.');
}
function esComentario(l) { return /^\s*#/.test(l); }

const handler = require('../api/worldoffice.js');
const PUERTO = Number(process.env.WO_DEV_PORT || 3001);
http.createServer((req, res) => {
  if (req.url.startsWith('/api/worldoffice')) return handler(req, res);
  res.statusCode = 404; res.end('Solo /api/worldoffice');
}).listen(PUERTO, () => console.log(`Backend World Office local en http://localhost:${PUERTO}/api/worldoffice`));
