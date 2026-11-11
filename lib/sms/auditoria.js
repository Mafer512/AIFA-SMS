/* ============================================================================
   Bitácora de auditoría
   Reutiliza la tabla existente logs_sistema con categoria = 'auditoria'.
   Se escribe con la MISMA conexión de la operación, para que el registro
   quede dentro de la transacción (si la operación se revierte, también él).
   ========================================================================= */
'use strict';

async function auditar(db, { accion, descripcion, usuario = null, idReporte = null, datos = {}, req = null }) {
    await db.query(
        `INSERT INTO logs_sistema (nivel, categoria, accion, descripcion, datos_adicionales, id_usuario, id_reporte, ip_address, user_agent)
         VALUES ('info', 'auditoria', ?, ?, ?, ?, ?, ?, ?)`,
        [
            String(accion).slice(0, 100),
            descripcion ? String(descripcion).slice(0, 2000) : null,
            JSON.stringify({
                ...datos,
                usuario_nombre: usuario ? usuario.nombre || usuario.username : null,
                usuario_rol: usuario ? usuario.rol : null,
                departamento: usuario ? usuario.departamento || null : null
            }),
            usuario ? usuario.id : null,
            idReporte,
            req ? String(req.ip || '').slice(0, 45) : null,
            req ? String(req.headers['user-agent'] || '').slice(0, 500) : null
        ]
    );
}

async function leerDatos(valor) {
    if (!valor) return {};
    if (typeof valor === 'object') return valor;
    try { return JSON.parse(valor); } catch (e) { return {}; }
}

async function eventosDeReporte(db, idReporte) {
    const [filas] = await db.query(
        `SELECT id, accion, descripcion, datos_adicionales, id_usuario, fecha
         FROM logs_sistema
         WHERE categoria = 'auditoria' AND id_reporte = ?
         ORDER BY fecha ASC, id ASC`,
        [idReporte]
    );
    const out = [];
    for (const f of filas) {
        out.push({ ...f, datos: await leerDatos(f.datos_adicionales), datos_adicionales: undefined });
    }
    return out;
}

async function listar(db, { pagina = 1, porPagina = 50, accion = null, folio = null, desde = null, hasta = null } = {}) {
    const p = [];
    let where = `WHERE l.categoria = 'auditoria'`;
    if (accion) { where += ' AND l.accion = ?'; p.push(accion); }
    if (folio) { where += ' AND COALESCE(r.folio, re.folio) = ?'; p.push(folio); }
    if (desde) { where += ' AND l.fecha >= ?'; p.push(desde); }
    if (hasta) { where += ' AND l.fecha < DATE_ADD(?, INTERVAL 1 DAY)'; p.push(hasta); }
    const [filas] = await db.query(
        `SELECT l.id, l.accion, l.descripcion, l.datos_adicionales, l.id_usuario, l.id_reporte, l.ip_address, l.fecha,
                COALESCE(r.folio, re.folio) AS folio, (r.id IS NULL AND re.folio IS NOT NULL) AS reporte_eliminado,
                COUNT(*) OVER () AS total
         FROM logs_sistema l
         LEFT JOIN reportes r ON r.id = l.id_reporte
         LEFT JOIN (SELECT id_reporte, MAX(folio) AS folio FROM reportes_eliminados GROUP BY id_reporte) re ON re.id_reporte = l.id_reporte
         ${where}
         ORDER BY l.fecha DESC, l.id DESC
         LIMIT ${Number(porPagina)} OFFSET ${(Number(pagina) - 1) * Number(porPagina)}`,
        p
    );
    const out = [];
    for (const f of filas) out.push({ ...f, datos: await leerDatos(f.datos_adicionales), datos_adicionales: undefined, total: undefined });
    return { registros: out, total: filas.length ? Number(filas[0].total) : 0 };
}

module.exports = { auditar, eventosDeReporte, listar };
