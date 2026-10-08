/**
 * SCHEMAS: mapeo de campo lógico → sinónimos de encabezado, para detectar
 * columnas en cualquier variante del export de Medifolios. Migrado 1:1 desde
 * index.html — los sinónimos van en orden de preferencia y arrancan con el
 * nombre EXACTO que usa el export de Medifolios.
 *
 * Ojo con AGENDA: el reporte trae la columna 'EPS/ASEGURADORA' pero viene vacía
 * en todas las filas — la aseguradora real está en 'EMPRESA CLIENTE'. Por eso
 * buildRecordsFromJson() no se queda con la primera columna cuyo nombre encaje,
 * sino con la primera que además traiga datos (ver core/utils/build-records.util.ts).
 */
import { TipoFuente } from './records.model';

export interface SchemaDef {
  required: string[];
  map: Record<string, string[]>;
}

export const SCHEMAS: Record<TipoFuente, SchemaDef> = {
  AGENDA: {
    required: ['PACIENTE', 'FECHA ASIGNADA'],
    map: {
      nombre: ['PACIENTE', 'NOMBRE PACIENTE'],
      id: ['ID. PACIENTE', 'ID PACIENTE', 'COD PACIENTE'],
      fecha: ['FECHA ASIGNADA', 'FECHA CITA', 'FECHA'],
      eps: ['EMPRESA CLIENTE', 'EPS/ASEGURADORA', 'EPS', 'ASEGURADORA', 'CONVENIO', 'NOMBRE CONVENIO'],
      referencia: ['REFERENCIA', 'SERVICIO', 'PROCEDIMIENTO'],
      autorizacion: ['NUM. AUTORIZACION', 'AUTORIZACION'],
      profesional: ['PROFESIONAL', 'NOMBRE PROFESIONAL'],
      estado: ['ESTADO'],
      estado2: ['ESTADO2'],
      hora: ['HORA ASIGNADA'],
      sede: ['PUNTO ATENCION', 'SEDE'],
      tipoConsulta: ['TIPO CONSULTA'],
    },
  },
  CAJA: {
    required: ['NUM. DOCUMENTO', 'NOM TERCERO'],
    map: {
      nombre: ['NOM TERCERO', 'NOMBRE PACIENTE', 'NOMBRE CLIENTE'],
      id: ['ID. TERCERO', 'ID TERCERO', 'NUM ID PACIENTE', 'COD PACIENTE'],
      documento: ['NUM. DOCUMENTO', 'NUM FACTURA'],
      formaPago: ['FORMA PAGO', 'COD FORMA PAGO'],
      items: ['ITEMS'],
      entidad: ['ENTIDAD', 'CONVENIO'],
      autorizacion: ['AUTORIZACION'],
      profesional: ['PROFESIONAL/VENDEDOR', 'PROFESIONAL', 'VENDEDOR', 'NOMBRE PROFESIONAL'],
      fecha: ['FECHA', 'FECHA FACTURA'],
      estado: ['ESTADO'],
      valor: ['VALOR', 'TOTAL', 'VLR', 'VALOR PAGO', 'VALOR TOTAL', 'MONTO'],
      caja: ['CAJA', 'NOMBRE CAJA'],
      agendaTipo: ['AGENDA'],
      sede: ['SEDE'],
      cotizante: ['COTIZANTE/BENEFICIARIO', 'COTIZANTE'],
      regimen: ['REGIMEN'],
      detalleProf: ['PROFESIONAL/DETALLE'],
      noVerificacion: ['NO VERIFICACION', 'NUMERO VERIFICACION', 'NUMEROVERIFICACION'],
      tipoDocumento: ['TIPO DOCUMENTO'],
      fechaRegistro: ['FECHA REGISTRO'],
      quienRegistra: ['QUIEN REGISTRA', 'USUARIO'],
      servicioFecha: ['SERVICIO'],
    },
  },
  CONSUMO: {
    required: ['NOM PACIENTE', 'DESCRIPCION'],
    map: {
      nombre: ['NOM PACIENTE', 'NOMBRE PACIENTE', 'PACIENTE'],
      id: ['ID PACIENTE', 'ID. PACIENTE', 'NUM ID PACIENTE', 'COD PACIENTE'],
      descripcion: ['DESCRIPCION'],
      eps: ['EPS', 'CONVENIO', 'ASEGURADORA'],
      autorizacion: ['NUM. AUTORIZACION', 'AUTORIZACION'],
      profesional: ['MEDICO', 'PROFESIONAL', 'NOMBRE PROFESIONAL'],
      fecha: ['FECHA', 'FECHA CONSUMO'],
      // El reporte de consumos trae la tarifa ya desglosada en columnas numéricas.
      // Es una fuente mucho más confiable que leerla del texto de la descripción.
      valorBruto: ['VLR. BRUTO', 'VALOR BRUTO'],
      copago: ['CPG/CM/DSCTS', 'COPAGO', 'CUOTA MODERADORA'],
      valorNeto: ['VLR. NETO', 'VALOR NETO'],
      valorUnitario: ['VLR. UNITARIO', 'VALOR UNITARIO'],
      cantidad: ['CANTIDAD'],
      codServicio: ['COD. SERVICIO', 'CODIGO SERVICIO'],
      estatus: ['ESTATUS'],
      documento: ['DOCUMENTO'],
      serie: ['SERIE'],
    },
  },
};

export const TIPOS: TipoFuente[] = ['AGENDA', 'CAJA', 'CONSUMO'];

/** Movimientos de caja que NO representan un servicio prestado y por tanto no entran al cruce. */
export const EXCLUIR_CAJA_DE_CONCILIACION = ['ANTICIPO_EMPRESA', 'TRANSF_FACTURACION', 'AJUSTE', 'ANULADO'];

/** classifyCaja() devuelve una de estas — ver core/utils/clasificacion.util.ts. */
export const CATEGORIAS_ENTIDAD = ['ANTICIPO_EMPRESA', 'TRANSF_FACTURACION'];
