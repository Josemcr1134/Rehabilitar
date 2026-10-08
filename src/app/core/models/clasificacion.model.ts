/**
 * MATRIZ OPERATIVA REHABILITAR — clasificación de movimientos de CAJA por
 * código de documento. Migrada 1:1 desde index.html (sección "CLASIFICACIÓN
 * DE MOVIMIENTOS DE CAJA POR CÓDIGO DE DOCUMENTO").
 *
 * Cada prefijo del NUM. DOCUMENTO admite un conjunto cerrado de formas de pago
 * y define a qué GRUPO pertenece el movimiento y si debe cruzarse contra la
 * AGENDA DEL DÍA. La «L» de RCL-A / COPL / ANTL / RCEL corresponde a la razón
 * social de Lilian.
 *
 * ⚠️ El orden de los prefijos en PREFIJOS_CONOCIDOS (más largos primero) es
 * lógica de negocio: evita que "RCR-A-1234" se lea como "R" o "RCEL-9" como "RCE".
 * No reordenar por estética — ver CLAUDE.md sección 13.
 */

/** Formas de pago canónicas (nombres oficiales de la matriz). */
export const FP = {
  ANT_COPAGO: 'ANTICIPO COPAGO / CUOTA MODERADORA',
  ANT_DESC: 'ANTICIPO_DESCUENTO',
  CREDITO: 'CREDITO_DEUDA',
  AJUSTE: 'AJUSTE DE CARTERA',
  SIN_VALOR: 'SIN VALOR',
  EFECTIVO: 'EFECTIVO',
  TARJETA: 'TARJETA',
  BC_LILIAN: 'TRANSFERENCIA_BANCOLOMBIA_LILIAN',
  BC_REHAB: 'TRANSFERENCIA_BANCOLOMBIA_REHABILITAR',
  DAV: 'TRANSFERENCIA A DAVIVIENDA',
  DAV_LILIAN: 'TRANSFERENCIA A DAVIVIENDA LILIAN',
  PREPAGADA: 'PREPAGADA',
  TR_FACT: 'TRANSFERENCIAS FACTURACION',
} as const;

export type FormaPagoCanonica = (typeof FP)[keyof typeof FP];

/** Formas que representan plata que efectivamente entró a la caja del día. */
export const FORMAS_CON_RECAUDO: FormaPagoCanonica[] = [
  FP.EFECTIVO, FP.TARJETA, FP.BC_LILIAN, FP.BC_REHAB, FP.DAV, FP.DAV_LILIAN, FP.PREPAGADA, FP.TR_FACT,
];

const F7_COPAGO: FormaPagoCanonica[] = [FP.ANT_DESC, FP.CREDITO, FP.EFECTIVO, FP.TARJETA, FP.BC_LILIAN, FP.BC_REHAB, FP.DAV];
const F7_AJUSTE: FormaPagoCanonica[] = [FP.AJUSTE, FP.SIN_VALOR, FP.EFECTIVO, FP.TARJETA, FP.BC_LILIAN, FP.BC_REHAB, FP.DAV];
const F5_ANTIC: FormaPagoCanonica[] = [FP.EFECTIVO, FP.SIN_VALOR, FP.TARJETA, FP.BC_LILIAN, FP.BC_REHAB, FP.DAV];

export type GrupoBase =
  | 'ASUME PACIENTE'
  | 'MIXTO_TERCERO'
  | 'MIXTO_VALOR'
  | 'ANTICIPO RECIBIDO'
  | 'PAGO DE DEUDA'
  | 'RADICADO A ENTIDAD';

export interface ReglaDocumento {
  desc: string;
  grupoBase: GrupoBase;
  entraAgenda: boolean | 'SOLO_SI_CERO';
  formas: FormaPagoCanonica[];
  nota: string;
}

