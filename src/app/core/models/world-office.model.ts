/**
 * Integración con World Office (facturas FV y recibos RC desde CAJA).
 * Migrada 1:1 desde el bloque <script> final de index.html (CLAUDE.md sección 15).
 *
 * Toda la configuración editable por contabilidad vive en WO_CONFIG.
 * `apiBase` es la única excepción: es la ruta del backend propio
 * (/api/worldoffice → api/worldoffice.js), que guarda el token de World Office
 * en una variable de entorno y hace las llamadas; sale de `environment`.
 */
import { environment } from '../../../environments/environment';

export interface WoConfig {
  /** Backend propio (api/worldoffice.js): es el único que conoce el token de World Office. */
  apiBase: string;
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
  /**
   * Los abonos a deuda (RCR-A / RCL-A) deben cruzarse con la factura que pagan
   * («Abona A» en la plantilla oficial de recibos). Por API eso son dos pasos
   * (crear RC + cruzarCuentas) que aún no se han probado con la cuenta real, así
   * que mientras esté en false esos recibos van SOLO en la plantilla Excel.
   */
  recibosDeudaPorAPI: boolean;
  /**
   * Valores fijos para crear pacientes nuevos con la plantilla oficial de terceros
   * (public/plantillas-wo/PlantillaTerceros.xlsx). Los textos deben ser EXACTAMENTE
   * los de la hoja oculta LISTAS de esa plantilla. `ciudadPorDefecto` vacío obliga
   * a escribir la ciudad en pantalla.
   */
  terceros: {
    tipoIdentificacionPersona: string;
    tipoTercero: string;
    tipoContribuyentePersona: string;
    tipoContribuyenteEmpresa: string;
    clasificacionImpuesto: string;
    tipoDireccion: string;
    nombreDireccion: string;
    ciudadPorDefecto: string;
  };
}

export const WO_CONFIG: WoConfig = {
  apiBase: environment.worldOfficeApiBase,
  vendedorIdentificacion: '32783738',
  empresas: {
    REHABILITAR: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S',
    LILIAN: 'LILIAN ROCIO ARRAZOLA BURBANO ',
  },
  prefijosLilian: ['COPL', 'ANTL', 'RCL-A', 'RCEL'],
  prefijosFactura: ['R', 'COPG', 'COPL'],
  prefijosReciboAnticipo: ['ANTR', 'ANTL'],
  prefijosReciboDeuda: ['RCR-A', 'RCL-A'],
  // En World Office los recibos de abono a deuda se llaman sin guion (confirmado por contabilidad, 2026-10-19).
  prefijoWO: { 'RCR-A': 'RCRA', 'RCL-A': 'RCLA' },
  monedaCodigo: 'COP',
  bodega: 'Principal',
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
  // «Forma de Pago» de la fila débito en la plantilla de recibos (lista oculta «Listas»:
  // Bono, Cheque, Efectivo, Letra de Cambio, Pagaré, Tarjeta Débito, Tarjeta de Crédito, Transferencia).
  // Transferencia: según la plantilla que contabilidad sí carga (2026-10-19). Tarjeta: en World Office la
  // forma de pago «Tarjeta» (usada en FV y RC) pertenece al grupo «Tarjeta Crédito» (2026-10-19).
  formaPagoContable: {
    EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta de Crédito', 'TRANSFERENCIA A DAVIVIENDA': 'Transferencia',
    TRANSFERENCIA_BANCOLOMBIA_REHABILITAR: 'Transferencia', TRANSFERENCIA_BANCOLOMBIA_LILIAN: 'Transferencia',
  },
  recibosDeudaPorAPI: false,
  terceros: {
    tipoIdentificacionPersona: 'Cédula de ciudadanía',
    tipoTercero: 'Cliente',
    tipoContribuyentePersona: 'Persona Natural No Responsable del IVA',
    tipoContribuyenteEmpresa: 'Persona Jurídica',
    clasificacionImpuesto: 'Normal',
    tipoDireccion: 'Casa',
    nombreDireccion: 'Principal',
    ciudadPorDefecto: '',
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
export interface Asiento {
  naturaleza: 'D' | 'C';
  cuenta: string;
  valor: number;
  forma?: string;
  /** Columna «Abona A» de la plantilla de recibos: «FV <prefijo> <número>» de la factura que se abona. */
  abonaA?: string;
}

interface DocumentoBase {
  /** Llave única para el control de duplicados e historial: «EMPRESA|DOCUMENTO» (ej. «REHABILITAR|R-15993»). */
  clave: string;
  documento: string;
  prefijo: string;
  /** Prefijo tal como existe en World Office (WO_CONFIG.prefijoWO o el mismo de Medifolios). */
  prefijoWO: string;
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
  /** false = no se envía por la API; solo va en la plantilla Excel (ej. abonos a deuda). */
  envioAPI: boolean;
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
  /** Solo abonos a deuda: factura que se abona («FV R 15832»). Vacío en anticipos. */
  abonaA: string;
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
  /** NC = notas de contabilidad (AP, APL, AE, AEL, APR, APLR…), usadas por la pestaña «Notas contables». */
  prefijos: { FV: Record<string, EntidadCatalogo>; RC: Record<string, EntidadCatalogo>; NC: Record<string, EntidadCatalogo> };
  formasVenta: Record<string, EntidadCatalogo>;
  formasContables: Record<string, EntidadCatalogo>;
  monedas: Record<string, EntidadCatalogo>;
  bodegas: Record<string, EntidadCatalogo>;
  centros: Record<string, EntidadCatalogo>;
  errores: string[];
}

export interface FilaBitacora {
  documento: string;
  tipo: 'FV' | 'RC' | 'NC';
  valor: number;
  estado: string;
  idWO: string | number;
  numeroWO: string | number;
  detalle: string;
  payload: unknown;
}

/** GET /api/worldoffice?accion=estado — qué está configurado en el servidor (nunca los valores). */
export interface EstadoServidorWO { tokenConfigurado: boolean; claveConfigurada: boolean; historialCompartido: boolean; base: string }

/** Un registro del historial de envíos (servidor o, de respaldo, este navegador). */
export interface RegistroHistorialWO {
  fecha: string;
  clave: string;
  ruta: string;
  ok: boolean;
  creado: boolean;
  idWO: string | number | null;
  numeroWO: string | number | null;
  mensaje: string;
  meta?: { documento?: string; valor?: number; [k: string]: unknown };
}

export interface OpcionesEnvio {
  conservarNumero: boolean;
  /**
   * Factura solo con los campos básicos del servicio crearDocumentoVenta (sin concepto de encabezado,
   * prefijo/número externo ni valorTotal del renglón). Sirve para aislar el «ERROR: 003 · Error inesperado».
   */
  basico?: boolean;
  contabilizar: boolean;
  verificarDuplicados: boolean;
}
