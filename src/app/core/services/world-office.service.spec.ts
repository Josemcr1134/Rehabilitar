import { TestBed } from '@angular/core/testing';
import { esSinRegistros, fechaLocal, respuestaWO, sinConfirmacion, WoApiError, WorldOfficeService } from './world-office.service';

const SS_CLAVE = 'rehabilitar_wo_clave_v1';
type Llamada = { url: string; init: RequestInit };
let llamadas: Llamada[] = [];

function mockFetch(status = 200, cuerpo: unknown = { data: [] }): void {
  llamadas = [];
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return { ok: status < 400, status, statusText: String(status), text: async () => JSON.stringify(cuerpo) };
  };
}

describe('WorldOfficeService — backend /api/worldoffice (sin token en el navegador)', () => {
  beforeEach(() => {
    sessionStorage.removeItem(SS_CLAVE);
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('habla solo con /api/worldoffice y nunca envía un token de World Office', async () => {
    mockFetch();
    const wo = TestBed.inject(WorldOfficeService);
    const r = await wo.conectar('clave-app');
    expect(r.ok).toBe(true);
    expect(llamadas.length).toBeGreaterThan(0);
    for (const l of llamadas) {
      expect(l.url.startsWith('/api/worldoffice')).toBe(true);
      const headers = l.init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['x-rehabilitar-clave']).toBe('clave-app');
    }
    const primera = JSON.parse(String(llamadas[0].init.body));
    expect(primera.accion).toBe('consultar');
  });

  it('recuerda la clave de la app solo en sessionStorage (no en localStorage)', async () => {
    mockFetch();
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    expect(sessionStorage.getItem(SS_CLAVE)).toBe('clave-app');
    expect(JSON.stringify(localStorage)).not.toContain('clave-app');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(WorldOfficeService).claveApp()).toBe('clave-app');
  });

  it('borra la clave si el servidor responde 401', async () => {
    mockFetch();
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-vieja');
    mockFetch(401, { error: 'Clave incorrecta' });
    const r = await wo.conectar('clave-vieja');
    expect(r.ok).toBe(false);
    expect(sessionStorage.getItem(SS_CLAVE)).toBeNull();
    expect(wo.cat()).toBeNull();
  });

  it('cerrarSesion() olvida la clave y resetea el estado en memoria', async () => {
    mockFetch();
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    expect(wo.cat()).not.toBeNull();
    wo.cerrarSesion();
    expect(sessionStorage.getItem(SS_CLAVE)).toBeNull();
    expect(wo.claveApp()).toBe('');
    expect(wo.cat()).toBeNull();
  });
});

describe('WorldOfficeService — pacientes nuevos', () => {
  beforeEach(() => {
    sessionStorage.removeItem(SS_CLAVE);
    TestBed.configureTestingModule({});
  });

  it('detecta los clientes que no existen como tercero en World Office', async () => {
    llamadas = [];
    (globalThis as any).fetch = async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.ruta === '/terceros/identificacion/111') return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 7, identificacion: '111' } }) };
      if (String(body.ruta || '').startsWith('/terceros/identificacion/')) return { ok: false, status: 404, statusText: '404', text: async () => JSON.stringify({ error: 'No existe' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
    };
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    const docs = [
      { documento: 'R-1', cliente: '111', nombre: 'ANA MARIA PEREZ GOMEZ', tipo: 'FV' },
      { documento: 'R-2', cliente: '222', nombre: 'LUIS ALBERTO ROJAS DIAZ', tipo: 'FV' },
      { documento: 'ANTR-3', cliente: '222', nombre: 'LUIS ALBERTO ROJAS DIAZ', tipo: 'RC' },
    ] as any[];
    const nuevos = await wo.detectarPacientesNuevos(docs);
    expect(nuevos.map((t) => [t.identificacion, t.documentos])).toEqual([['222', ['R-2', 'ANTR-3']]]);
    expect(wo.pacientesNuevos()!.length).toBe(1);
    // Ninguna llamada va directo a World Office ni lleva el token.
    expect(llamadas.every((l) => String(l.url).startsWith('/api/worldoffice') || String(l.url).startsWith('plantillas-wo/'))).toBe(true);
  });
});

