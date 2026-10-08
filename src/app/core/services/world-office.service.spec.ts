import { TestBed } from '@angular/core/testing';
import { WorldOfficeService } from './world-office.service';

const LS_KEY = 'rehabilitar_wo_token_v1';

function mockFetchOk(): void {
  (globalThis as any).fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ data: [] }),
  });
}

function mockFetchUnauthorized(): void {
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => JSON.stringify({ userMessage: 'Token inválido' }),
  });
}

describe('WorldOfficeService — persistencia del token (localStorage)', () => {
  beforeEach(() => {
    localStorage.removeItem(LS_KEY);
    TestBed.configureTestingModule({});
  });

  it('guarda el token en localStorage tras un conectar() exitoso', async () => {
    mockFetchOk();
    const wo = TestBed.inject(WorldOfficeService);
    const r = await wo.conectar('abc123', 'WO ');
    expect(r.ok).toBe(true);
    const guardado = JSON.parse(localStorage.getItem(LS_KEY)!);
    expect(guardado).toEqual({ token: 'abc123', authPrefix: 'WO ' });
  });

  it('precarga el token guardado para la siguiente sesión del servicio', async () => {
    mockFetchOk();
    const wo1 = TestBed.inject(WorldOfficeService);
    await wo1.conectar('xyz789', 'WO ');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const wo2 = TestBed.inject(WorldOfficeService);
    expect(wo2.tokenGuardado()).toEqual({ token: 'xyz789', authPrefix: 'WO ' });
  });

  it('borra el token guardado si World Office lo rechaza (401)', async () => {
    mockFetchOk();
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('token-viejo', 'WO ');
    expect(localStorage.getItem(LS_KEY)).not.toBeNull();

    mockFetchUnauthorized();
    const r = await wo.conectar('token-viejo', 'WO ');
    expect(r.ok).toBe(false);
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it('cerrarSesion() borra el token guardado y resetea el estado en memoria', async () => {
    mockFetchOk();
    const wo = TestBed.inject(WorldOfficeService);
    await wo.conectar('abc123', 'WO ');
    expect(wo.cat()).not.toBeNull();

    wo.cerrarSesion();
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(wo.token()).toBe('');
    expect(wo.cat()).toBeNull();
    expect(wo.tokenGuardado()).toBeNull();
  });
});
