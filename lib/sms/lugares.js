/* ============================================================================
   Agrupación del lugar reportado (texto libre) para detectar recurrencias.
   - "Cerca de la posición 505", "Posición 505", "alrededor de la posicion 505"
     se agrupan como "Posición 505".
   - El resto se normaliza (minúsculas, sin acentos ni muletillas iniciales).
   Es una agrupación automática del texto capturado por el reportante: la
   interfaz muestra los textos originales para que se pueda revisar.
   ========================================================================= */
'use strict';

function sinAcentos(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const MULETILLAS = /^(?:(?:muy\s+)?(?:cerca|alrededor|afuera|fuera|dentro|frente|enfrente|junto|a\s+un\s+lado|al\s+lado)\s+)?(?:a\s+|de\s+|del\s+)?(?:en\s+)?(?:la|las|el|los|del|al)?\s*/;

/** @returns {{ clave: string, etiqueta: string } | null} */
function normalizarLugar(texto) {
    const base = sinAcentos(texto).toLowerCase().replace(/[^a-z0-9ñ\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base || /^(no especificado|sin especificar|n\/?a|ninguno|-+)$/.test(base)) return null;

    // Posiciones de estacionamiento de aeronaves: "posición 505", "posiciones 500", "posicion de abordaje 505"
    const pos = /\bposi\w*\s+(?:de\s+\w+\s+)?(\d{2,4})\b/.exec(base);
    if (pos) return { clave: `posicion-${pos[1]}`, etiqueta: `Posición ${pos[1]}` };

    const puerta = /\bpuerta\s+(\d{1,3})\b/.exec(base);
    if (puerta) return { clave: `puerta-${puerta[1]}`, etiqueta: `Puerta ${puerta[1]}` };

    let resto = base.replace(MULETILLAS, '').trim();
    if (resto.length < 3) resto = base;
    resto = resto.slice(0, 60);
    // Texto libre: la etiqueta final es el texto original más frecuente del grupo
    return { clave: `texto-${resto}`, etiqueta: String(texto).trim().slice(0, 80), textoLibre: true };
}

/**
 * Agrupa filas { lugar, ... } por lugar normalizado.
 * @returns {Array<{ clave, etiqueta, n, textos: string[], filas: any[] }>} de mayor a menor
 */
function agruparLugares(filas) {
    const grupos = new Map();
    for (const f of filas) {
        const g = normalizarLugar(f.lugar);
        if (!g) continue;
        if (!grupos.has(g.clave)) grupos.set(g.clave, { clave: g.clave, etiqueta: g.etiqueta, textoLibre: Boolean(g.textoLibre), n: 0, textos: new Map(), filas: [] });
        const x = grupos.get(g.clave);
        const original = String(f.lugar).trim();
        x.n++;
        x.textos.set(original, (x.textos.get(original) || 0) + 1);
        x.filas.push(f);
    }
    return [...grupos.values()]
        .map(g => {
            const textos = [...g.textos.entries()].sort((a, b) => b[1] - a[1]).map(t => t[0]);
            const etiqueta = g.textoLibre ? textos[0].charAt(0).toUpperCase() + textos[0].slice(1, 80) : g.etiqueta;
            return { clave: g.clave, etiqueta, n: g.n, textos: textos.slice(0, 6), filas: g.filas };
        })
        .sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

module.exports = { sinAcentos, normalizarLugar, agruparLugares };