describe('WorldOfficeService — respuesta «NO HAY REGISTROS» de World Office', () => {
  it('la reconoce como «no existe» y nunca confunde errores de clave o servidor', () => {
    expect(esSinRegistros(new WoApiError('NO HAY REGISTROS PARA LA PETICION REALIZADA', 400))).toBe(true);
    expect(esSinRegistros(new WoApiError('Error', 500, { userMessage: 'No hay registros para la petición realizada' }))).toBe(true);
    expect(esSinRegistros(new WoApiError('NO HAY REGISTROS', 401))).toBe(false);
    expect(esSinRegistros(new WoApiError('Timeout', 504))).toBe(false);
    expect(esSinRegistros(new Error('NO HAY REGISTROS'))).toBe(false);
  });

  it('simular no se detiene cuando la búsqueda de duplicados no encuentra nada', async () => {
    sessionStorage.removeItem(SS_CLAVE);
    TestBed.configureTestingModule({});
    (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(body.ruta || '').startsWith('/documentos/listarDocumentoVenta')) {
        return { ok: false, status: 400, statusText: '400', text: async () => JSON.stringify({ error: 'NO HAY REGISTROS PARA LA PETICION REALIZADA' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
    };
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    const yaExiste = (wo as any).yaExiste.bind(wo);
    await expect(yaExiste({ tipo: 'FV', numero: 1, prefijoWO: 'R', empresa: 'X', documento: 'R-1' })).resolves.toBeNull();
  });
});

describe('WorldOfficeService — notas contables (NC) por API', () => {
  const nota = {
    empresa: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S', prefijo: 'APL', numero: 406, fecha: '2026-10-01', tercero: '900431402',
    concepto: 'ASUME PACIENTE', verificado: 'NO' as const, anulado: 'NO' as const,
    lineas: [
      { cuenta: '42559905', concepto: 'ANA - FISIOTERAPIA - ASUME PACIENTE', tercero: '111', debito: null, credito: 23100, centroCosto: 'Sura Póliza' },
      { cuenta: '13990501', concepto: 'ANA - FISIOTERAPIA - ASUME PACIENTE', tercero: '111', debito: 23100, credito: null, centroCosto: 'Sura Póliza' },
    ],
  };
  function mockWO(existe: (id: string) => boolean) {
    llamadas = [];
    (globalThis as any).fetch = async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      const r = String(b.ruta || '');
      const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ data }) });
      if (r === '/empresas/listarEmpresas') return ok([{ id: 1, nombre: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S' }]);
      if (r === '/documentosTipos/listarPrefijoDocumento') return ok(b.cuerpo.filtros[0].valores[0] === 'NC' ? [{ id: 9, nombre: 'APL' }] : []);
      if (r === '/centrosDeCosto/listarCentroCosto') return ok([{ id: 6, nombre: 'Sura Póliza' }]);
      if (r.startsWith('/cuentasContables/consultaCodigo/')) return ok({ id: Number(r.split('/').pop()) });
      if (r.startsWith('/terceros/identificacion/')) {
        const id = r.split('/').pop()!;
        return existe(id) ? ok({ id: 'T' + id }) : { ok: false, status: 400, statusText: '400', text: async () => JSON.stringify({ error: 'NO HAY REGISTROS PARA LA PETICION REALIZADA' }) };
      }
      if (r === '/contabilidad/listarDocContable') return { ok: false, status: 400, statusText: '400', text: async () => JSON.stringify({ error: 'NO HAY REGISTROS PARA LA PETICION REALIZADA' }) };
      return ok([]);
    };
  }

  beforeEach(() => { sessionStorage.removeItem(SS_CLAVE); TestBed.configureTestingModule({}); });

  it('arma el documento NC con el mismo servicio de los recibos y simula sin crear nada', async () => {
    mockWO(() => true);
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    const r = await wo.armarNota(nota as any, true);
    expect(r.payload).toEqual({
      documentoTipo: 'NC', fecha: '2026-10-01', empresaId: 1, terceroId: 'T900431402', prefijoId: 9, concepto: 'ASUME PACIENTE', numero: 406,
      asientos: [
        { cuentaContableId: 42559905, concepto: 'ANA - FISIOTERAPIA - ASUME PACIENTE', terceroId: 'T111', valorDebito: 0, valorCredito: 23100, fechaVencimiento: '2026-10-01', centroCostosId: 6 },
        { cuentaContableId: 13990501, concepto: 'ANA - FISIOTERAPIA - ASUME PACIENTE', terceroId: 'T111', valorDebito: 23100, valorCredito: 0, fechaVencimiento: '2026-10-01', centroCostosId: 6 },
      ],
    });
    const s = await wo.enviarNotas(true, [nota as any], { conservarNumero: true, verificarDuplicados: true });
    expect(s.ok).toBe(1);
    expect(wo.logNotas()[0].estado).toBe('SIMULADO');
    expect(llamadas.some((l) => JSON.parse(String(l.init.body || '{}')).accion === 'enviar')).toBe(false);
  });

  it('si un paciente no existe la nota queda «FALTA EN WO» y no se envía', async () => {
    mockWO((id) => id !== '111');
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    await wo.enviarNotas(false, [nota as any], { conservarNumero: true, verificarDuplicados: true });
    expect(wo.logNotas()[0].estado).toBe('FALTA EN WO');
    expect(wo.logNotas()[0].detalle).toContain('111');
    expect(llamadas.some((l) => JSON.parse(String(l.init.body || '{}')).accion === 'enviar')).toBe(false);
  });
});

describe('WorldOfficeService — detalle de errores de World Office', () => {
  it('agrega la respuesta completa de World Office cuando el mensaje es solo un código', () => {
    const e = new WoApiError('ERROR: 003', 400, { error: 'ERROR: 003', woStatus: 400, wo: { userMessage: 'ERROR: 003', developerMessage: 'Numero fuera de la resolucion' } });
    expect(respuestaWO(e)).toContain('Numero fuera de la resolucion');
    expect(respuestaWO(new Error('x'))).toBe('');
  });
  it('muestra la fecha del historial en hora local', () => {
    expect(fechaLocal('no-es-fecha')).toBe('no-es-fecha');
    expect(fechaLocal('2026-10-21T00:08:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('WorldOfficeService — factura en modo básico', () => {
  it('quita concepto de encabezado, prefijo/número externo y valorTotal; respeta «conservar número»', async () => {
    sessionStorage.removeItem(SS_CLAVE);
    TestBed.configureTestingModule({});
    (globalThis as any).fetch = async (_u: string, init: RequestInit) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      const r = String(b.ruta || '');
      const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ data }) });
      if (r === '/empresas/listarEmpresas') return ok([{ id: 1, nombre: 'EMP' }]);
      if (r === '/documentosTipos/listarPrefijoDocumento') return ok(b.cuerpo.filtros[0].valores[0] === 'FV' ? [{ id: 3, nombre: 'R' }] : []);
      if (r === '/formasDePago/listarFormaPagoDocumento') return ok([{ id: 4, nombre: 'Efectivo' }]);
      if (r === '/monedas/listarMonedas') return ok([{ id: 5, codigo: 'COP', nombre: 'Peso' }]);
      if (r === '/bodegas/listarBodega') return ok([{ id: 6, nombre: 'Principal' }]);
      if (r === '/centrosDeCosto/listarCentroCosto') return ok([{ id: 7, nombre: 'Particulares' }]);
      if (r.startsWith('/terceros/identificacion/')) return ok({ id: 8 });
      if (r.startsWith('/inventarios/consultaCodigo/')) return ok({ id: 9, unidadMedida: { codigo: 'UND' } });
      return ok([]);
    };
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    const f: any = { empresa: 'EMP', prefijoWO: 'R', prefijo: 'R', numero: 16805, formaPagoWO: 'Efectivo', centroCosto: 'Particulares', cliente: '111',
      producto: '01', fecha: '2026-10-20', concepto: 'FV R-16805', cantidad: 1, valorUnitario: 70000 };
    const completo = (await wo.armarFactura(f, true)).payload;
    expect(completo.numeroExterno).toBe('16805');
    const basico = (await wo.armarFactura(f, true, true)).payload;
    expect(basico).toEqual({ fecha: '2026-10-20', prefijo: 3, documentoTipo: 'FV', idEmpresa: 1, idTerceroExterno: 8, idTerceroInterno: 8, idFormaPago: 4, idMoneda: 5, trm: 1, numero: 16805,
      reglones: [{ idInventario: 9, unidadMedida: 'UND', cantidad: 1, valorUnitario: 70000, idBodega: 6, idCentroCosto: 7, concepto: 'FV R-16805', porDescuento: 0 }] });
    expect((await wo.armarFactura(f, false, true)).payload.numero).toBeUndefined();
  });
});