export const REGLAS_DOC: Record<string, ReglaDocumento> = {
  COPG: { desc: 'Copago general', grupoBase: 'ASUME PACIENTE', entraAgenda: true, formas: F7_COPAGO, nota: '' },
  COPL: { desc: 'Copago Lilian', grupoBase: 'ASUME PACIENTE', entraAgenda: true, formas: F7_COPAGO, nota: '' },
  R: {
    desc: 'Recibo / factura de servicio', grupoBase: 'MIXTO_TERCERO', entraAgenda: true,
    formas: [FP.ANT_COPAGO, FP.ANT_DESC, FP.CREDITO, FP.EFECTIVO, FP.TARJETA, FP.BC_LILIAN, FP.BC_REHAB, FP.DAV, FP.TR_FACT],
    nota: 'ASUME PACIENTE si el tercero tiene documento de identidad; RADICADO A ENTIDAD si es NIT o nombre de empresa.',
  },
  'RCR-A': {
    desc: 'Recibo de caja Rehabilitar', grupoBase: 'MIXTO_VALOR', entraAgenda: true, formas: F7_AJUSTE,
    nota: 'Solo entra en ASUME PACIENTE si el valor es 0; con valor distinto de 0 es PAGO DE DEUDA.',
  },
  'RCL-A': {
    desc: 'Recibo de caja Lilian', grupoBase: 'MIXTO_VALOR', entraAgenda: 'SOLO_SI_CERO', formas: F7_AJUSTE,
    nota: 'Solo entra en ASUME PACIENTE si el valor es 0; con valor distinto de 0 es PAGO DE DEUDA y NO entra en la agenda del día.',
  },
  ANTL: { desc: 'Anticipo Lilian', grupoBase: 'ANTICIPO RECIBIDO', entraAgenda: false, formas: F5_ANTIC, nota: 'No entra en la agenda del día.' },
  ANTR: { desc: 'Anticipo Rehabilitar', grupoBase: 'ANTICIPO RECIBIDO', entraAgenda: false, formas: F5_ANTIC, nota: 'No entra en la agenda del día.' },
  RCE: { desc: 'Recaudo de cartera de entidad', grupoBase: 'PAGO DE DEUDA', entraAgenda: false, formas: [FP.PREPAGADA, FP.DAV_LILIAN, FP.DAV], nota: 'No entra en la agenda del día.' },
  RCEL: { desc: 'Recaudo de cartera (Lilian)', grupoBase: 'PAGO DE DEUDA', entraAgenda: false, formas: [FP.PREPAGADA, FP.DAV_LILIAN, FP.DAV], nota: 'No entra en la agenda del día.' },
  LA: { desc: 'Legalización / radicado', grupoBase: 'RADICADO A ENTIDAD', entraAgenda: false, formas: [FP.ANT_COPAGO, FP.TR_FACT], nota: 'Corresponde a radicado a entidades.' },
};

export type GrupoMatriz = 'ASUME PACIENTE' | 'RADICADO A ENTIDAD' | 'PAGO DE DEUDA' | 'ANTICIPO RECIBIDO' | 'ANULADO' | 'SIN CLASIFICAR';

export const ORDEN_GRUPOS: GrupoMatriz[] = ['ASUME PACIENTE', 'RADICADO A ENTIDAD', 'PAGO DE DEUDA', 'ANTICIPO RECIBIDO', 'ANULADO', 'SIN CLASIFICAR'];

/** Más largos primero — ver nota de orden arriba. */
export const PREFIJOS_CONOCIDOS = Object.keys(REGLAS_DOC).sort((a, b) => b.length - a.length);

export const PREFIJOS_PACIENTE = ['RCR-A', 'RCL-A', 'COPG', 'COPL', 'R'];
export const PREFIJOS_ENTIDAD = ['RCE', 'RCEL', 'LA'];

/** Nombres de tercero que delatan una empresa aunque el ID no sea un NIT. */
export const RE_EMPRESA =
  /\b(S\.?A\.?S|LTDA|E\.?S\.?E|I\.?P\.?S|E\.?P\.?S|ARL|SEGUROS|SALUD|MEDICINA|COOMEVA|SURA|NUEVA EPS|SANITAS|COMPENSAR|MUTUAL|FUNDACION|FUNDACIÓN|ASOCIACION|ASOCIACIÓN|COMPANIA|COMPAÑIA|COMPAÑÍA|EMPRESA|ENTIDAD|COLSANITAS|MEDIMAS|CAJACOPI|MUTUALSER|SALUDTOTAL|SALUD TOTAL|FAMISANAR|ALIANSALUD|COOSALUD|POSITIVA|AXA|MAPFRE)\b/;

/** Resultado de clasificarMovimiento(): a quién le corresponde el movimiento y cómo tratarlo. */
export interface ClasificacionMovimiento {
  pre: string;
  regla: ReglaDocumento | null;
  forma: string;
  tipoDoc: string;
  formasPermitidas: FormaPagoCanonica[];
  formaValida: 'SI' | 'NO' | 'N/D';
  grupo: GrupoMatriz;
  status: string;
  hayRecaudo: boolean;
  entraAgenda: boolean;
  clausula: string;
  destino: string;
  bloque: 'PAGO_PACIENTE' | 'PAGO_ENTIDADES';
}
