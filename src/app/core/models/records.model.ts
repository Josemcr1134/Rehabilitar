/**
 * Tipados de los tres reportes fuente (AGENDA, CAJA, CONSUMO) y del resultado
 * de extraer tarifa (TAR/PAC/ENT) del texto del servicio.
 *
 * Migrado 1:1 desde la lógica de index.html (LILIAN), sin cambiar ninguna regla
 * de negocio. Ver core/utils para las funciones que producen/consumen estos tipos.
 */

export type TipoFuente = 'AGENDA' | 'CAJA' | 'CONSUMO';

/** Resultado de extraerTarifa()/tarifaDeCampo() sobre el texto de un servicio. */
export interface Tarifa {
  tar: number | null;
  pac: number | null;
  ent: number | null;
  copagoExplicito: boolean;
  detectado: boolean;
  tipo: string;
  regla: string;
  /** Solo en tarifaDeCampo(): cuántos ítems traía el renglón (separados por " | "). */
  n?: number;
  /** Solo en tarifaDeCampo(): totales sumados cuando el renglón trae varios ítems. */
  total?: { tar: number | null; pac: number | null; ent: number | null };
  /** Solo en registros de CONSUMO: de dónde salió la tarifa ('texto' | 'columnas' | ''). */
  fuente?: string;
  /** Solo en registros de CONSUMO: si VLR. BRUTO del archivo difiere de lo leído en el texto. */
  brutoDifiere?: boolean;
  brutoLiquidado?: number;
  /** Solo en tarifaDeFuente(): si dentro de una misma fuente convivían tarifas distintas. */
  variasTarifas?: boolean;
  presente?: boolean;
}

export interface AgendaRecord {
  nombre: string;
  id: string;
  fecha: string;
  eps: string;
  referencia: string;
  autorizacion: string;
  profesional: string;
  estado: string;
  estado2: string;
  hora: string;
  sede: string;
  tipoConsulta: string;
}

/** Categorías de classifyCaja() — la clasificación "gruesa" por FORMA PAGO + ESTADO + tipo de tercero. */
export type CategoriaCaja =
  | 'ANULADO'
  | 'ANTICIPO_EMPRESA'
  | 'TRANSF_FACTURACION'
  | 'ANTICIPO'
  | 'AJUSTE'
  | 'CREDITO'
  | 'SIN_VALOR'
  | 'PAGO_NORMAL';

export interface CajaRecord {
  nombre: string;
  id: string;
  documento: string;
  formaPago: string;
  items: string;
  /** ITEMS sin normalizar (antes de normServicio): World Office lo necesita para
   *  detectar varios servicios separados por " | " o salto de línea, algo que
   *  `items` ya no tiene porque normServicio() lo recorta a la primera línea. */
  itemsRaw: string;
  entidad: string;
  autorizacion: string;
  profesional: string;
  fecha: string;
  estado: string;
  valor: number;
  caja: string;
  agendaTipo: string;
  sede: string;
  cotizante: string;
  regimen: string;
  detalleProf: string;
  noVerificacion: string;
  tipoDocumento: string;
  fechaRegistro: string;
  quienRegistra: string;
  servicioFecha: string;
  /** Derivados al normalizar (ver normalizeRecords): */
  categoria: CategoriaCaja;
  esEntidad: boolean;
  tarifa: Tarifa;
}

export interface ConsumoRecord {
  nombre: string;
  id: string;
  descripcion: string;
  eps: string;
  autorizacion: string;
  profesional: string;
  fecha: string;
  cantidad: number;
  codServicio: string;
  estatus: string;
  documento: string;
  tarifa: Tarifa;
}

/** Fila cruda, tal como vino de la hoja/API, antes de normalizeRecords(). */
export type RawRow = Record<string, unknown>;
