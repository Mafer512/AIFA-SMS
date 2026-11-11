/* ============================================================================
   Eliminación de reportes con copia de respaldo y restauración.
   ----------------------------------------------------------------------------
   - Antes de eliminar se captura el reporte y TODO lo asociado (en el orden
     en que habría que volver a insertarlo) y se guarda en reportes_eliminados.
   - La eliminación usa las llaves foráneas existentes (ON DELETE CASCADE).
   - La restauración vuelve a insertar las filas con sus id originales, dentro
     de una transacción: o se restaura todo o nada.
   - La bitácora (logs_sistema) no se toca: conserva el historial.
   - Los archivos físicos (imágenes) no se borran, para poder restaurar.
   ========================================================================= */
'use strict';

// Orden de inserción (respeta las llaves foráneas)
const TABLAS = [
    { tabla: 'reportes', where: 'id = ?', nombre: 'Reporte' },
    { tabla: 'reporte_departamento', where: 'id_reporte = ?', nombre: 'Áreas asignadas' },
    { tabla: 'seguimiento', where: 'id_reporte = ?', nombre: 'Seguimientos' },
    { tabla: 'seguimiento_archivos', where: 'id_seguimiento IN (SELECT id FROM seguimiento WHERE id_reporte = ?)', nombre: 'Evidencias de seguimientos' },
    { tabla: 'reportes_archivos', where: 'id_reporte = ?', nombre: 'Evidencias del reporte' },
    { tabla: 'ubicaciones', where: 'id_reporte = ?', nombre: 'Ubicación GPS' },
    { tabla: 'acciones_correctivas', where: 'id_reporte = ?', nombre: 'Acciones correctivas' },
    { tabla: 'acciones_correctivas_archivos', where: 'id_accion IN (SELECT id FROM acciones_correctivas WHERE id_reporte = ?)', nombre: 'Evidencias de acciones' },
    { tabla: 'reporte_evaluacion_riesgo', where: 'id_reporte = ?', nombre: 'Evaluaciones de riesgo' },
    { tabla: 'reporte_compromiso', where: 'id_reporte = ?', nombre: 'Compromisos de atención' },
    { tabla: 'reporte_zona', where: 'id_reporte = ?', nombre: 'Zona' }
];

/** Copia completa del reporte. Las fechas se leen como texto para reinsertarlas idénticas. */
async function capturar(conn, idReporte) {
    const tablas = {};
    for (const t of TABLAS) {
        const [filas] = await conn.query({ sql: `SELECT * FROM ${t.tabla} WHERE ${t.where}`, values: [idReporte], dateStrings: true });
        tablas[t.tabla] = filas;
    }
    if (!tablas.reportes.length) throw Object.assign(new Error('Reporte no encontrado'), { status: 404 });
    return { version: 1, capturado_en: new Date().toISOString(), tablas };
}

/** Conteo legible de lo que contiene una copia. */
function resumen(copia) {
    const out = {};
    for (const t of TABLAS) {
        if (t.tabla === 'reportes') continue;
        const n = (copia.tablas[t.tabla] || []).length;
        if (n) out[t.tabla] = { nombre: t.nombre, n };
    }
    return out;
}

/** Normaliza un valor leído para volver a insertarlo. */
function valor(v) {
    if (v === null || v === undefined) return null;
    if (Buffer.isBuffer(v)) return v;
    if (typeof v === 'object') return JSON.stringify(v); // columnas JSON
    return v;
}

/** Vuelve a insertar todas las filas de la copia (usar dentro de una transacción). */
async function restaurar(conn, copia) {
    const rep = copia.tablas.reportes[0];
    const [existe] = await conn.query('SELECT id FROM reportes WHERE id = ? OR folio = ? LIMIT 1', [rep.id, rep.folio]);
    if (existe.length) throw Object.assign(new Error(`Ya existe un reporte con el folio ${rep.folio}`), { status: 409 });
    const insertadas = {};
    for (const t of TABLAS) {
        const filas = copia.tablas[t.tabla] || [];
        for (const f of filas) {
            const limpia = {};
            for (const [k, v] of Object.entries(f)) limpia[k] = valor(v);
            await conn.query(`INSERT INTO ${t.tabla} SET ?`, [limpia]);
        }
        insertadas[t.tabla] = filas.length;
    }
    return insertadas;
}

module.exports = { TABLAS, capturar, resumen, restaurar };
