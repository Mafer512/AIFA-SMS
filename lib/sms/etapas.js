/* ============================================================================
   Etapas de atención de un reporte y semáforo de cumplimiento de plazos.
   Funciones puras (sin BD) para poder probarlas de forma aislada.
   ========================================================================= */
'use strict';

const CERRADOS = ['D', 'E', 'F'];
const NOMBRE_CIERRE = { D: 'Resuelto', E: 'Duplicado', F: 'No requiere atención' };

/** Posición del estatus en el flujo: 0 Generado · 1 Enterado · 2 En atención · 3 Cerrado */
function posicion(estado) {
    if (estado === 'B') return 1;
    if (estado === 'C') return 2;
    if (CERRADOS.includes(estado)) return 3;
    return 0;
}

/**
 * Calcula las 4 etapas a partir de los seguimientos (en cualquier orden).
 * - Cada etapa toma la fecha del PRIMER seguimiento que la registró.
 * - Si el reporte avanzó sin registrar una etapa intermedia, esa etapa queda
 *   como "omitida" (se muestra así, no se inventa una fecha).
 * - Si se reabrió, las etapas posteriores al estatus vigente vuelven a "pendiente".
 */
function calcularEtapas({ fechaReporte, estadoActual, seguimientos = [] }) {
    const orden = [...seguimientos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || (a.id || 0) - (b.id || 0));
    const primero = [null, null, null, null];
    for (const s of orden) {
        const p = posicion(s.estado);
        if (p > 0 && !primero[p]) primero[p] = s;
    }
    const actual = posicion(estadoActual);
    const cierre = CERRADOS.includes(estadoActual) ? estadoActual : null;
    const nombres = ['Generado', 'Enterado', 'En atención', cierre ? NOMBRE_CIERRE[cierre] : 'Cierre'];
    const t0 = fechaReporte ? new Date(fechaReporte).getTime() : null;

    return nombres.map((nombre, i) => {
        const s = i === 0 ? null : primero[i];
        const fecha = i === 0 ? fechaReporte || null : (s ? s.fecha : null);
        let estado;
        if (i < actual) estado = fecha ? 'completa' : 'omitida';
        else if (i === actual) estado = i === 3 ? 'completa' : 'actual';
        else estado = 'pendiente';
        // Si se reabrió, la fecha de una etapa pendiente no aplica
        const mostrarFecha = estado === 'completa' || estado === 'actual';
        // Al cerrarse se usa la fecha del cierre vigente (el primer seguimiento con ese estatus)
        let f = mostrarFecha ? fecha : null;
        if (i === 3 && cierre) {
            const c = orden.find(x => x.estado === cierre);
            f = c ? c.fecha : f;
        }
        return {
            clave: i === 3 ? (cierre || 'cierre') : ['A', 'B', 'C'][i],
            nombre,
            estado,
            fecha: f,
            area: mostrarFecha && s ? s.departamento || null : null,
            minutos_desde_reporte: f && t0 != null ? Math.max(0, Math.round((new Date(f).getTime() - t0) / 60000)) : null
        };
    });
}

/**
 * Semáforo de cumplimiento del plazo de un reporte.
 *   vencido · proximo · en_tiempo · sin_plazo           (abiertos)
 *   cerrado_en_plazo · cerrado_fuera · cerrado           (cerrados)
 */
function semaforo({ estado, fechaVencimiento, plazoReporte, fechaCierre }, hoyISO, diasAviso = 7) {
    if (CERRADOS.includes(estado)) {
        if (!plazoReporte || !fechaCierre) return 'cerrado';
        return iso(fechaCierre) <= iso(plazoReporte) ? 'cerrado_en_plazo' : 'cerrado_fuera';
    }
    if (!fechaVencimiento) return 'sin_plazo';
    const v = iso(fechaVencimiento);
    if (v < hoyISO) return 'vencido';
    const limite = new Date(hoyISO + 'T00:00:00Z');
    limite.setUTCDate(limite.getUTCDate() + diasAviso);
    return v <= limite.toISOString().slice(0, 10) ? 'proximo' : 'en_tiempo';
}

const NOMBRE_SEMAFORO = {
    vencido: 'Vencido',
    proximo: 'Próximo a vencer',
    en_tiempo: 'En tiempo',
    sin_plazo: 'Sin plazo',
    cerrado_en_plazo: 'Cerrado en plazo',
    cerrado_fuera: 'Cerrado fuera de plazo',
    cerrado: 'Cerrado'
};

function iso(v) {
    if (v instanceof Date) {
        const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(v).slice(0, 10);
}

module.exports = { CERRADOS, NOMBRE_CIERRE, NOMBRE_SEMAFORO, posicion, calcularEtapas, semaforo };
