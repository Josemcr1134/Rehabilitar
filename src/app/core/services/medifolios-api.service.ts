import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AppStateService } from './app-state.service';
import { encontrarArrayObjetos } from '../utils/json.util';

/**
 * Cliente de la API de Medifolios. Migrado desde index.html (auth, llamarApi,
 * llamarApiPaginado, encontrarToken, cargarFormasPago). En desarrollo, Angular
 * pega a `/api` y el dev-server lo reenvía a Medifolios vía proxy.conf.json
 * (mismo destino que el rewrite de vercel.json en producción) — así se evita
 * CORS exactamente igual que en el index.html original.
 */
const API_BASE = '/api';
const RUTA_AUTH = '/auth';
const RUTA_CITAS = '/citas/listar';
const RUTA_CONSUMOS = '/consumos/buscar';
const RUTA_FACTURACION = '/facturacion/buscar';

function construirQuery(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    .join('&');
}

/** Busca un token en cualquier nivel del JSON de respuesta — la forma exacta varía según el endpoint. */
function encontrarToken(obj: unknown, depth = 0): string | null {
  if (depth > 4 || obj === null || typeof obj !== 'object') return null;
  const claves = ['token', 'accessToken', 'access_token', 'jwt', 'Token', 'TOKEN', 'authToken'];
  const o = obj as Record<string, unknown>;
  for (const k of claves) { if (typeof o[k] === 'string' && o[k]) return o[k] as string; }
  for (const k in o) { if (o[k] && typeof o[k] === 'object') { const r = encontrarToken(o[k], depth + 1); if (r) return r; } }
  return null;
}

export interface AuthResultado {
  ok: boolean;
  token?: string;
  mensaje: string;
  crudo: string;
}

@Injectable({ providedIn: 'root' })
export class MedifoliosApiService {
  private readonly http = inject(HttpClient);
  private readonly appState = inject(AppStateService);

  async autenticar(usuario: string, password: string): Promise<AuthResultado> {
    const body = construirQuery({ usuario, password });
    try {
      const resp = await firstValueFrom(
        this.http.post(API_BASE + RUTA_AUTH, body, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          observe: 'response',
          responseType: 'text',
        }),
      );
      const raw = resp.body || '';
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* respuesta no-JSON, se maneja abajo */ }
      if (json?.authenticator) {
        return { ok: false, mensaje: 'Se requiere autenticación de dos factores (2FA): pide el código a tu administrador.', crudo: raw };
      }
      const token = json?.data?.token || (json ? encontrarToken(json) : null);
      if (token) {
        this.appState.token.set(token);
        return { ok: true, token, mensaje: 'Token obtenido ✔', crudo: raw };
      }
      return { ok: false, mensaje: 'No se detectó el token automáticamente. Revisa la respuesta cruda.', crudo: raw };
    } catch (err: any) {
      const status = err?.status;
      if (status === 404) return { ok: false, mensaje: 'No se encontró /api/auth. Revisa el proxy (proxy.conf.json / vercel.json).', crudo: '' };
      if (status === 502 || status === 504) return { ok: false, mensaje: `El proxy no pudo hablar con la plataforma (${status}).`, crudo: '' };
      if (status === 429) return { ok: false, mensaje: 'Demasiados intentos fallidos: espera unos minutos antes de reintentar.', crudo: '' };
      if (status) return { ok: false, mensaje: `Error ${status} al autenticar. Revisa usuario/contraseña.`, crudo: err?.error ?? '' };
      return { ok: false, mensaje: 'Error de red: ' + (err?.message || err), crudo: '' };
    }
  }

  private async llamarApi(ruta: string, paramsBase: Record<string, unknown>): Promise<{ json: any; raw: string }> {
    const token = this.appState.token();
    const qs = construirQuery({ ...paramsBase, token });
    const url = API_BASE + ruta + (qs ? '?' + qs : '');
    const raw = await firstValueFrom(this.http.get(url, { responseType: 'text' }));
    let json: any;
    try { json = JSON.parse(raw); } catch { throw new Error('La respuesta no es JSON válido: ' + raw.slice(0, 200)); }
    return { json, raw };
  }

  private async llamarApiPaginado(ruta: string, paramsBase: Record<string, unknown>): Promise<unknown[]> {
    let pagina = 1;
    const limite = 200;
    let acumulado: unknown[] = [];
    while (pagina <= 200) {
      try {
        const { json } = await this.llamarApi(ruta, { ...paramsBase, pagina, limite });
        const arr = encontrarArrayObjetos(json) || [];
        acumulado = acumulado.concat(arr);
        if (arr.length < limite) break;
        pagina++;
      } catch {
        break;
      }
    }
    return acumulado;
  }

  async consultarCitas(desde: string, hasta: string): Promise<unknown[]> {
    return this.llamarApiPaginado(RUTA_CITAS, { fechaInicial: desde, fechaFinal: hasta, incluirCanceladas: 0 });
  }
  async consultarConsumos(desde: string, hasta: string): Promise<unknown[]> {
    return this.llamarApiPaginado(RUTA_CONSUMOS, { fechaInicial: desde, fechaFinal: hasta });
  }
  async consultarFacturacion(desde: string, hasta: string): Promise<unknown[]> {
    return this.llamarApiPaginado(RUTA_FACTURACION, { fechaInicial: desde, fechaFinal: hasta, incluirFormasPago: 1 });
  }

  async cargarFormasPago(): Promise<void> {
    try {
      const { json } = await this.llamarApi('/catalogos/formas-pago', {});
      const lista = json?.data?.formasPago || [];
      const mapa: Record<string, string> = {};
      lista.forEach((fp: any) => { if (fp.codFormaPago != null && fp.nomFormaPago) mapa[String(fp.codFormaPago)] = String(fp.nomFormaPago).trim(); });
      this.appState.formasPago.set(mapa);
    } catch {
      this.appState.formasPago.set({});
    }
  }
}
