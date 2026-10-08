/**
 * Convierte filas crudas (de Excel o de la API ya aplanada) en los registros
 * tipados AgendaRecord / CajaRecord / ConsumoRecord. Migrado 1:1 desde
 * index.html — buildRecordsFromJson() detecta la columna real de cada campo
 * lógico, normalizeRecords() aplica las funciones de normalización y deriva
 * los campos calculados (categoria, tarifa, etc.).
 */
import { AgendaRecord, CajaRecord, ConsumoRecord, RawRow, Tarifa, TipoFuente } from '../models/records.model';
import { CATEGORIAS_ENTIDAD, SCHEMAS } from '../models/schemas.model';
import { findCol, normFecha, normId, normNombre, normServicio, toNumber, up } from './normalizacion.util';
import { classifyCaja, esNit } from './clasificacion.util';
import { extraerTarifa } from './tarifa.util';

/**
 * Para cada campo se recorren los sinónimos en orden y gana el primero cuya
 * columna traiga datos en alguna fila. Un nombre de columna correcto pero con
 * la columna vacía —como 'EPS/ASEGURADORA' en el reporte de agenda— haría que
 * todas las comparaciones de EPS salieran como "dato ausente".
 */
export function buildRecordsFromJson(tipo: TipoFuente, headers: string[], arr: RawRow[]): RawRow[] {
  const schema = SCHEMAS[tipo];
  const colKey: Record<string, string | null> = {};
  const muestra = arr.slice(0, 200);
  for (const key in schema.map) {
    let elegida: string | null = null;
    let primeraQueEncaja: string | null = null;
    for (const syn of schema.map[key]) {
      const idx = findCol(headers, [syn]);
      if (idx < 0) continue;
      const col = headers[idx];
      if (primeraQueEncaja === null) primeraQueEncaja = col;
      const tieneDatos = muestra.some((o) => String(o[col] === undefined || o[col] === null ? '' : o[col]).trim() !== '');
      if (tieneDatos) { elegida = col; break; }
    }
    colKey[key] = elegida || primeraQueEncaja;
  }
  return arr.map((obj) => {
    const rec: RawRow = {};
    for (const key in colKey) rec[key] = colKey[key] ? obj[colKey[key] as string] : '';
    return rec;
  });
}

export function normalizeAgenda(raw: RawRow[]): AgendaRecord[] {
  return raw
    .map((r) => ({
      nombre: normNombre(r['nombre']), id: normId(r['id']), fecha: normFecha(r['fecha']),
      eps: up(r['eps']), referencia: (r['referencia'] as string) || '', autorizacion: up(r['autorizacion']),
      profesional: up(r['profesional']), estado: up(r['estado']), estado2: up(r['estado2']),
      hora: (r['hora'] as string) || '', sede: (r['sede'] as string) || '', tipoConsulta: (r['tipoConsulta'] as string) || '',
    }))
    // Una cita cancelada no debe contar como servicio pendiente de facturar.
    // Las NO CUMPLIDAS sí se conservan: son justamente lo que hay que detectar.
    .filter((r) => r.id && !/CANCELAD|ANULAD/.test(r.estado));
}

export function normalizeCaja(raw: RawRow[]): CajaRecord[] {
  return raw
    .map((r) => {
      const rec: Omit<CajaRecord, 'categoria' | 'esEntidad' | 'tarifa'> = {
        nombre: normNombre(r['nombre']), id: normId(r['id']), documento: String(r['documento'] || '').trim(),
        formaPago: (r['formaPago'] as string) || '', items: normServicio(r['items']), itemsRaw: String(r['items'] ?? ''), entidad: up(r['entidad']),
        autorizacion: up(r['autorizacion']), profesional: up(r['profesional']), fecha: normFecha(r['fecha']),
        estado: (r['estado'] as string) || '', valor: toNumber(r['valor']),
        caja: (r['caja'] as string) || 'CAJA GENERAL', agendaTipo: (r['agendaTipo'] as string) || '', sede: (r['sede'] as string) || '',
        cotizante: (r['cotizante'] as string) || '', regimen: (r['regimen'] as string) || '',
        detalleProf: (r['detalleProf'] as string) || (r['profesional'] as string) || '', noVerificacion: (r['noVerificacion'] as string) || '',
        tipoDocumento: (r['tipoDocumento'] as string) || '', fechaRegistro: (r['fechaRegistro'] as string) || '',
        quienRegistra: (r['quienRegistra'] as string) || '', servicioFecha: (r['servicioFecha'] as string) || '',
      };
      const categoria = classifyCaja(rec);
      const full: CajaRecord = {
        ...rec, categoria,
        esEntidad: (CATEGORIAS_ENTIDAD as string[]).includes(categoria),
        tarifa: extraerTarifa(rec.items),
      };
      return full;
    })
    .filter((r) => r.id);
}

export function normalizeConsumo(raw: RawRow[]): ConsumoRecord[] {
  return raw
    .map((r) => {
      const rec: Omit<ConsumoRecord, 'tarifa'> = {
        nombre: normNombre(r['nombre']), id: normId(r['id']), descripcion: normServicio(r['descripcion']),
        eps: up(r['eps']), autorizacion: up(r['autorizacion']), profesional: up(r['profesional']), fecha: normFecha(r['fecha']),
        cantidad: toNumber(r['cantidad']), codServicio: (r['codServicio'] as string) || '', estatus: up(r['estatus']),
        documento: String(r['documento'] || '').trim(),
      };
      // Las columnas numéricas del reporte y el texto de la descripción NO usan la misma
      // semántica. VLR. NETO = BRUTO − descuentos ("lo que queda por cobrar"), no "lo que
      // paga la entidad" — por eso manda el texto, y las columnas numéricas solo VALIDAN.
      const t = extraerTarifa(rec.descripcion);
      const bruto = r['valorBruto'];
      const hayBruto = bruto !== null && bruto !== undefined && String(bruto).trim() !== '';
      let tarifa: Tarifa;
      if (t.detectado) {
        tarifa = { ...t, fuente: 'texto' };
        if (hayBruto && Math.abs(toNumber(bruto) - (t.tar || 0)) >= 1) {
          tarifa.brutoDifiere = true;
          tarifa.brutoLiquidado = toNumber(bruto);
        }
      } else if (hayBruto) {
        tarifa = { tar: toNumber(bruto), pac: toNumber(r['copago']), ent: toNumber(r['valorNeto']), copagoExplicito: true, detectado: true, tipo: '', regla: '', fuente: 'columnas' };
      } else {
        tarifa = { ...t, fuente: '' };
      }
      return { ...rec, tarifa };
    })
    .filter((r) => r.id);
}

export { esNit };
