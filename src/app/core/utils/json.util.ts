/** Busca, en cualquier nivel de un JSON de forma desconocida, el primer array de objetos. */
export function encontrarArrayObjetos(obj: unknown, depth = 0): unknown[] | null {
  if (depth > 4 || obj === null || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) return obj.length === 0 || typeof obj[0] === 'object' ? obj : null;
  const o = obj as Record<string, unknown>;
  for (const k in o) { const r = encontrarArrayObjetos(o[k], depth + 1); if (r) return r; }
  return null;
}
