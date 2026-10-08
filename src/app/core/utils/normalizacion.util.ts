/**
 * Funciones puras de normalización. Migradas 1:1 desde index.html.
 * No mutan nada — cada una toma un valor crudo y devuelve su forma normalizada.
 */

export function up(s: unknown): string {
  return String(s == null ? '' : s).trim().toUpperCase();
}

export function normHeader(h: unknown): string {
  return up(h).replace(/[^A-Z0-9]/g, '');
}

/** Busca una columna por lista de sinónimos: primero coincidencia exacta, luego por inclusión parcial. */
export function findCol(headers: string[], synonyms: string[]): number {
  const nh = headers.map(normHeader);
  for (const syn of synonyms) {
    const ns = normHeader(syn);
    const i = nh.indexOf(ns);
    if (i >= 0) return i;
  }
  for (const syn of synonyms) {
    const ns = normHeader(syn);
    const i = nh.findIndex((h) => h && ns && (h.includes(ns) || ns.includes(h)));
    if (i >= 0) return i;
  }
  return -1;
}

export function scoreSchema(headers: string[], schema: { required: string[]; map: Record<string, string[]> }): number {
  let score = 0;
  for (const req of schema.required) {
    if (findCol(headers, [req]) >= 0) score += 2;
  }
  for (const key in schema.map) {
    if (findCol(headers, schema.map[key]) >= 0) score += 1;
  }
  return score;
}

export function excelSerialToDate(serial: number): Date {
  return new Date(Math.floor(serial - 25569) * 86400 * 1000);
}

export function normFecha(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const d = excelSerialToDate(val);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

export function normId(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\.0+$/, '').replace(/\s+/g, '');
}

/**
 * Los tres sistemas escriben los nombres distinto: CAJA usa doble espacio entre
 * nombre y apellido ("ALEJANDRO  ARRIETA") donde agenda y consumo usan uno solo.
 * Sin colapsar espacios, el mismo paciente se parte en grupos distintos.
 */
export function normNombre(val: unknown): string {
  return String(val == null ? '' : val).replace(/\s+/g, ' ').trim();
}

export function normServicio(val: unknown): string {
  if (!val) return '';
  const s = String(val).split('\n')[0];
  return s.replace(/\s*-\s*\d{4,}.*$/, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function toNumber(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Moneda colombiana escrita en el texto del servicio: "22.860" = veintidós mil
 * ochocientos sesenta. El punto es separador de miles, NO decimal — por eso no
 * se puede usar toNumber() aquí.
 */
export function parseMoneda(s: unknown): number | null {
  if (s === null || s === undefined) return null;
  const n = parseFloat(String(s).replace(/\./g, '').replace(/,/g, '').replace(/[^0-9-]/g, ''));
  return isNaN(n) ? null : n;
}

/** Distancia de edición, usada por compararCampo() para detectar errores de digitación. */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
