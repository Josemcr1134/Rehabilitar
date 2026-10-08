import { Injectable, inject } from '@angular/core';
import { RawRow, TipoFuente } from '../models/records.model';
import { SCHEMAS } from '../models/schemas.model';
import { scoreSchema } from '../utils/normalizacion.util';
import { buildRecordsFromJson, normalizeAgenda, normalizeCaja, normalizeConsumo } from '../utils/build-records.util';
import { AppStateService } from './app-state.service';
import { ArchivoCargado, ExcelImportService } from './excel-import.service';

export interface ResultadoCarga {
  ok: boolean;
  mensaje: string;
  registros: number;
}

/**
 * Orquesta "subir un .xlsx" → detectar hoja/encabezado → normalizar → guardar
 * en AppStateService. Migrado desde cargarExcel() + procesarArrayComoTipo()
 * (rama 'Excel') de index.html. La rama 'API' (aplanar JSON de Medifolios) vive
 * en MedifoliosApiService, que reutiliza normalizarYGuardar() de aquí.
 */
@Injectable({ providedIn: 'root' })
export class FileLoaderService {
  private readonly excelImport = inject(ExcelImportService);
  private readonly appState = inject(AppStateService);

  async cargarArchivo(tipo: TipoFuente, file: File): Promise<ResultadoCarga> {
    let archivo: ArchivoCargado;
    try {
      archivo = await this.excelImport.cargar(tipo, file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, registros: 0, mensaje: `No pude leer el archivo: ${msg}. Si es un .xls antiguo, guárdalo como .xlsx desde Excel.` };
    }
    const resultado = this.normalizarYGuardar(tipo, archivo.headers, archivo.objetos, 'Excel', archivo);
    return { ...resultado, mensaje: `Hoja «${archivo.hoja}», encabezados en la fila ${archivo.filaEnc}. ${resultado.mensaje}` };
  }

  /**
   * Guarda filas ya aplanadas desde el JSON de la API (ver apiJsonAplano()).
   * Arma también una matriz sintética (headers + filas) y la guarda como "raw",
   * igual que hacía procesarArrayComoTipo() en origen==='API' — así
   * analizarOrigenTarifas() puede leer esta fuente igual que si viniera de Excel.
   */
  guardarDesdeApi(tipo: TipoFuente, arrPlano: RawRow[]): ResultadoCarga {
    const headers = [...new Set(arrPlano.flatMap((o) => Object.keys(o)))];
    const matriz: unknown[][] = [headers, ...arrPlano.map((o) => headers.map((h) => (o[h] === undefined || o[h] === null ? '' : o[h])))];
    const raw: ArchivoCargado = { nombre: `${tipo} (API)`, hoja: tipo, filaEnc: 1, headers, matriz, objetos: arrPlano };
    return this.normalizarYGuardar(tipo, headers, arrPlano, 'API', raw);
  }

  /**
   * Punto común para Excel y API: dado un arreglo de filas crudas (ya con sus
   * encabezados reales, sea de la hoja o aplanadas desde el JSON de la API),
   * detecta columnas, normaliza y guarda en el estado global.
   */
  normalizarYGuardar(tipo: TipoFuente, headers: string[], arr: RawRow[], origen: 'API' | 'Excel', raw?: ArchivoCargado): ResultadoCarga {
    if (!arr.length) {
      this.appState.setFuente(tipo, [], origen, raw);
      return { ok: true, registros: 0, mensaje: 'Sin registros en el rango consultado.' };
    }
    const score = scoreSchema(headers, SCHEMAS[tipo]);
    const mapeadas = buildRecordsFromJson(tipo, headers, arr);
    const records = tipo === 'AGENDA' ? normalizeAgenda(mapeadas) : tipo === 'CAJA' ? normalizeCaja(mapeadas) : normalizeConsumo(mapeadas);
    const descartadas = arr.length - records.length;
    this.appState.setFuente(tipo, records, origen, raw);
    const nota = descartadas > 0 ? ` (${descartadas} fila(s) sin documento de identidad descartadas).` : '';
    const mensaje = score >= 2
      ? `${records.length} registros cargados y columnas identificadas correctamente${nota}`
      : `${records.length} registros cargados, pero no reconocí bien algunas columnas — verifica los nombres de las columnas del archivo${nota}`;
    return { ok: true, registros: records.length, mensaje };
  }
}
