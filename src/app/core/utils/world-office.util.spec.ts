import { CajaRecord } from '../models/records.model';
import { prepararDocumentos } from './world-office.util';

/** Fila de CAJA mínima con los defaults que no importan para estas pruebas. */
function fila(parcial: Partial<CajaRecord>): CajaRecord {
  return {
    nombre: '', id: '', documento: '', formaPago: '', items: '', itemsRaw: '', entidad: '',
    autorizacion: '', profesional: '', fecha: '2026-08-04', estado: '', valor: 0,
    caja: 'CAJA GENERAL', agendaTipo: '', sede: '', cotizante: '', regimen: '', detalleProf: '',
    noVerificacion: '', tipoDocumento: '', fechaRegistro: '2026-08-04', quienRegistra: '', servicioFecha: '',
    categoria: 'PAGO_NORMAL', esEntidad: false, tarifa: { tar: null, pac: null, ent: null, copagoExplicito: false, detectado: false, tipo: '', regla: '' },
    ...parcial,
  };
}

describe('prepararDocumentos', () => {
  it('arma una factura R en efectivo con su producto, centro de costos y pago asociado', () => {
    const caja: CajaRecord[] = [
      fila({ documento: 'R-100', id: '123456', nombre: 'JUAN PEREZ', entidad: 'PARTICULAR', formaPago: 'EFECTIVO', valor: 32000, items: 'FISIOTERAPIA PART 32.000', itemsRaw: 'FISIOTERAPIA PART 32.000' }),
    ];
    const p = prepararDocumentos(caja);
    expect(p.facturas).toHaveLength(1);
    expect(p.excepciones).toHaveLength(0);
    const f = p.facturas[0];
    expect(f.prefijo).toBe('R');
    expect(f.empresaKey).toBe('REHABILITAR');
    expect(f.servicio).toBe('FISIOTERAPIA');
    expect(f.producto).toBe('01');
    expect(f.centroCosto).toBe('Particulares');
    expect(f.concepto).toBe('PAGO DEL DÍA');
    expect(f.cantidad).toBe(1);
    expect(f.valorUnitario).toBe(32000);
    expect(f.pagos).toHaveLength(1);
  });

  it('arma un recibo de anticipo (ANTR) con débito según la forma de pago y crédito al anticipo', () => {
    const caja: CajaRecord[] = [
      fila({ documento: 'ANTR-5', id: '123456', nombre: 'JUAN PEREZ', entidad: 'COOMEVA', formaPago: 'EFECTIVO', valor: 15000 }),
    ];
    const p = prepararDocumentos(caja);
    expect(p.recibos).toHaveLength(1);
    const r = p.recibos[0];
    expect(r.clase).toBe('ANTICIPO');
    expect(r.asientos).toHaveLength(2);
    expect(r.asientos.find((a) => a.naturaleza === 'D')?.cuenta).toBe('11050503');
    expect(r.asientos.find((a) => a.naturaleza === 'C')?.cuenta).toBe('28051501');
  });

  it('excluye el recaudo de cartera de entidad (RCE) sin romper el cuadre de totales', () => {
    const caja: CajaRecord[] = [
      fila({ documento: 'RCE-9', id: '900123456', nombre: 'COOMEVA SA', entidad: 'COOMEVA', formaPago: 'TRANSFERENCIA A DAVIVIENDA', valor: 150000, items: 'ABONO DOCUMENTO R-500' }),
    ];
    const p = prepararDocumentos(caja);
    expect(p.facturas).toHaveLength(0);
    expect(p.recibos).toHaveLength(0);
    expect(p.excluidos).toHaveLength(1);
    expect(p.excluidos[0].motivo).toMatch(/no se carga en World Office/);
  });

  it('detiene como excepción un documento sin número legible', () => {
    const caja: CajaRecord[] = [fila({ documento: 'R-SIN-NUMERO', id: '123456', formaPago: 'EFECTIVO', valor: 10000 })];
    const p = prepararDocumentos(caja);
    expect(p.excepciones).toHaveLength(1);
    expect(p.excepciones[0].motivo).toMatch(/número del documento/);
  });

  it('el control de cuadre total pasa: total caja = facturas + recibos + excluidos + excepciones', () => {
    const caja: CajaRecord[] = [
      fila({ documento: 'R-100', id: '123456', nombre: 'JUAN PEREZ', entidad: 'PARTICULAR', formaPago: 'EFECTIVO', valor: 32000, items: 'FISIOTERAPIA PART 32.000', itemsRaw: 'FISIOTERAPIA PART 32.000' }),
      fila({ documento: 'ANTR-5', id: '123456', nombre: 'JUAN PEREZ', entidad: 'COOMEVA', formaPago: 'EFECTIVO', valor: 15000 }),
      fila({ documento: 'RCE-9', id: '900123456', nombre: 'COOMEVA SA', entidad: 'COOMEVA', formaPago: 'TRANSFERENCIA A DAVIVIENDA', valor: 150000, items: 'ABONO DOCUMENTO R-500' }),
    ];
    const p = prepararDocumentos(caja);
    const total = p.controles.find((c) => c.control.startsWith('Total caja'));
    expect(total?.ok).toBe(true);
    expect(p.totalCaja).toBe(32000 + 15000 + 150000);
  });
});
