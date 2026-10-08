/**
 * La API de Medifolios devuelve objetos anidados (paciente.nombres,
 * convenio.nomConvenio, estadoCita.codEstado...) y no columnas planas. Aquí se
 * aplanan a los MISMOS nombres de columna que usa el export de Medifolios (los
 * primeros sinónimos de SCHEMAS), para que el resto del pipeline
 * (buildRecordsFromJson + normalizeRecords) funcione igual para API y Excel.
 * Migrado 1:1 desde index.html (apiJsonAplano).
 */
import { RawRow, TipoFuente } from '../models/records.model';

function g(o: any, p: string, d: unknown = ''): any {
  const v = o ? o[p] : null;
  return v === null || v === undefined ? d : v;
}

export function apiJsonAplano(tipo: TipoFuente, arr: any[], formasPago: Record<string, string>): RawRow[] {
  if (tipo === 'AGENDA') {
    return arr.map((o) => {
      const pac = o.paciente || {};
      const fecha = g(o, 'fechaInicioCita', '');
      const hm = String(fecha).match(/^\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2})/);
      return {
        PACIENTE: g(pac, 'nomPacienteTexto', '') || [g(pac, 'nombres'), g(pac, 'apellidos')].filter(Boolean).join(' '),
        'ID. PACIENTE': g(pac, 'numDocumentoIdentidad', ''),
        'FECHA ASIGNADA': fecha,
        'EMPRESA CLIENTE': g(o.convenio, 'nomConvenio', ''),
        REFERENCIA: g(o.referencia, 'nomReferencia', ''),
        'NUM. AUTORIZACION': g(o, 'numAutorizacion', ''),
        PROFESIONAL: g(o.profesional, 'nomProfesional', ''),
        ESTADO: g(o.estadoCita, 'codEstado', ''),
        ESTADO2: g(o.estadoCita, 'nomEstado', ''),
        'HORA ASIGNADA': hm ? hm[1] : '',
        'PUNTO ATENCION': g(o.puntoAtencion, 'nomPuntoAtencion', ''),
        SEDE: g(o.sede, 'nomSede', ''),
        'TIPO CONSULTA': g(o, 'tipoConsulta', ''),
      };
    });
  }
  if (tipo === 'CAJA') {
    return arr.map((o) => {
      const tercero = o.tercero || {};
      const pre = g(o.prefijo, 'prefijo', '');
      const documento = pre ? pre + '-' + String(g(o, 'numDocumento', '')) : String(g(o, 'numDocumento', ''));
      const forma = g(o, 'formaPago', '');
      const items = Array.isArray(o.items) ? o.items.map((it: any) => g(it, 'descripcion', '')).filter(Boolean).join(' | ') : '';
      return {
        'NOM TERCERO': g(tercero, 'nomTercero', ''),
        'ID. TERCERO': g(tercero, 'numDocumentoIdentidad', ''),
        'NUM. DOCUMENTO': documento,
        'FORMA PAGO': formasPago[String(forma)] || forma,
        ITEMS: items || g(o.referencia, 'nomReferencia', '') || '',
        ENTIDAD: g(o.listaPrecios, 'nomListaPrecios', ''),
        AUTORIZACION: g(o, 'numAutorizacion', ''),
        FECHA: g(o, 'fecha', ''),
        ESTADO: g(o, 'estado', ''),
        VALOR: o.valor !== null && o.valor !== undefined ? o.valor : g(o, 'vlrTotal', 0),
        CAJA: 'CAJA GENERAL',
        'TIPO DOCUMENTO': g(o, 'tipoDocumento', ''),
        'NO VERIFICACION': g(o, 'numeroVerificacion', ''),
      };
    });
  }
  // CONSUMO (data.consumos[])
  return arr.map((o) => {
    const pac = o.paciente || {};
    return {
      'NOM PACIENTE': g(pac, 'nombreCompleto', ''),
      'ID PACIENTE': g(pac, 'numIdPaciente', ''),
      DESCRIPCION: g(o, 'descripcion', ''),
      EPS: g(o.eps, 'nomEps', ''),
      'NUM. AUTORIZACION': g(o, 'numAutorizacion', ''),
      MEDICO: g(o.medico, 'nomMedico', ''),
      FECHA: g(o, 'fecha', ''),
      CANTIDAD: g(o, 'cantidad', 1),
      'COD. SERVICIO': g(o.referencia, 'codReferencia', ''),
      ESTATUS: g(o, 'estatus', ''),
      DOCUMENTO: g(o.reciboCaja, 'numReciboCaja', '') || g(o.factura, 'numFactura', ''),
      'VLR. BRUTO': o.precioVentaBruto !== null && o.precioVentaBruto !== undefined ? o.precioVentaBruto : '',
      'CPG/CM/DSCTS': g(o, 'copago', ''),
      'VLR. NETO': g(o, 'precioVentaNeto', ''),
    };
  });
}

/**
 * Una factura con varias formas de pago se abre en una fila por forma de pago,
 * igual que en el reporte de caja del MODELO1. Migrado desde el handler de
 * btnCaja en index.html.
 */
export function aplanarFormasPagoCaja(facturas: any[]): any[] {
  const aplanado: any[] = [];
  facturas.forEach((factura) => {
    const formas = Array.isArray(factura.formasPago) ? factura.formasPago : null;
    if (formas && formas.length) {
      formas.forEach((fp: any) => {
        aplanado.push({ ...factura, formasPago: undefined, formaPago: fp.codFormaPago, valor: fp.valor, numeroVerificacion: fp.numeroVerificacion });
      });
    } else {
      aplanado.push(factura);
    }
  });
  return aplanado;
}
