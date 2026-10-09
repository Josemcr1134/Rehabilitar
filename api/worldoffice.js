/* ============================================================================
   /api/worldoffice — Backend (Vercel Function) de la integración con World Office
   Centro de Terapias Integradas Rehabilitar S.A.S.
   ----------------------------------------------------------------------------
   El navegador NUNCA ve el token de World Office: vive en la variable de entorno
   WO_API_TOKEN del proyecto en Vercel y solo esta función lo usa.

   Variables de entorno (Vercel › Settings › Environment Variables):
     WO_API_TOKEN       (obligatoria) token de World Office › Panel Seguridad › Usuarios API
     APP_ACCESS_KEY     (obligatoria) clave que la app envía en la cabecera x-rehabilitar-clave.
                        Sin ella, cualquiera que conozca la URL podría crear documentos.
     KV_REST_API_URL    (opcional) Upstash Redis / Vercel KV para el historial compartido
     KV_REST_API_TOKEN  (opcional)   y el bloqueo de duplicados en el servidor.
     WO_API_BASE        (opcional) por defecto https://api.worldoffice.cloud/api/v1

   Acciones (POST JSON salvo indicación):
     GET  ?accion=estado                 → configuración disponible (sin revelar secretos)
     POST {accion:'consultar', metodo, ruta, cuerpo}
                                          → lecturas a WO (listar*, consultas por código/ID)
     POST {accion:'enviar', metodo, ruta, cuerpo, clave, meta, forzar?}
                                          → escrituras a WO (crear/contabilizar/anular/cruzar).
                                            Con `clave` (ej. "REHABILITAR|R-15993") bloquea
                                            duplicados y guarda el resultado en el historial.
     GET  ?accion=historial[&limite=200]  → últimos envíos
     POST {accion:'claves', claves:[...]} → estado de esas claves en el historial

   Solo se reenvían los servicios de World Office de la lista blanca RUTAS.
   La regla "/api/:ruta*" de vercel.json (Medifolios) no afecta esta función:
   Vercel da prioridad a los archivos/funciones antes que a los rewrites.
   ============================================================================ */
'use strict';

const WO_BASE = (process.env.WO_API_BASE || 'https://api.worldoffice.cloud/api/v1').replace(/\/+$/, '');

/* Lista blanca: [método, expresión de ruta, tipo]. 'lectura' no modifica nada en WO. */
const RUTAS = [
  ['POST', /^\/empresas\/listarEmpresas$/,                         'lectura'],
  ['POST', /^\/documentosTipos\/listarPrefijoDocumento$/,          'lectura'],
  ['POST', /^\/formasDePago\/listarFormaPagoDocumento$/,           'lectura'],
  ['POST', /^\/contabilidad\/listarFormasPagoContable$/,           'lectura'],
  ['POST', /^\/monedas\/listarMonedas$/,                           'lectura'],
  ['POST', /^\/bodegas\/listarBodega$/,                            'lectura'],
  ['POST', /^\/centrosDeCosto\/listarCentroCosto$/,                'lectura'],
  ['POST', /^\/documentos\/listarDocumentoVenta$/,                 'lectura'],
  ['POST', /^\/contabilidad\/listarDocContable$/,                  'lectura'],
  ['POST', /^\/contabilidad\/cuentasPorCobrar\/\d+\/\d+$/,         'lectura'],
  ['GET',  /^\/terceros\/identificacion\/[\w.\-]{1,30}$/,          'lectura'],
  ['GET',  /^\/inventarios\/consultaCodigo\/[\w.\-]{1,30}$/,       'lectura'],
  ['GET',  /^\/cuentasContables\/consultaCodigo\/\d{1,12}$/,       'lectura'],
  ['GET',  /^\/documentos\/getDocumentoId\/\d+$/,                  'lectura'],
  ['GET',  /^\/contabilidad\/consultar\/\d+$/,                     'lectura'],
  ['POST', /^\/documentos\/crearDocumentoVenta$/,                  'escritura'],
  ['POST', /^\/documentos\/contabilizarDocumento\/\d+$/,           'escritura'],
  ['POST', /^\/documentos\/anularDocumento\/\d+$/,                 'escritura'],
  ['POST', /^\/contabilidad\/crearDocContable$/,                   'escritura'],
  ['POST', /^\/contabilidad\/anularDocumento\/\d+$/,               'escritura'],
  ['GET',  /^\/contabilidad\/cuentasPorCobrar\/documento\/\d+\/tercero\/\d+\/cruzarCuentas\/\d+(,\d+)*$/, 'escritura']
];
const RUTAS_CREACION = /^\/(documentos\/crearDocumentoVenta|contabilidad\/crearDocContable)$/;