describe('WorldOfficeService — envío sin confirmación', () => {
  it('distingue «pendiente de confirmar» (sin respuesta) de un error real de World Office', () => {
    expect(sinConfirmacion(new TypeError('Failed to fetch'))).toBe(true);
    expect(sinConfirmacion(new WoApiError('Sin respuesta', 504))).toBe(true);
    expect(sinConfirmacion(new WoApiError('ERROR: 003', 500))).toBe(false);
    expect(sinConfirmacion(new WoApiError('Ya fue enviado', 409))).toBe(false);
  });

  it('si la creación no tiene respuesta, la bitácora queda «PENDIENTE DE CONFIRMAR» y no «ERROR»', async () => {
    sessionStorage.removeItem(SS_CLAVE);
    TestBed.configureTestingModule({});
    (globalThis as any).fetch = async (_u: string, init: RequestInit) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      const r = String(b.ruta || '');
      const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ data }) });
      if (b.accion === 'enviar') throw new TypeError('Failed to fetch');
      if (r === '/empresas/listarEmpresas') return ok([{ id: 1, nombre: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S' }]);
      if (r === '/documentosTipos/listarPrefijoDocumento') return ok(b.cuerpo.filtros[0].valores[0] === 'NC' ? [{ id: 9, nombre: 'APL' }] : []);
      if (r === '/centrosDeCosto/listarCentroCosto') return ok([{ id: 6, nombre: 'Sura Póliza' }]);
      if (r.startsWith('/cuentasContables/consultaCodigo/') || r.startsWith('/terceros/identificacion/')) return ok({ id: 5 });
      if (r === '/contabilidad/listarDocContable') return { ok: false, status: 400, statusText: '400', text: async () => JSON.stringify({ error: 'NO HAY REGISTROS PARA LA PETICION REALIZADA' }) };
      return ok([]);
    };
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('clave-app');
    const nota: any = { empresa: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S', prefijo: 'APL', numero: 406, fecha: '2026-10-01', tercero: '900431402', concepto: 'ASUME PACIENTE',
      verificado: 'NO', anulado: 'NO', lineas: [
        { cuenta: '42559905', concepto: 'X', tercero: '111', debito: null, credito: 100, centroCosto: 'Sura Póliza' },
        { cuenta: '13990501', concepto: 'X', tercero: '111', debito: 100, credito: null, centroCosto: 'Sura Póliza' }] };
    await wo.enviarNotas(false, [nota], { conservarNumero: true, verificarDuplicados: true });
    expect(wo.logNotas()[0].estado).toBe('PENDIENTE DE CONFIRMAR');
  });
});
