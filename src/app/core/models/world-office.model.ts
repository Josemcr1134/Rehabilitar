/**
 * Integración con World Office (facturas FV y recibos RC desde CAJA).
 * Migrada 1:1 desde el bloque <script> final de index.html (CLAUDE.md sección 15).
 *
 * Toda la configuración editable por contabilidad vive en WO_CONFIG, igual que
 * en el original — se muta en caliente desde la página (authPrefix) en vez de
 * vivir en un signal, porque así se comportaba el objeto global original.
 * `apiBase` es la única excepción: es un prefijo de infraestructura (lo
 * reescribe proxy.conf.json/vercel.json hacia el host real de World Office),
 * no una regla de negocio, así que sale de `environment` y no de un literal
 * fijo aquí.
 */
import { environment } from '../../../environments/environment';

export interface WoConfig {
  apiBase: string;
  authPrefix: string;
  vendedorIdentificacion: string;
  empresas: { REHABILITAR: string; LILIAN: string };
  prefijosLilian: string[];
  prefijosFactura: string[];
  prefijosReciboAnticipo: string[];
  prefijosReciboDeuda: string[];
  /** Prefijo de World Office que corresponde a cada prefijo de Medifolios, si no se llaman igual. */
  prefijoWO: Record<string, string>;
  monedaCodigo: string;
  bodega: string;
  unidadMedida: string;
  formaPagoDetalle: string;
  conceptoReciboAnticipo: string;
  conceptoReciboDeuda: string;
  cuentaDebitoPorForma: Record<string, string>;
  cuentaCreditoAnticipo: string;
  cuentaCreditoDeuda: string;
  formaPagoContable: Record<string, string | null>;
}

export const WO_CONFIG: WoConfig = {
  apiBase: environment.worldOfficeApiBase,
  authPrefix: 'WO ',
  vendedorIdentificacion: '32783738',
  empresas: {
    REHABILITAR: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S',
    LILIAN: 'LILIAN ROCIO ARRAZOLA BURBANO ',
  },
  prefijosLilian: ['COPL', 'ANTL', 'RCL-A', 'RCEL'],
  prefijosFactura: ['R', 'COPG', 'COPL'],
  prefijosReciboAnticipo: ['ANTR', 'ANTL'],
  prefijosReciboDeuda: ['RCR-A', 'RCL-A'],
  prefijoWO: {},
  monedaCodigo: 'COP',
  bodega: 'principal',
  unidadMedida: 'und',
  formaPagoDetalle: 'XEfectivo ',
  conceptoReciboAnticipo: 'ANTICIPO',
  conceptoReciboDeuda: 'PAGO DEUDA',
  cuentaDebitoPorForma: {
    EFECTIVO: '11050503',
    TARJETA: '11200505',
    'TRANSFERENCIA A DAVIVIENDA': '11100501',
    TRANSFERENCIA_BANCOLOMBIA_REHABILITAR: '11200506',
    TRANSFERENCIA_BANCOLOMBIA_LILIAN: '13250502',
  },
  cuentaCreditoAnticipo: '28051501',
  cuentaCreditoDeuda: '13050501',
  formaPagoContable: {
    EFECTIVO: 'Efectivo', TARJETA: null, 'TRANSFERENCIA A DAVIVIENDA': null,
    TRANSFERENCIA_BANCOLOMBIA_REHABILITAR: null, TRANSFERENCIA_BANCOLOMBIA_LILIAN: null,
  },
};

export interface ReglaTablaA { grupo: 'PAGO' | 'CREDITO' | 'ANTICIPO'; concepto: string; forma: string }

/** Tabla A — forma de pago Medifolios (normalizada) → concepto / forma de pago WO. */
export const TABLA_A: Record<string, ReglaTablaA> = {
  EFECTIVO: { grupo: 'PAGO', concepto: 'PAGO DEL DÍA', forma: 'Efectivo' },
  TARJETA: { grupo: 'PAGO', concepto: 'PAGO DEL DÍA', forma: 'Tarjeta' },
  'TRANSFERENCIA A DAVIVIENDA': { grupo: 'PAGO', concepto: 'PAGO DEL DÍA', forma: 'TRANSFERENCIA A DAVIVIENDA' },
  TRANSFERENCIA_BANCOLOMBIA_REHABILITAR: { grupo: 'PAGO', concepto: 'PAGO DEL DÍA', forma: 'TRANSFERENCIA A BANCOLOMBIA' },
  TRANSFERENCIA_BANCOLOMBIA_LILIAN: { grupo: 'PAGO', concepto: 'PAGO DEL DÍA', forma: 'TRANSFERENCIA A BANCOLOMBIA' },
  CREDITO_DEUDA: { grupo: 'CREDITO', concepto: 'CREDITO-DEUDA', forma: 'Crédito' },
  ANTICIPO_DESCUENTO: { grupo: 'ANTICIPO', concepto: 'ANTICIPO DESCUENTO', forma: 'ANTICIPO DESCUENTO' },
};