/* ---------------------------------------------------------------------------
   Historial / duplicados en Upstash Redis (Vercel KV) por su API REST.
   Sin esas variables la función sigue funcionando; el historial queda solo
   en el navegador y el control de duplicados se hace contra World Office.
   --------------------------------------------------------------------------- */
const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KV_ON = !!(KV_URL && KV_TOKEN);
const PREFIJO_KV = 'rehabilitar:wo:';

async function kv(comando){
  const r = await fetch(KV_URL, {method:'POST', headers:{Authorization:'Bearer ' + KV_TOKEN, 'Content-Type':'application/json'}, body:JSON.stringify(comando)});
  const j = await r.json().catch(()=>({}));
  if(!r.ok || j.error) throw new Error('KV: ' + (j.error || r.status));
  return j.result;
}
const kvClave = c => PREFIJO_KV + 'doc:' + String(c).toUpperCase().replace(/\s+/g, '');

async function leerClaves(claves){
  if(!KV_ON || !claves.length) return {};
  const res = await kv(['MGET'].concat(claves.map(kvClave)));
  const out = {};
  claves.forEach((c, i)=>{ if(res && res[i]) { try{ out[c] = JSON.parse(res[i]); }catch(e){} } });
  return out;
}
async function registrar(entrada){
  if(!KV_ON) return false;
  const linea = JSON.stringify(entrada);
  await kv(['LPUSH', PREFIJO_KV + 'historial', linea]);
  await kv(['LTRIM', PREFIJO_KV + 'historial', '0', '9999']);
  if(entrada.clave && entrada.creado) await kv(['SET', kvClave(entrada.clave), linea]);
  return true;
}
/* Reserva atómica de la clave mientras se crea el documento: dos pestañas o dos
   personas enviando el mismo día no pueden crear el mismo documento dos veces. */
async function reservar(clave){
  if(!KV_ON) return true;
  const r = await kv(['SET', kvClave(clave) + ':lock', '1', 'NX', 'EX', '120']);
  return r === 'OK';
}
async function liberar(clave){ if(KV_ON) await kv(['DEL', kvClave(clave) + ':lock']).catch(()=>{}); }

