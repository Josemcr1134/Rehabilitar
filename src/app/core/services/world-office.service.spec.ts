import { TestBed } from '@angular/core/testing';
import { WorldOfficeService } from './world-office.service';

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
