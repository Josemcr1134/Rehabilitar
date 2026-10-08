import { Injectable, inject } from '@angular/core';
import { AgendaRecord, CajaRecord, CategoriaCaja, ConsumoRecord, Tarifa } from '../models/records.model';
import { EXCLUIR_CAJA_DE_CONCILIACION, TIPOS } from '../models/schemas.model';
import { ORDEN_GRUPOS } from '../models/clasificacion.model';
import {
  AnalisisCajaRow, CajaTot, CategoriaCajaEntry, Kpis, MatrizPrefEntry, PorGrupoEntry, PorStatusEntry,
  ReferenciaRow, RelacionRow, RelacionTotales, ResultadoConciliacion, ServicioRow,
} from '../models/conciliacion-resultado.model';
import {
  CAMPOS_COMPARABLES, GrupoConciliacion, compararCampo, construirAccion, construirObservacion, estadoConciliacion,
  fuentesCode,
} from '../utils/comparacion.util';
import { normServicio, up } from '../utils/normalizacion.util';
import { servicioBase, extraerTarifa, tarifaDeFuente, compararNumeros } from '../utils/tarifa.util';
import { clasificarMovimiento, esNit } from '../utils/clasificacion.util';
import { analizarOrigenTarifas, puenteAgenda } from '../utils/origen-tarifas.util';
import { AppStateService } from './app-state.service';

/**
 * Orquesta TODO lo que hacía el handler de `btnConciliar` en index.html: agrupa
 * por paciente (groups), por servicio (servicios), por referencia/tarifa
 * (referencias), compara caja↔agenda (relacion), clasifica cada movimiento de
 * caja (analisisCaja) y arma los KPIs. Se hace en un solo recorrido, igual que
 * el original, porque varias partes comparten los mismos arreglos filtrados
 * (cajaPaciente / cajaRelevante).
 */
@Injectable({ providedIn: 'root' })
export class ConciliarOrchestratorService {
  private readonly appState = inject(AppStateService);

  ejecutar(): void {
    const agenda: AgendaRecord[] = this.appState.agenda() || [];
    const caja: CajaRecord[] = this.appState.caja() || [];
    const consumo: ConsumoRecord[] = this.appState.consumo() || [];

    const cajaEntidad = caja.filter((r) => r.esEntidad);
    const cajaPaciente = caja.filter((r) => !r.esEntidad);
    const cajaRelevante = cajaPaciente.filter((r) => !EXCLUIR_CAJA_DE_CONCILIACION.includes(r.categoria));

    const groups = this.construirGroups(agenda, cajaRelevante, consumo);
    const servicios = this.construirServicios(agenda, cajaRelevante, consumo);
    const referencias = this.construirReferencias(agenda, cajaRelevante, consumo);
    const { relacion, relTot } = this.construirRelacion(agenda, cajaRelevante);
    const { analisisCaja, cajaTot, porGrupo, porStatus, matrizPref } = this.construirAnalisisCaja(caja);
    const cats = this.construirCats(caja);

    const kpis = this.construirKpis(agenda, caja, consumo, cajaEntidad, cajaPaciente, groups, referencias, cats);

    const resultado: ResultadoConciliacion = { servicios, referencias, relacion, relTot, analisisCaja, cajaTot, porGrupo, porStatus, matrizPref, cats, kpis };

    this.appState.groups.set(groups);
    this.appState.resultado.set(resultado);
    this.appState.origenTar.set(analizarOrigenTarifas(this.appState.raw(), porGrupo['RADICADO A ENTIDAD']?.valor || 0));
  }

  /** Puente agenda↔caja (card 5), recalculado cada vez que se pide (depende del campo manual). */
  puente() {
    const o = this.appState.origenTar();
    if (!o) return null;
    return puenteAgenda(o, this.appState.facturadoEntidadManual());
  }