/* --------------------------------------------------------------------------- */
function responder(res, status, cuerpo){
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(cuerpo));
}
async function leerCuerpo(req){
  if(req.body && typeof req.body === 'object') return req.body;
  if(typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const partes = []; let total = 0;
  for await (const p of req){ total += p.length; if(total > 2e6) throw new Error('Cuerpo demasiado grande'); partes.push(p); }
  const txt = Buffer.concat(partes).toString('utf8');
  return txt ? JSON.parse(txt) : {};
}
function claveValida(req){
  const esperada = process.env.APP_ACCESS_KEY || '';
  const recibida = String(req.headers['x-rehabilitar-clave'] || '');
  if(!esperada || recibida.length !== esperada.length) return false;
  let dif = 0;
  for(let i=0;i<esperada.length;i++) dif |= esperada.charCodeAt(i) ^ recibida.charCodeAt(i);
  return dif === 0;
}
function rutaPermitida(metodo, ruta){
  const r = RUTAS.find(([m, re]) => m === metodo && re.test(ruta));
  return r ? r[2] : null;
}

async function llamarWO(metodo, ruta, cuerpo){
  const r = await fetch(WO_BASE + ruta, {
    method: metodo,
    headers: {Authorization: 'WO ' + process.env.WO_API_TOKEN, 'Content-Type':'application/json', Accept:'application/json'},
    body: metodo === 'GET' || cuerpo === undefined || cuerpo === null ? undefined : JSON.stringify(cuerpo)
  });
  const txt = await r.text();
  let json = null; try{ json = JSON.parse(txt); }catch(e){}
  return {status: r.status, ok: r.ok, json, texto: json ? undefined : txt.slice(0, 500)};
}
function mensajeWO(r){
  const j = r.json || {};
  return j.userMessage || j.detail || j.title || (j.developerMessage && JSON.stringify(j.developerMessage)) || r.texto || ('HTTP ' + r.status);
}

/* --------------------------------------------------------------------------- */
async function handler(req, res){
  try{
    if(req.method === 'OPTIONS'){ res.statusCode = 204; return res.end(); }
    const q = new URL(req.url, 'http://localhost').searchParams;
    const accionGet = q.get('accion');

    if(req.method === 'GET' && accionGet === 'estado'){
      /* No exige clave: solo dice qué está configurado, nunca los valores. */
      return responder(res, 200, {tokenConfigurado: !!process.env.WO_API_TOKEN,
        claveConfigurada: !!process.env.APP_ACCESS_KEY, historialCompartido: KV_ON, base: WO_BASE});
    }
    if(!process.env.APP_ACCESS_KEY)
      return responder(res, 503, {error:'Falta configurar APP_ACCESS_KEY en las variables de entorno de Vercel.'});
    if(!claveValida(req))
      return responder(res, 401, {error:'Clave de acceso de la aplicación inválida.'});

    if(req.method === 'GET' && accionGet === 'historial'){
      if(!KV_ON) return responder(res, 200, {persistente:false, items:[]});
      const limite = Math.min(1000, Math.max(1, Number(q.get('limite')) || 200));
      const items = (await kv(['LRANGE', PREFIJO_KV + 'historial', '0', String(limite - 1)])) || [];
      return responder(res, 200, {persistente:true, items: items.map(x=>{ try{ return JSON.parse(x); }catch(e){ return null; } }).filter(Boolean)});
    }
    if(req.method !== 'POST') return responder(res, 405, {error:'Método no permitido'});

    const body = await leerCuerpo(req);
    if(body.accion === 'claves'){
      const claves = Array.isArray(body.claves) ? body.claves.slice(0, 2000).map(String) : [];
      return responder(res, 200, {persistente: KV_ON, registros: await leerClaves(claves)});
    }
    if(body.accion !== 'consultar' && body.accion !== 'enviar')
      return responder(res, 400, {error:'Acción desconocida'});
    if(!process.env.WO_API_TOKEN)
      return responder(res, 503, {error:'Falta configurar WO_API_TOKEN en las variables de entorno de Vercel.'});

    const metodo = String(body.metodo || 'POST').toUpperCase();
    const ruta = String(body.ruta || '');
    const tipo = rutaPermitida(metodo, ruta);
    if(!tipo) return responder(res, 403, {error:`Servicio no permitido: ${metodo} ${ruta}`});
    if(tipo === 'escritura' && body.accion !== 'enviar')
      return responder(res, 400, {error:'Las operaciones que modifican World Office deben usar accion=enviar.'});

    /* --- Lecturas --- */
    if(tipo === 'lectura'){
      const r = await llamarWO(metodo, ruta, body.cuerpo);
      return responder(res, r.status, r.ok ? (r.json || {}) : {error: mensajeWO(r), woStatus: r.status, wo: r.json});
    }

    /* --- Escrituras --- */
    const clave = body.clave ? String(body.clave) : '';
    const esCreacion = RUTAS_CREACION.test(ruta);
    if(esCreacion && !clave)
      return responder(res, 400, {error:'Para crear documentos se requiere la clave del documento (control de duplicados).'});
    if(esCreacion && !body.forzar){
      const prev = (await leerClaves([clave]))[clave];
      if(prev && prev.creado)
        return responder(res, 409, {error:`Ya fue enviado el ${prev.fecha} (ID World Office ${prev.idWO || '?'}). No se reenvía.`, previo: prev});
      if(!(await reservar(clave)))
        return responder(res, 409, {error:'Este documento se está enviando en este momento desde otra sesión.'});
    }
    let r;
    try{ r = await llamarWO(metodo, ruta, body.cuerpo); }
    finally{ if(esCreacion) await liberar(clave); }

    const data = (r.json && r.json.data) || {};
    const entrada = {
      fecha: new Date().toISOString(), clave, ruta, metodo, ok: r.ok, status: r.status,
      creado: esCreacion && r.ok, idWO: data.id || null, numeroWO: data.numero || null,
      mensaje: r.ok ? ((r.json && r.json.userMessage) || 'OK') : mensajeWO(r),
      meta: body.meta && typeof body.meta === 'object' ? body.meta : undefined
    };
    if(clave || esCreacion){ try{ await registrar(entrada); }catch(e){ entrada.historialError = e.message; } }
    return responder(res, r.ok ? 200 : r.status, r.ok ? Object.assign({}, r.json || {}, {_registro: entrada})
                                                     : {error: entrada.mensaje, woStatus: r.status, wo: r.json, _registro: entrada});
  }catch(e){
    return responder(res, 500, {error: 'Error interno: ' + e.message});
  }
}
module.exports = handler;
module.exports.default = handler;
module.exports._interno = {rutaPermitida, RUTAS};
