/* ============================================================================
   Notificaciones dentro de la plataforma
   ----------------------------------------------------------------------------
   Dos tipos:
   1. Eventos (tabla notificaciones): nuevo reporte, asignación, actualización,
      acción asignada, acción por validar, riesgo evaluado.
      - id_departamento_destino = área → la ve el personal de esa área.
      - id_departamento_destino NULL  → solo supervisión (supervisor/admin).
   2. Alertas vigentes (se calculan al momento): reportes vencidos, próximos a
      vencer y acciones pendientes de validación. Desaparecen solas cuando la
      condición deja de cumplirse.
   Cada usuario solo recibe lo de su área, salvo supervisión (alcance global).
   ========================================================================= */
'use strict';

const { puede } = require('./permisos');
const { BASE_CTE, opcionesMatriz } = require('./consultas');

const TIPOS = {
    nuevo_reporte: 'Nuevo reporte',
    asignacion: 'Asignación',
    actualizacion: 'Actualización',
    accion_asignada: 'Acción asignada',
    validacion_pendiente: 'Pendiente de validación',
    accion_reabierta: 'Acción reabierta',
    riesgo_evaluado: 'Riesgo evaluado',
    compromiso: 'Fecha compromiso'
};

/**
 * Registra una notificación para las áreas indicadas y, si se pide, para
 * supervisión. Nunca lanza: una falla de notificación no debe romper la
 * operación principal.
 */