  // ---------- Hoja «Conciliación»: un grupo por documento de identidad ----------
  private construirGroups(agenda: AgendaRecord[], cajaRelevante: CajaRecord[], consumo: ConsumoRecord[]): GrupoConciliacion[] {
    const groupsMap = new Map<string, { id: string; fechas: string[]; agenda: AgendaRecord[]; caja: CajaRecord[]; consumo: ConsumoRecord[] }>();
    const ensure = (id: string) => {
      let g = groupsMap.get(id);
      if (!g) { g = { id, fechas: [], agenda: [], caja: [], consumo: [] }; groupsMap.set(id, g); }
      return g;
    };
    agenda.forEach((r) => { const g = ensure(r.id); g.agenda.push(r); if (r.fecha) g.fechas.push(r.fecha); });
    cajaRelevante.forEach((r) => { const g = ensure(r.id); g.caja.push(r); if (r.fecha) g.fechas.push(r.fecha); });
    consumo.forEach((r) => { const g = ensure(r.id); g.consumo.push(r); if (r.fecha) g.fechas.push(r.fecha); });

    const grupos: GrupoConciliacion[] = [...groupsMap.values()].map((g) => {
      const countAgenda = g.agenda.length, countCaja = g.caja.length, countConsumo = g.consumo.length;
      const fecha = g.fechas.length ? [...g.fechas].sort()[0] : '';
      const estado = estadoConciliacion(countAgenda, countCaja, countConsumo);
      const nombre = g.agenda[0]?.nombre || g.consumo[0]?.nombre || g.caja[0]?.nombre || '';
      const fuentesPresentes = TIPOS.filter((t) => (t === 'AGENDA' ? countAgenda : t === 'CAJA' ? countCaja : countConsumo) > 0);
      const comparaciones = CAMPOS_COMPARABLES.map((c) => compararCampo(c, g, fuentesPresentes));
      const base: GrupoConciliacion = {
        id: g.id, fecha, nombre, agenda: g.agenda, caja: g.caja, consumo: g.consumo,
        countAgenda, countCaja, countConsumo, estado, comparaciones, observacion: '', accion: '',
      };
      base.observacion = construirObservacion(base);
      base.accion = construirAccion(base);
      return base;
    });
    return grupos.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // ---------- Hoja «Por servicio»: un grupo por (paciente, servicio) ----------
  private construirServicios(agenda: AgendaRecord[], cajaRelevante: CajaRecord[], consumo: ConsumoRecord[]): ServicioRow[] {
    const servMap = new Map<string, ServicioRow>();
    const ensureServ = (id: string, nombre: string, servicio: string): ServicioRow => {
      const key = id + '||' + servicio;
      let s = servMap.get(key);
      if (!s) { s = { id, nombre, servicio, ag: 0, cj: 0, co: 0, cajaRecs: [], estado: '', aprobado: false, notaAprobado: '' }; servMap.set(key, s); }
      else if (!s.nombre) s.nombre = nombre;
      return s;
    };
    agenda.forEach((r) => { ensureServ(r.id, r.nombre, normServicio(r.referencia)).ag++; });
    // Se guarda también el registro de caja completo: la llave de agrupación es el texto
    // literal de ITEMS, así que los movimientos de un mismo grupo comparten el mismo PAC
    // declarado — eso permite detectar el cobro partido en varios recibos.
    cajaRelevante.forEach((r) => { const g = ensureServ(r.id, r.nombre, r.items); g.cj++; g.cajaRecs.push(r); });
    consumo.forEach((r) => { ensureServ(r.id, r.nombre, r.descripcion).co++; });

    return [...servMap.values()]
      .map((s) => ({ ...s, estado: estadoConciliacion(s.ag, s.cj, s.co) }))
      .map((s) => {
        // Cobro partido en varios recibos: AG y CO cuadran, pero CAJA trae más movimientos
        // porque el paciente pagó con 2+ formas de pago distintas. Se valida solo sobre
        // 'Conteo diferente' — las filas ya Conciliadas no se tocan.
        if (s.estado === 'Conteo diferente' && s.ag === s.co && s.cj > s.ag && s.cajaRecs.length === s.cj) {
          const t = s.cajaRecs[0].tarifa;
          if (t && t.detectado && t.pac !== null) {
            const sumaValor = s.cajaRecs.reduce((acc, r) => acc + r.valor, 0);
            if (Math.abs(sumaValor - t.pac) < 1) {
              s.aprobado = true;
              s.notaAprobado = `Aprobado: ${s.cj} documentos suman el mismo valor de asume paciente`;
            }
          }
        }
        return s;
      })
      .sort((a, b) => (a.nombre + a.servicio).localeCompare(b.nombre + b.servicio));
  }

  // ---------- Hoja «REFERENCIAITEMDESCRIPCION»: un grupo por (paciente, servicio BASE) ----------
  private construirReferencias(agenda: AgendaRecord[], cajaRelevante: CajaRecord[], consumo: ConsumoRecord[]): ReferenciaRow[] {
    const refMap = new Map<string, { id: string; nombre: string; base: string; AGENDA: Tarifa[]; CAJA: Tarifa[]; CONSUMO: Tarifa[] }>();
    const ensureRef = (id: string, nombre: string, base: string) => {
      const key = id + '||' + base;
      let g = refMap.get(key);
      if (!g) { g = { id, nombre, base, AGENDA: [], CAJA: [], CONSUMO: [] }; refMap.set(key, g); }
      else if (!g.nombre) g.nombre = nombre;
      return g;
    };
    agenda.forEach((r) => { const t = normServicio(r.referencia); if (t) ensureRef(r.id, r.nombre, servicioBase(t)).AGENDA.push(extraerTarifa(t)); });
    cajaRelevante.forEach((r) => { if (r.items) ensureRef(r.id, r.nombre, servicioBase(r.items)).CAJA.push(r.tarifa); });
    consumo.forEach((r) => { if (r.descripcion) ensureRef(r.id, r.nombre, servicioBase(r.descripcion)).CONSUMO.push(r.tarifa); });

    return [...refMap.values()].map((g) => {
      const ag = tarifaDeFuente(g.AGENDA), cj = tarifaDeFuente(g.CAJA), co = tarifaDeFuente(g.CONSUMO);
      const tarOk = compararNumeros([ag.tar, cj.tar, co.tar]);
      const pacOk = compararNumeros([ag.pac, cj.pac, co.pac]);
      const entOk = compararNumeros([ag.ent, cj.ent, co.ent]);
      const conTarifa = [ag, cj, co].filter((t) => t.tar !== null);
      const sumaOk = conTarifa.length ? (conTarifa.every((t) => Math.abs((t.tar || 0) - ((t.pac || 0) + (t.ent || 0))) < 1) ? 'SI' : 'NO') : 'N/A';
      const presentes = [g.AGENDA.length, g.CAJA.length, g.CONSUMO.length].filter((n) => n > 0).length;
      const hayDiferencia = [tarOk, pacOk, entOk, sumaOk].includes('NO') || ag.variasTarifas || cj.variasTarifas || co.variasTarifas || co.brutoDifiere;
      let estado: ReferenciaRow['estado'];
      if (!conTarifa.length) estado = 'Sin tarifa detectada';
      else if (hayDiferencia) estado = 'Diferencia';
      else if (presentes < 3) estado = 'Falta en una fuente';
      else estado = 'Cuadra';
      return {
        id: g.id, nombre: g.nombre, base: g.base,
        fuentes: fuentesCode(g.AGENDA.length, g.CAJA.length, g.CONSUMO.length),
        ag, cj, co, tarOk: tarOk as any, pacOk: pacOk as any, entOk: entOk as any, sumaOk: sumaOk as any, estado,
      };
    }).sort((a, b) => (a.nombre + a.base).localeCompare(b.nombre + b.base));
  }

  // ---------- Hoja «relacion_caja_agenda» ----------
  private construirRelacion(agenda: AgendaRecord[], cajaRelevante: CajaRecord[]): { relacion: RelacionRow[]; relTot: RelacionTotales } {
    const claveServ = (s: string) => servicioBase(s).replace(/[.\s]+$/, '').trim();
    interface RelAcc { id: string; nomAgenda: Set<string>; nomCaja: Set<string>; citas: number; movimientos: number; documentos: Set<string>; servAgenda: Map<string, number>; servCaja: Map<string, Set<string>> }
    const relMap = new Map<string, RelAcc>();
    const ensureRel = (id: string): RelAcc => {
      let g = relMap.get(id);
      if (!g) { g = { id, nomAgenda: new Set(), nomCaja: new Set(), citas: 0, movimientos: 0, documentos: new Set(), servAgenda: new Map(), servCaja: new Map() }; relMap.set(id, g); }
      return g;
    };
    agenda.forEach((r) => {
      const g = ensureRel(r.id); g.citas++;
      if (r.nombre) g.nomAgenda.add(r.nombre);
      const s = claveServ(normServicio(r.referencia));
      if (s) g.servAgenda.set(s, (g.servAgenda.get(s) || 0) + 1);
    });
    cajaRelevante.forEach((r) => {
      const g = ensureRel(r.id); g.movimientos++;
      if (r.nombre) g.nomCaja.add(r.nombre);
      if (r.documento) g.documentos.add(r.documento);
      const s = claveServ(r.items);
      if (s) {
        // Se guardan los documentos, no las filas: dos formas de pago de la misma factura
        // no son dos cobros del mismo servicio.
        if (!g.servCaja.has(s)) g.servCaja.set(s, new Set());
        g.servCaja.get(s)!.add(r.documento || r.fecha + '|' + r.items);
      }
    });

    const listaServ = (m: Map<string, number | Set<string>>) => [...m.entries()].map(([s, v]) => `${s} (${v instanceof Set ? v.size : v})`).join(' | ');

    const relacion: RelacionRow[] = [...relMap.values()].map((g) => {
      const citas = g.citas, movs = g.movimientos, docs = g.documentos.size;
      const nomA = [...g.nomAgenda].join(' | '), nomC = [...g.nomCaja].join(' | ');
      const nombreIgual: RelacionRow['nombreIgual'] = !nomA || !nomC ? 'N/A' : up(nomA) === up(nomC) ? 'SI' : 'NO';
      const notas: string[] = [];
      let revisar = false, refDifiere = false;

      if (citas === 0 && movs > 0) { notas.push('Cobro en caja sin cita agendada'); revisar = true; }
      if (movs === 0 && citas > 0) { notas.push('Cita agendada sin ningún cobro en caja'); revisar = true; }
      if (citas > 0 && docs > citas) { notas.push(`${docs - citas} cobro(s) de más frente a lo agendado`); revisar = true; }
      if (docs > 0 && docs < citas) { notas.push(`${citas - docs} cita(s) agendada(s) sin cobro`); revisar = true; }
      if (nombreIgual === 'NO') { notas.push(`Nombre en caja distinto al agendado: «${nomC}» ≠ «${nomA}»`); revisar = true; }

      const todos = [...new Set([...g.servAgenda.keys(), ...g.servCaja.keys()])].sort();
      todos.forEach((s) => {
        const a = g.servAgenda.get(s) || 0;
        const c = g.servCaja.has(s) ? g.servCaja.get(s)!.size : 0;
        if (a === c) return;
        refDifiere = true; revisar = true;
        if (c === 0) notas.push(`Servicio agendado que no se cobró: ${s}`);
        else if (a === 0) notas.push(`Servicio cobrado que no fue agendado: ${s}`);
        else if (c > a) notas.push(`«${s}» cobrado ${c} vez/veces pero agendado ${a}`);
        else notas.push(`«${s}» agendado ${a} vez/veces pero cobrado ${c}`);
      });
      const refIgual: RelacionRow['refIgual'] = !g.servAgenda.size || !g.servCaja.size ? 'N/A' : refDifiere ? 'NO' : 'SI';

      if (movs > docs) notas.push(`${movs - docs} factura(s) pagada(s) en varias formas de pago (no es un error)`);

      const estado: RelacionRow['estado'] = revisar ? 'Revisar' : 'OK';
      return {
        id: g.id, nomAgenda: nomA, nomCaja: nomC, nombreIgual, citas, movimientos: movs, documentos: docs,
        dif: docs - citas, servAgenda: listaServ(g.servAgenda), servCaja: listaServ(g.servCaja), refIgual,
        estado, inusualidades: notas.join(' · ') || 'Sin novedad',
      };
    }).sort((a, b) => (a.estado === b.estado ? String(a.id).localeCompare(String(b.id)) : a.estado === 'Revisar' ? -1 : 1));

    const docsCaja = new Set(cajaRelevante.map((r) => r.documento).filter(Boolean));
    const relTot: RelacionTotales = {
      citas: agenda.length, movimientos: cajaRelevante.length, documentos: docsCaja.size,
      divididas: cajaRelevante.length - docsCaja.size,
      pacAgenda: new Set(agenda.map((r) => r.id)).size, pacCaja: new Set(cajaRelevante.map((r) => r.id)).size,
      soloAgenda: relacion.filter((r) => r.movimientos === 0).length, soloCaja: relacion.filter((r) => r.citas === 0).length,
      aRevisar: relacion.filter((r) => r.estado === 'Revisar').length,
      nombreDistinto: relacion.filter((r) => r.nombreIgual === 'NO').length, refDistinta: relacion.filter((r) => r.refIgual === 'NO').length,
    };
    return { relacion, relTot };
  }

  // ---------- Hoja «analisis_caja»: un renglón por movimiento ----------
  private construirAnalisisCaja(caja: CajaRecord[]) {
    const porDoc = new Map<string, CajaRecord[]>();
    caja.forEach((r) => { const arr = porDoc.get(r.documento) || []; arr.push(r); porDoc.set(r.documento, arr); });

    const analisisCaja: AnalisisCajaRow[] = caja.map((r) => {
      const c = clasificarMovimiento(r);
      const t = r.tarifa || ({} as Tarifa);
      const hermanos = porDoc.get(r.documento) || [r];
      const recaudo = c.hayRecaudo ? r.valor : 0;

      const inc: string[] = [];
      if (!c.regla) inc.push(`Prefijo «${c.pre || '(vacío)'}» fuera de la matriz (COPG, COPL, R, RCR-A, RCL-A, ANTL, ANTR, RCE, LA)`);
      else if (!String(r.formaPago || '').trim()) inc.push('Movimiento sin forma de pago');
      else if (c.formaValida === 'NO') inc.push(`Forma de pago «${c.forma}» no permitida para ${c.pre} (permitidas: ${c.formasPermitidas.join(', ')})`);

      if ((c.pre === 'RCR-A' || c.pre === 'RCL-A') && Math.round(Number(r.valor) || 0) !== 0) {
        inc.push(`${c.pre} con valor distinto de 0: se reclasifica como PAGO DE DEUDA, no como servicio del día`);
      }

      if (c.grupo === 'ASUME PACIENTE' && c.hayRecaudo && t.detectado && t.pac !== null) {
        const pagadoDoc = hermanos.reduce((s, x) => s + x.valor, 0);
        if (Math.abs(pagadoDoc - t.pac) >= 1) {
          inc.push(`El documento suma ${Math.round(pagadoDoc).toLocaleString('es-CO')} pero al paciente le correspondía ${Math.round(t.pac).toLocaleString('es-CO')}`);
        }
      }

      if (t.detectado && Math.abs((t.tar || 0) - ((t.pac || 0) + (t.ent || 0))) >= 1) inc.push('En el ítem, TAR no es igual a PAC + ENT');
      if (c.grupo === 'RADICADO A ENTIDAD' && c.pre === 'R' && !esNit(r.id)) inc.push('Radicado a entidad pero el tercero no trae NIT');
      if (c.status === 'SIN_CLASIFICAR') inc.push('No se pudo determinar quién asumió el costo');
      if (!t.detectado && !/^ABONO DOCUMENTO/.test(up(r.items))) inc.push('No se pudo leer la tarifa del ítem');

      return {
        bloque: c.bloque, grupo: c.grupo, status: c.status, hayRecaudo: c.hayRecaudo ? 'SI' : 'NO',
        entraAgenda: c.entraAgenda ? 'SI' : 'NO',
        documento: r.documento, prefijo: c.pre, tipoDoc: c.tipoDoc, fecha: r.fecha, id: r.id, nombre: r.nombre,
        entidad: r.entidad, formaPago: r.formaPago, formaNorm: c.forma, formaValida: c.formaValida,
        valor: r.valor,
        servicio: /^ABONO DOCUMENTO/.test(up(r.items)) ? r.items : servicioBase(r.items),
        tar: t.detectado ? t.tar : null, pac: t.detectado ? t.pac : null, ent: t.detectado ? t.ent : null,
        tipoTarifa: !t.detectado ? '' : t.copagoExplicito ? 'CONVENIO' : t.ent ? 'MIXTA' : 'PARTICULAR',
        recaudo, resto: c.hayRecaudo ? 0 : r.valor,
        destino: c.hayRecaudo ? '' : c.destino,
        clausula: c.clausula,
        inconsistencias: inc.join(' · '),
      } satisfies AnalisisCajaRow;
    }).sort((a, b) => {
      const ordenGrupo = (g: string) => { const i = ORDEN_GRUPOS.indexOf(g as any); return i < 0 ? 99 : i; };
      if (ordenGrupo(a.grupo) !== ordenGrupo(b.grupo)) return ordenGrupo(a.grupo) - ordenGrupo(b.grupo);
      if (a.prefijo !== b.prefijo) return String(a.prefijo).localeCompare(String(b.prefijo));
      return String(a.documento).localeCompare(String(b.documento), 'es', { numeric: true });
    });

    const sumaSi = (f: (x: AnalisisCajaRow) => boolean) => analisisCaja.filter(f).reduce((s, x) => s + x.valor, 0);
    const cuentaSi = (f: (x: AnalisisCajaRow) => boolean) => analisisCaja.filter(f).length;
    const cajaTot: CajaTot = {
      movimientos: analisisCaja.length,
      documentos: new Set(analisisCaja.map((x) => x.documento).filter(Boolean)).size,
      valorPaciente: sumaSi((x) => x.grupo === 'ASUME PACIENTE'),
      recaudoDia: analisisCaja.reduce((s, x) => s + x.recaudo, 0),
      recaudoPaciente: analisisCaja.filter((x) => x.grupo === 'ASUME PACIENTE').reduce((s, x) => s + x.recaudo, 0),
      recaudoCartera: analisisCaja.filter((x) => x.grupo === 'PAGO DE DEUDA').reduce((s, x) => s + x.recaudo, 0),
      recaudoAnticipos: analisisCaja.filter((x) => x.grupo === 'ANTICIPO RECIBIDO').reduce((s, x) => s + x.recaudo, 0),
      radicado: sumaSi((x) => x.grupo === 'RADICADO A ENTIDAD'),
      anticipos: sumaSi((x) => x.status === 'ANTICIPO_APLICADO'),
      creditos: sumaSi((x) => x.status === 'CREDITO_POR_COBRAR'),
      ajustes: sumaSi((x) => x.status === 'AJUSTE_DE_CARTERA'),
      sinValor: cuentaSi((x) => x.status === 'SIN_VALOR'),
      asumeEntidad: cuentaSi((x) => x.status === 'SIN_VALOR'),
      entranAgenda: cuentaSi((x) => x.entraAgenda === 'SI'),
      noEntranAgenda: cuentaSi((x) => x.entraAgenda === 'NO'),
      anulados: cuentaSi((x) => x.grupo === 'ANULADO'),
      formaInvalida: cuentaSi((x) => x.formaValida === 'NO'),
      totalMovido: analisisCaja.reduce((s, x) => s + x.valor, 0),
      conInconsistencia: cuentaSi((x) => !!x.inconsistencias),
    };

    const porGrupo: Record<string, PorGrupoEntry> = {};
    ORDEN_GRUPOS.forEach((g) => { porGrupo[g] = { n: 0, valor: 0, recaudo: 0, agenda: 0 }; });
    analisisCaja.forEach((x) => {
      if (!porGrupo[x.grupo]) porGrupo[x.grupo] = { n: 0, valor: 0, recaudo: 0, agenda: 0 };
      porGrupo[x.grupo].n++; porGrupo[x.grupo].valor += x.valor; porGrupo[x.grupo].recaudo += x.recaudo;
      if (x.entraAgenda === 'SI') porGrupo[x.grupo].agenda++;
    });
    Object.keys(porGrupo).forEach((g) => { if (!porGrupo[g].n) delete porGrupo[g]; });

    const matrizPref: Record<string, MatrizPrefEntry> = {};
    analisisCaja.forEach((x) => {
      const p = x.prefijo || '(vacío)';
      if (!matrizPref[p]) matrizPref[p] = { n: 0, valor: 0, recaudo: 0, formas: {}, invalidas: 0, grupo: x.grupo, entraAgenda: x.entraAgenda };
      const m = matrizPref[p];
      m.n++; m.valor += x.valor; m.recaudo += x.recaudo;
      if (x.formaValida === 'NO') m.invalidas++;
      const f = x.formaNorm || '(sin forma de pago)';
      if (!m.formas[f]) m.formas[f] = { n: 0, valor: 0, ok: x.formaValida };
      m.formas[f].n++; m.formas[f].valor += x.valor;
    });

    const porStatus: Record<string, PorStatusEntry> = {};
    analisisCaja.forEach((x) => {
      if (!porStatus[x.status]) porStatus[x.status] = { n: 0, valor: 0, recaudo: 0 };
      porStatus[x.status].n++; porStatus[x.status].valor += x.valor; porStatus[x.status].recaudo += x.recaudo;
    });

    return { analisisCaja, cajaTot, porGrupo, porStatus, matrizPref };
  }

  // ---------- Categorías de caja ----------
  private construirCats(caja: CajaRecord[]): Record<CategoriaCaja, CategoriaCajaEntry> {
    const cats = {} as Record<CategoriaCaja, CategoriaCajaEntry>;
    caja.forEach((r) => {
      if (!cats[r.categoria]) cats[r.categoria] = { count: 0, valor: 0 };
      cats[r.categoria].count++; cats[r.categoria].valor += r.valor;
    });
    return cats;
  }

  // ---------- KPIs agregados ----------
  private construirKpis(
    agenda: AgendaRecord[], caja: CajaRecord[], consumo: ConsumoRecord[],
    cajaEntidad: CajaRecord[], cajaPaciente: CajaRecord[],
    groups: GrupoConciliacion[], referencias: ReferenciaRow[], cats: Record<CategoriaCaja, CategoriaCajaEntry>,
  ): Kpis {
    const valorCat = (c: CategoriaCaja) => cats[c]?.valor || 0;

    // El financiero se agrega POR DOCUMENTO ÚNICO: una factura pagada en dos formas de
    // pago aparece dos veces en caja; si no se deduplica, la facturación bruta se infla.
    const porDocumento = new Map<string, Tarifa>();
    cajaPaciente.forEach((r) => {
      const key = r.documento || r.id + '|' + r.fecha + '|' + r.items;
      if (!porDocumento.has(key)) porDocumento.set(key, r.tarifa);
    });
    const docs = [...porDocumento.values()];
    const docsDetectados = docs.filter((t) => t.detectado);
    const tarTotal = docsDetectados.reduce((s, t) => s + (t.tar || 0), 0);
    const pacTotal = docsDetectados.reduce((s, t) => s + (t.pac || 0), 0);
    const entTotal = docsDetectados.reduce((s, t) => s + (t.ent || 0), 0);
    const copagos = docsDetectados.filter((t) => t.copagoExplicito).reduce((s, t) => s + (t.pac || 0), 0);

    const gruposConciliados = groups.filter((g) => g.estado === 'Conciliado');
    const citasConciliadas = gruposConciliados.reduce((s, g) => s + g.countAgenda, 0);

    return {
      registrosAgenda: agenda.length, registrosCaja: cajaPaciente.length, registrosConsumo: consumo.length,
      movimientosEntidad: cajaEntidad.length,
      pacientesAgenda: new Set(agenda.map((r) => r.id)).size, pacientesCaja: new Set(cajaPaciente.map((r) => r.id)).size,
      pacientesConsumo: new Set(consumo.map((r) => r.id)).size,
      gruposConciliados: gruposConciliados.length, gruposTotales: groups.length, citasConciliadas,
      pctConciliacion: agenda.length ? (citasConciliadas / agenda.length) * 100 : 0,
      inconsistencias: groups.length - gruposConciliados.length,
      facturacionBruta: tarTotal, descuentosCopagos: copagos, facturacionNeta: tarTotal - copagos,
      recaudoCaja: cajaPaciente.reduce((s, r) => s + r.valor, 0),
      anticipos: valorCat('ANTICIPO'), transferenciasFacturacion: cajaEntidad.reduce((s, r) => s + r.valor, 0),
      credito: valorCat('CREDITO'), anulados: valorCat('ANULADO'), anuladosCount: cats.ANULADO?.count || 0,
      tarTotal, pacTotal, entTotal, docsTotal: docs.length, docsDetectados: docsDetectados.length,
      refTotal: referencias.length, refDiferencia: referencias.filter((r) => r.estado === 'Diferencia').length,
      refIncompleto: referencias.filter((r) => r.estado === 'Falta en una fuente').length,
    };
  }
}
