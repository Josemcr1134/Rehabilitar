import { Injectable } from '@angular/core';
import ExcelJS from 'exceljs';
import { RawRow, TipoFuente } from '../models/records.model';
import { SCHEMAS } from '../models/schemas.model';
import { scoreSchema, up } from '../utils/normalizacion.util';

/**
 * Lee un archivo .xlsx subido por el usuario, detectando sola la hoja y la fila
 * de encabezados (prueba cada hoja del libro y se queda con la que mejor encaje
 * con el esquema del tipo pedido), y descarta filas de TOTAL y pies de reporte.
 * Migrado 1:1 desde index.html (detectarEncabezado / hojaAObjetos / matrizDeHoja /
 * cargarExcel) — mismo criterio de detección que usaba el archivo original.
 */

const PIES_DE_REPORTE = /^(TOTAL|TOTALES|FECHA Y HORA|REPORTE GENERADO|DESGLOSE|TARIFA TOTAL|PAGA (PACIENTE|ENTIDAD)|SERVICIOS CON|SUBTOTAL)/;

export interface HojaDetectada {
  objetos: RawRow[];
  score: number;
  hoja: string;
  filaEncabezado: number;
  headers: string[];
}

export interface ArchivoCargado {
  nombre: string;
  hoja: string;
  matriz: unknown[][];
  filaEnc: number;
  headers: string[];
  objetos: RawRow[];
}

function cellVal(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('');
    if (o.text !== undefined) return o.text;
    if (o.result !== undefined) return o.result; // celda con fórmula: usamos el valor calculado
    if (o.formula !== undefined) return '';
    if (o.error !== undefined) return '';
    return String(v);
  }
  return v;
}

function filaValores(ws: ExcelJS.Worksheet, n: number): unknown[] {
  const row = ws.getRow(n);
  const out: unknown[] = [];
  for (let c = 1; c <= Math.max(ws.columnCount || 0, row.cellCount || 0); c++) out.push(cellVal(row.getCell(c).value));
  return out;
}

function detectarEncabezado(ws: ExcelJS.Worksheet, tipo: TipoFuente): { fila: number; score: number; headers?: string[] } {
  let mejor: { fila: number; score: number; headers?: string[] } = { fila: 1, score: -1 };
  const limite = Math.min(15, ws.rowCount || 1);
  for (let n = 1; n <= limite; n++) {
    const vals = filaValores(ws, n).map((v) => String(v || '').trim());
    const llenas = vals.filter(Boolean).length;
    if (llenas < 3) continue;
    const score = scoreSchema(vals, SCHEMAS[tipo]) + llenas * 0.01;
    if (score > mejor.score) mejor = { fila: n, score, headers: vals };
  }
  return mejor;
}

function hojaAObjetos(ws: ExcelJS.Worksheet, tipo: TipoFuente): HojaDetectada {
  const enc = detectarEncabezado(ws, tipo);
  if (!enc.headers) return { objetos: [], score: -1, hoja: ws.name, filaEncabezado: 0, headers: [] };
  // Nombres de columna únicos: un reporte con dos columnas vacías o repetidas rompería el mapeo.
  const seen: Record<string, number> = {};
  const headers = enc.headers.map((h, i) => {
    let name = String(h || '').trim() || `COL_${i + 1}`;
    if (seen[name]) name = `${name}_${++seen[name]}`;
    else seen[name] = 1;
    return name;
  });
  const objetos: RawRow[] = [];
  const ultima = ws.rowCount || 0;
  for (let n = enc.fila + 1; n <= ultima; n++) {
    const vals = filaValores(ws, n);
    if (!vals.some((v) => String(v || '').trim())) continue;
    const primera = up(vals.find((v) => String(v || '').trim()) || '');
    if (PIES_DE_REPORTE.test(primera)) continue;
    const obj: RawRow = {};
    headers.forEach((h, i) => { obj[h] = vals[i] === undefined ? '' : vals[i]; });
    objetos.push(obj);
  }
  return { objetos, score: enc.score, hoja: ws.name, filaEncabezado: enc.fila, headers };
}

/** Copia literal de la hoja tal como vino, para auditar el origen sin ninguna transformación. */
function matrizDeHoja(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  const ncols = ws.columnCount || 0;
  const nfilas = ws.rowCount || 0;
  for (let n = 1; n <= nfilas; n++) {
    const row = ws.getRow(n);
    const vals: unknown[] = [];
    for (let c = 1; c <= Math.max(ncols, row.cellCount || 0); c++) vals.push(cellVal(row.getCell(c).value));
    out.push(vals);
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class ExcelImportService {
  async cargar(tipo: TipoFuente, file: File): Promise<ArchivoCargado> {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    // Se prueba cada hoja y gana la que mejor encaje con el esquema del tipo.
    // (for...of en vez de wb.eachSheet(cb): evita el problema de narrowing de
    // TypeScript al reasignar variables externas dentro de un callback.)
    let mejor: HojaDetectada | null = null;
    let mejorWs: ExcelJS.Worksheet | null = null;
    for (const ws of wb.worksheets) {
      if (!ws.rowCount) continue;
      const r = hojaAObjetos(ws, tipo);
      if (!r.objetos.length) continue;
      if (!mejor || r.score > mejor.score) { mejor = r; mejorWs = ws; }
    }
    if (!mejor || !mejorWs) {
      throw new Error('No encontré filas de datos en el archivo.');
    }
    const mejorFinal: HojaDetectada = mejor;
    const mejorWsFinal: ExcelJS.Worksheet = mejorWs;
    return {
      nombre: file.name,
      hoja: mejorWsFinal.name,
      matriz: matrizDeHoja(mejorWsFinal),
      filaEnc: mejorFinal.filaEncabezado,
      headers: mejorFinal.headers,
      objetos: mejorFinal.objetos,
    };
  }
}