/** Tabla B — producto según servicio y prefijo (texto con cero adelante). */
export const PRODUCTO: Record<'R' | 'COP', Record<string, string>> = {
  R: { FISIOTERAPIA: '01', 'TERAPIA OCUPACIONAL': '02', FONOAUDIOLOGIA: '03', PSICOLOGIA: '04' },
  COP: { FISIOTERAPIA: '05', 'TERAPIA OCUPACIONAL': '07', FONOAUDIOLOGIA: '06', PSICOLOGIA: '08' },
};

/** Tabla C — ENTIDAD → centro de costos. El orden importa: "SURAMERICANA … POLIZA" antes que "SURAMERICANA". */
export const CENTROS: Array<[RegExp, string]> = [
  [/SURAMERICANA.*POLIZA|SURA\s*POLIZA/, 'Sura Póliza'],
  [/SURAMERICANA|ARL\s*SURA/, 'Sura ARL'],
  [/PARTICULAR/, 'Particulares'],
  [/PROBIENESTAR/, 'Probienestar'],
  [/COOMEVA/, 'Coomeva'],
  [/ALLIANZ/, 'Allianz'],
  [/COLSANITAS/, 'Colsanitas'],
  [/COLMEDICA/, 'Colmedica'],
  [/BOLIVAR|BOLÍVAR/, 'Bolívar'],
  [/PAN\s*AMERICAN/, 'Pan American'],
  [/MED\s*PLUS/, 'Med plus'],
  [/LIBERTY/, 'Liberty'],
];

export interface Pago { forma: string; valor: number; origen: string }
export interface Asiento { naturaleza: 'D' | 'C'; cuenta: string; valor: number; forma?: string }

interface DocumentoBase {
  documento: string;
  prefijo: string;
  numero: number | null;
  fecha: string;
  fechaRegistro: string;
  orden: number;
  cliente: string;
  nombre: string;
  entidad: string;
  valor: number;
  anulado: boolean;
  empresaKey: 'LILIAN' | 'REHABILITAR';
  empresa: string;
  movimientos: number;
  formasOrigen: string;
  avisos: string[];
}

export interface FacturaWO extends DocumentoBase {
  tipo: 'FV';
  concepto: string;
  formaPagoWO: string;
  servicio: string;
  producto: string;
  centroCosto: string;
  cantidad: number;
  valorUnitario: number;
  pagos: Pago[];
}

export interface ReciboWO extends DocumentoBase {
  tipo: 'RC';
  clase: 'ANTICIPO' | 'PAGO DE DEUDA';
  concepto: string;
  centroCosto: string;
  asientos: Asiento[];
}

export interface ExcluidoWO extends DocumentoBase { motivo: string }
export interface ExcepcionWO extends DocumentoBase { motivo: string }

export interface ControlRevisoria { control: string; ok: boolean; detalle: string }

export interface PreparacionWO {
  facturas: FacturaWO[];
  recibos: ReciboWO[];
  excluidos: ExcluidoWO[];
  excepciones: ExcepcionWO[];
  totalCaja: number;
  movimientos: number;
  controles: ControlRevisoria[];
  porEmpresaForma: Record<string, number>;
}

export interface EntidadCatalogo { id: number | string; [k: string]: unknown }

export interface CatalogosWO {
  empresas: Record<string, EntidadCatalogo>;
  prefijos: { FV: Record<string, EntidadCatalogo>; RC: Record<string, EntidadCatalogo> };
  formasVenta: Record<string, EntidadCatalogo>;
  formasContables: Record<string, EntidadCatalogo>;
  monedas: Record<string, EntidadCatalogo>;
  bodegas: Record<string, EntidadCatalogo>;
  centros: Record<string, EntidadCatalogo>;
  errores: string[];
}

export interface FilaBitacora {
  documento: string;
  tipo: 'FV' | 'RC';
  valor: number;
  estado: string;
  idWO: string | number;
  numeroWO: string | number;
  detalle: string;
  payload: unknown;
}

export interface OpcionesEnvio {
  conservarNumero: boolean;
  contabilizar: boolean;
  verificarDuplicados: boolean;
}