async function notificar(db, { tipo, titulo, mensaje = null, idReporte = null, folio = null, departamentos = [], supervision = true }) {
    try {
        const destinos = [...new Set((departamentos || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
        const filas = destinos.map(d => [tipo, titulo, mensaje, idReporte, folio, d]);
        if (supervision) filas.push([tipo, titulo, mensaje, idReporte, folio, null]);
        if (!filas.length) return;
        await db.query(
            `INSERT INTO notificaciones (tipo, titulo, mensaje, id_reporte, folio, id_departamento_destino) VALUES ?`,
            [filas.map(f => f.map(v => (typeof v === 'string' ? v.slice(0, 500) : v)))]
        );
    } catch (e) {
        console.error('No se pudo registrar la notificación:', e.message);
    }
}

function condicionDestino(usuario) {
    return puede(usuario, 'alcance_global')
        ? { sql: 'n.id_departamento_destino IS NULL', params: [] }
        : { sql: 'n.id_departamento_destino = ?', params: [usuario.id_departamento] };
}

/**
 * Eventos del usuario. Opciones para el centro de notificaciones:
 * offset (paginación), soloNoLeidas, tipo, dias (antigüedad máxima).
 */
async function listarEventos(db, usuario, { limite = 30, offset = 0, soloNoLeidas = false, tipo = null, dias = 60 } = {}) {
    const dest = condicionDestino(usuario);
    const extra = [];
    const pExtra = [];
    if (soloNoLeidas) extra.push('nl.id_notificacion IS NULL');
    if (tipo && TIPOS[tipo]) { extra.push('n.tipo = ?'); pExtra.push(tipo); }
    const [filas] = await db.query(
        `SELECT n.id, n.tipo, n.titulo, n.mensaje, n.folio, n.creado_en,
                (nl.id_notificacion IS NOT NULL) AS leida, nl.leida_en,
                COUNT(*) OVER () AS total
         FROM notificaciones n
         LEFT JOIN notificaciones_lectura nl ON nl.id_notificacion = n.id AND nl.id_usuario = ?
         WHERE ${dest.sql} AND n.creado_en >= DATE_SUB(NOW(), INTERVAL ${Number(dias)} DAY)
         ${extra.length ? 'AND ' + extra.join(' AND ') : ''}
         ORDER BY n.creado_en DESC, n.id DESC
         LIMIT ${Number(limite)} OFFSET ${Number(offset)}`,
        [usuario.id, ...dest.params, ...pExtra]
    );
    const [[{ sin_leer }]] = await db.query(
        `SELECT COUNT(*) AS sin_leer
         FROM notificaciones n
         LEFT JOIN notificaciones_lectura nl ON nl.id_notificacion = n.id AND nl.id_usuario = ?
         WHERE ${dest.sql} AND nl.id_notificacion IS NULL AND n.creado_en >= DATE_SUB(NOW(), INTERVAL 60 DAY)`,
        [usuario.id, ...dest.params]
    );
    return {
        eventos: filas.map(f => ({ ...f, total: undefined, leida: Boolean(f.leida), tipo_nombre: TIPOS[f.tipo] || f.tipo })),
        total: filas.length ? Number(filas[0].total) : 0,
        sin_leer: Number(sin_leer)
    };
}

async function marcarLeidas(db, usuario, ids = null) {
    const dest = condicionDestino(usuario);
    let extra = '';
    const params = [usuario.id, ...dest.params];
    if (Array.isArray(ids)) {
        const limpios = ids.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 200);
        if (!limpios.length) return 0;
        extra = ' AND n.id IN (?)';
        params.push(limpios);
    }
    const [r] = await db.query(
        `INSERT IGNORE INTO notificaciones_lectura (id_notificacion, id_usuario)
         SELECT n.id, ? FROM notificaciones n WHERE ${dest.sql}${extra}`,
        params
    );
    return r.affectedRows;
}

/** Alertas vigentes calculadas para el alcance del usuario. */
async function alertasVigentes(db, usuario, matriz) {
    const op = opcionesMatriz(matriz);
    const global = puede(usuario, 'alcance_global');
    const alcance = global ? '' : 'AND EXISTS (SELECT 1 FROM reporte_departamento rdu WHERE rdu.id_reporte = b.id AND rdu.id_departamento = ?)';
    const pAlcance = global ? [] : [usuario.id_departamento];

    const [vencidos] = await db.query(
        `${BASE_CTE}
         SELECT b.folio, b.fecha_vencimiento FROM base b
         WHERE b.fecha_vencimiento < CURDATE() ${alcance}
         ORDER BY b.fecha_vencimiento ASC LIMIT 20`, pAlcance);
    const [proximos] = await db.query(
        `${BASE_CTE}
         SELECT b.folio, b.fecha_vencimiento FROM base b
         WHERE b.fecha_vencimiento >= CURDATE() AND b.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL ? DAY) ${alcance}
         ORDER BY b.fecha_vencimiento ASC LIMIT 20`, [op.diasAviso, ...pAlcance]);

    let porValidar = [];
    if (puede(usuario, 'verificar_accion')) {
        const [filas] = await db.query(
            `SELECT a.id, r.folio, a.descripcion, a.actualizado_en
             FROM acciones_correctivas a JOIN reportes r ON r.id = a.id_reporte
             WHERE a.estado = 'completada'
             ORDER BY a.actualizado_en ASC LIMIT 20`);
        porValidar = filas;
    }
    // Reportes abiertos pendientes de evaluar (solo para quien puede evaluar)
    let porEvaluar = [];
    let porEvaluarTotal = 0;
    if (puede(usuario, 'evaluar_riesgo')) {
        const [filas] = await db.query(
            `${BASE_CTE}
             SELECT b.folio, b.fecha, b.tipo_problema, COUNT(*) OVER () AS total FROM base b
             WHERE b.riesgo_nivel IS NULL AND b.estado NOT IN ('D','E','F')
             ORDER BY b.fecha ASC LIMIT 20`);
        porEvaluar = filas.map(f => ({ folio: f.folio, fecha: f.fecha, tipo_problema: f.tipo_problema }));
        porEvaluarTotal = filas.length ? Number(filas[0].total) : 0;
    }
    return {
        vencidos, proximos, por_validar: porValidar,
        por_evaluar: porEvaluar, por_evaluar_total: porEvaluarTotal,
        matriz_validada: Boolean(matriz.validada),
        dias_aviso: op.diasAviso
    };
}

module.exports = { TIPOS, notificar, listarEventos, marcarLeidas, alertasVigentes };
