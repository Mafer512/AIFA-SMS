/* ============================================================================
   Consultas del módulo SMS
   ----------------------------------------------------------------------------
   Todo parte de una sola consulta base con UNA FILA POR REPORTE. El estatus
   vigente es el del último seguimiento (o el del reporte si aún no tiene),
   igual que en el resto del sistema. Así el total de los indicadores y el
   número de resultados de la tabla siempre coinciden, aunque un reporte esté
   asociado a varias áreas.

   Fechas derivadas:
   - fecha_cierre:     primer seguimiento cerrado (D, E o F) posterior al último
                       seguimiento abierto (si se reabrió, cuenta el cierre vigente).
   - fecha_resolucion: igual, pero solo con estatus D (Resuelto).
   - plazo_reporte:    lo que ocurra primero entre la fecha compromiso del
                       reporte y la fecha límite de su riesgo inicial.
   - fecha_vencimiento (solo abiertos): lo que ocurra primero entre el plazo del
                       reporte y la fecha compromiso de sus acciones abiertas.
   - cerrado_en_plazo (solo cerrados con plazo): 1 si se cerró a tiempo.
   ========================================================================= */
'use strict';

const { construirWhere, construirOrden } = require('./filtros');
const spi = require('./spi');
const { TIPOS_REPORTE, nombreTipo } = require('./clasificacion');

const BASE_CTE = `
WITH ult AS (
    SELECT s.id_reporte, s.estado, s.descripcion, s.fecha, s.folio_seguimiento, s.id_departamento,
           ROW_NUMBER() OVER (PARTITION BY s.id_reporte ORDER BY s.fecha DESC, s.id DESC) AS rn
    FROM seguimiento s
),
abierta AS (
    SELECT id_reporte, MAX(fecha) AS ultima
    FROM seguimiento WHERE estado NOT IN ('D','E','F')
    GROUP BY id_reporte
),
cierre AS (
    -- Fecha en que se REGISTRÓ el cierre vigente (fecha_evento no es confiable:
    -- los valores automáticos históricos se guardaron con desfase de zona horaria)
    SELECT s.id_reporte,
           MIN(s.fecha) AS fecha_cierre,
           MIN(CASE WHEN s.estado = 'D' THEN s.fecha END) AS fecha_resolucion
    FROM seguimiento s
    LEFT JOIN abierta ab ON ab.id_reporte = s.id_reporte
    WHERE s.estado IN ('D','E','F') AND (ab.ultima IS NULL OR s.fecha > ab.ultima)
    GROUP BY s.id_reporte
),
rie AS (
    SELECT e.id_reporte, e.tipo, e.probabilidad, e.severidad, e.indice, e.nivel, e.nivel_nombre, e.prioridad,
           e.fecha_limite, e.fecha,
           ROW_NUMBER() OVER (PARTITION BY e.id_reporte ORDER BY e.fecha DESC, e.id DESC) AS rn
    FROM reporte_evaluacion_riesgo e
),
rini AS (
    SELECT e.id_reporte, e.indice, e.nivel, e.nivel_nombre, e.fecha_limite,
           ROW_NUMBER() OVER (PARTITION BY e.id_reporte ORDER BY e.fecha DESC, e.id DESC) AS rn
    FROM reporte_evaluacion_riesgo e
    WHERE e.tipo = 'inicial'
),
comp AS (
    SELECT c.id_reporte, c.fecha_compromiso, c.responsable_nombre, c.id_departamento_responsable,
           ROW_NUMBER() OVER (PARTITION BY c.id_reporte ORDER BY c.creado_en DESC, c.id DESC) AS rn
    FROM reporte_compromiso c
),
acc AS (
    SELECT id_reporte,
           COUNT(*) AS acciones_total,
           SUM(estado IN ('pendiente','en_proceso')) AS acciones_abiertas,
           SUM(estado = 'completada') AS acciones_por_verificar,
           SUM(estado IN ('pendiente','en_proceso') AND fecha_compromiso < CURDATE()) AS acciones_vencidas,
           MIN(CASE WHEN estado IN ('pendiente','en_proceso') THEN fecha_compromiso END) AS proximo_compromiso
    FROM acciones_correctivas
    GROUP BY id_reporte
),
dep AS (
    SELECT rd.id_reporte,
           GROUP_CONCAT(DISTINCT CASE WHEN rd.es_responsable = 1 THEN d.nombre END ORDER BY d.nombre SEPARATOR '||') AS responsables,
           GROUP_CONCAT(DISTINCT d.nombre ORDER BY d.nombre SEPARATOR '||') AS notificadas
    FROM reporte_departamento rd
    JOIN departamentos d ON d.id = rd.id_departamento
    GROUP BY rd.id_reporte
),
base0 AS (
    SELECT r.id, r.folio, r.fecha, r.tipo_problema, r.descripcion, r.lugar,
           r.tipo_reporte, r.percepcion_probabilidad, r.percepcion_severidad, r.sugerencia_prevencion,
           r.vuelo, r.matricula, r.posicion, r.gse_tipo, r.gse_numero,
           COALESCE(u.estado, r.estado) AS estado,
           r.estado AS estado_registro,
           u.descripcion AS ultimo_seguimiento,
           u.folio_seguimiento,
           COALESCE(u.fecha, r.fecha) AS fecha_actualizacion,
           dep.responsables,
           dep.notificadas,
           COALESCE(dep.responsables, dep.notificadas) AS area_orden,
           k.tipo AS riesgo_tipo,
           k.nivel AS riesgo_nivel,
           k.nivel_nombre AS riesgo_nombre,
           k.indice AS riesgo_indice,
           k.probabilidad AS riesgo_probabilidad,
           k.severidad AS riesgo_severidad,
           k.prioridad AS riesgo_prioridad,
           k.fecha AS riesgo_fecha,
           ki.nivel AS riesgo_inicial_nivel,
           ki.indice AS riesgo_inicial_indice,
           ki.nivel_nombre AS riesgo_inicial_nombre,
           COALESCE(a.acciones_total, 0) AS acciones_total,
           COALESCE(a.acciones_abiertas, 0) AS acciones_abiertas,
           COALESCE(a.acciones_por_verificar, 0) AS acciones_por_verificar,
           COALESCE(a.acciones_vencidas, 0) AS acciones_vencidas,
           a.proximo_compromiso,
           ci.fecha_resolucion,
           ci.fecha_cierre AS fecha_cierre_registro,
           cm.fecha_compromiso AS compromiso_fecha,
           cm.responsable_nombre AS compromiso_responsable,
           cm.id_departamento_responsable AS compromiso_id_area,
           dc.nombre AS compromiso_area,
           NULLIF(LEAST(COALESCE(cm.fecha_compromiso, DATE('9999-12-31')),
                        COALESCE(ki.fecha_limite, DATE('9999-12-31'))), DATE('9999-12-31')) AS plazo_reporte,
           rz.id_zona,
           z.nombre AS zona_nombre,
           z.codigo AS zona_codigo
    FROM reportes r
    LEFT JOIN ult u   ON u.id_reporte = r.id AND u.rn = 1
    LEFT JOIN rie k   ON k.id_reporte = r.id AND k.rn = 1
    LEFT JOIN rini ki ON ki.id_reporte = r.id AND ki.rn = 1
    LEFT JOIN comp cm ON cm.id_reporte = r.id AND cm.rn = 1
    LEFT JOIN departamentos dc ON dc.id = cm.id_departamento_responsable
    LEFT JOIN acc a   ON a.id_reporte = r.id
    LEFT JOIN cierre ci ON ci.id_reporte = r.id
    LEFT JOIN dep     ON dep.id_reporte = r.id
    LEFT JOIN reporte_zona rz ON rz.id_reporte = r.id
    LEFT JOIN zonas_aeropuerto z ON z.id = rz.id_zona
),
base AS (
    SELECT b0.*,
           CASE WHEN b0.estado IN ('D','E','F') THEN b0.fecha_cierre_registro END AS fecha_cierre,
           CASE WHEN b0.estado IN ('D','E','F') THEN NULL
                ELSE NULLIF(LEAST(COALESCE(b0.proximo_compromiso, DATE('9999-12-31')),
                                  COALESCE(b0.plazo_reporte, DATE('9999-12-31'))), DATE('9999-12-31'))
           END AS fecha_vencimiento,
           CASE WHEN b0.estado IN ('D','E','F') AND b0.plazo_reporte IS NOT NULL AND b0.fecha_cierre_registro IS NOT NULL
                THEN DATE(b0.fecha_cierre_registro) <= b0.plazo_reporte
           END AS cerrado_en_plazo
    FROM base0 b0
)`;

/** Opciones derivadas de la matriz configurada */
function opcionesMatriz(matriz) {
    return {
        diasAviso: matriz.alertas.dias_aviso_vencimiento,
        nivelesAltos: matriz.niveles.filter(n => n.es_alto).map(n => n.clave),
        nivelesOrden: matriz.niveles.map(n => n.clave) // del más alto al más bajo
    };
}

/** Restringe a los reportes del área del usuario (roles sin alcance global). */
function whereAlcance(where, idDepartamento) {
    if (!idDepartamento) return where;
    const cond = 'EXISTS (SELECT 1 FROM reporte_departamento rdu WHERE rdu.id_reporte = b.id AND rdu.id_departamento = ?)';
    return {
        sql: where.sql ? `${where.sql}\n  AND ${cond}` : `WHERE ${cond}`,
        params: [...where.params, idDepartamento]
    };
}

function separar(lista) {
    return lista ? String(lista).split('||').filter(Boolean) : [];
}

function mapearFila(r) {
    const responsables = separar(r.responsables);
    const notificadas = separar(r.notificadas);
    return {
        id: r.id,
        folio: r.folio,
        fecha: r.fecha,
        fecha_actualizacion: r.fecha_actualizacion,
        tipo_problema: r.tipo_problema,
        descripcion: r.descripcion,
        lugar: r.lugar,
        estado: r.estado,
        ultimo_seguimiento: r.ultimo_seguimiento,
        folio_seguimiento: r.folio_seguimiento,
        areas_responsables: responsables,
        areas_notificadas: notificadas,
        riesgo: r.riesgo_nivel ? {
            tipo: r.riesgo_tipo || 'inicial',
            nivel: r.riesgo_nivel,
            nombre: r.riesgo_nombre,
            indice: r.riesgo_indice,
            probabilidad: r.riesgo_probabilidad,
            severidad: r.riesgo_severidad,
            prioridad: r.riesgo_prioridad,
            fecha: r.riesgo_fecha
        } : null,
        riesgo_inicial: r.riesgo_inicial_nivel ? {
            nivel: r.riesgo_inicial_nivel, indice: r.riesgo_inicial_indice, nombre: r.riesgo_inicial_nombre
        } : null,
        acciones: {
            total: Number(r.acciones_total) || 0,
            abiertas: Number(r.acciones_abiertas) || 0,
            por_verificar: Number(r.acciones_por_verificar) || 0,
            vencidas: Number(r.acciones_vencidas) || 0
        },
        compromiso: r.compromiso_fecha ? {
            fecha: r.compromiso_fecha,
            responsable: r.compromiso_responsable,
            id_area: r.compromiso_id_area,
            area: r.compromiso_area
        } : null,
        zona: r.id_zona ? { id: r.id_zona, nombre: r.zona_nombre, codigo: r.zona_codigo } : null,
        tipo_reporte: r.tipo_reporte || null,
        tipo_reporte_nombre: nombreTipo(r.tipo_reporte),
        vuelo: r.vuelo || null,
        matricula: r.matricula || null,
        posicion: r.posicion || null,
        gse: r.gse_tipo || r.gse_numero ? { tipo: r.gse_tipo || null, numero: r.gse_numero || null } : null,
        percepcion: r.percepcion_probabilidad || r.percepcion_severidad
            ? { probabilidad: r.percepcion_probabilidad || null, severidad: r.percepcion_severidad || null }
            : null,
        sugerencia_prevencion: r.sugerencia_prevencion || null,
        fecha_resolucion: r.fecha_resolucion,
        fecha_cierre: r.fecha_cierre,
        plazo_reporte: r.plazo_reporte,
        fecha_vencimiento: r.fecha_vencimiento,
        cerrado_en_plazo: r.cerrado_en_plazo == null ? null : Number(r.cerrado_en_plazo) === 1
    };
}

async function listarReportes(db, { filtros, orden, pagina, matriz, alcanceDepartamento = null }) {
    const op = opcionesMatriz(matriz);
    const where = whereAlcance(construirWhere(filtros, op), alcanceDepartamento);
    const sql = `${BASE_CTE}
SELECT b.*, COUNT(*) OVER () AS total_filtrado
FROM base b
${where.sql}
${construirOrden(orden, op)}
LIMIT ${Number(pagina.porPagina)} OFFSET ${Number(pagina.offset)}`;
    const [filas] = await db.query(sql, where.params);
    let total = filas.length ? Number(filas[0].total_filtrado) : 0;
    if (!filas.length && pagina.offset > 0) {
        const [c] = await db.query(`${BASE_CTE} SELECT COUNT(*) AS n FROM base b ${where.sql}`, where.params);
        total = Number(c[0].n);
    }
    return { reportes: filas.map(mapearFila), total };
}

/**
 * Reportes por tipo con los filtros activos, SIN el filtro de tipo (cada atajo
 * de la vista general dice cuántos reportes mostraría al elegirlo).
 */
async function conteoTipos(db, { filtros, matriz, alcanceDepartamento = null }) {
    const op = opcionesMatriz(matriz);
    const sinTipo = { ...filtros };
    delete sinTipo.tipo;
    const where = whereAlcance(construirWhere(sinTipo, op), alcanceDepartamento);
    const [filas] = await db.query(`${BASE_CTE} SELECT b.tipo_reporte AS tipo, COUNT(*) AS n FROM base b ${where.sql} GROUP BY b.tipo_reporte`, where.params);
    return porTipo(filas).map(({ clave, nombre, grupo, n }) => ({ clave, nombre, grupo, n }));
}

/**
 * Filas { tipo, n, cerrados } → los 6 tipos (aunque estén en cero) y al final
 * "Sin clasificar" (sin tipo o con uno que ya no está en el catálogo).
 */
function porTipo(filas) {
    const lista = TIPOS_REPORTE.map(t => ({ clave: t.clave, nombre: t.nombre, grupo: t.grupo, n: 0, cerrados: 0 }))
        .concat([{ clave: 'sin_clasificar', nombre: 'Sin clasificar', grupo: null, n: 0, cerrados: 0 }]);
    filas.forEach(f => {
        const t = lista.find(x => x.clave === f.tipo) || lista[lista.length - 1];
        t.n += Number(f.n) || 0;
        t.cerrados += Number(f.cerrados) || 0;
    });
    return lista;
}

/** Todas las filas filtradas (para exportar), con un tope de seguridad. */
async function todasLasFilas(db, { filtros, orden, matriz, alcanceDepartamento = null, limite = 5000 }) {
    const op = opcionesMatriz(matriz);
    const where = whereAlcance(construirWhere(filtros, op), alcanceDepartamento);
    const [filas] = await db.query(
        `${BASE_CTE}
SELECT b.* FROM base b
${where.sql}
${construirOrden(orden, op)}
LIMIT ${Number(limite)}`,
        where.params
    );
    return filas.map(mapearFila);
}

async function indicadores(db, { filtros, matriz, alcanceDepartamento = null }) {
    const op = opcionesMatriz(matriz);
    const where = whereAlcance(construirWhere(filtros, op), alcanceDepartamento);
    const altos = op.nivelesAltos.length ? 'b.riesgo_nivel IN (?)' : 'FALSE';
    const params = [...(op.nivelesAltos.length ? [op.nivelesAltos] : []), op.diasAviso, ...where.params];
    const [[filas], [duraciones]] = await Promise.all([
        db.query(
            `${BASE_CTE}
SELECT
    COUNT(*) AS total,
    COALESCE(SUM(b.estado = 'A'), 0) AS nuevos,
    COALESCE(SUM(b.estado IN ('B','C')), 0) AS en_atencion,
    COALESCE(SUM(b.estado NOT IN ('D','E','F')), 0) AS abiertos,
    COALESCE(SUM(b.estado = 'D'), 0) AS resueltos,
    COALESCE(SUM(b.estado = 'E'), 0) AS duplicados,
    COALESCE(SUM(b.estado = 'F'), 0) AS no_requiere,
    COALESCE(SUM(b.estado IN ('E','F')), 0) AS cerrados_sin_accion,
    COALESCE(SUM(b.estado IN ('D','E','F')), 0) AS cerrados,
    COALESCE(SUM(b.riesgo_nivel IS NOT NULL), 0) AS evaluados,
    COALESCE(SUM(b.riesgo_nivel IS NULL AND b.estado NOT IN ('D','E','F')), 0) AS pendientes_evaluar,
    COALESCE(SUM(${altos}), 0) AS alto_riesgo,
    COALESCE(SUM(b.fecha_vencimiento IS NOT NULL), 0) AS con_fecha,
    COALESCE(SUM(b.estado NOT IN ('D','E','F') AND b.fecha_vencimiento IS NULL), 0) AS abiertos_sin_plazo,
    COALESCE(SUM(b.fecha_vencimiento < CURDATE()), 0) AS vencidos,
    COALESCE(SUM(b.fecha_vencimiento >= CURDATE() AND b.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL ? DAY)), 0) AS proximos,
    COALESCE(SUM(b.cerrado_en_plazo IS NOT NULL), 0) AS cerrados_con_plazo,
    COALESCE(SUM(b.cerrado_en_plazo = 1), 0) AS cerrados_en_plazo,
    COALESCE(SUM(b.acciones_vencidas), 0) AS acciones_vencidas,
    COALESCE(SUM(b.acciones_abiertas), 0) AS acciones_abiertas,
    COALESCE(SUM(b.acciones_por_verificar), 0) AS acciones_por_verificar
FROM base b
${where.sql}`,
            params
        ),
        // Duraciones individuales para promedio y mediana (solo Resueltos con registro de resolución)
        db.query(
            `${BASE_CTE}
SELECT GREATEST(TIMESTAMPDIFF(MINUTE, b.fecha, b.fecha_resolucion), 0) AS minutos
FROM base b
${where.sql ? where.sql + "\n  AND b.estado = 'D' AND b.fecha_resolucion IS NOT NULL" : "WHERE b.estado = 'D' AND b.fecha_resolucion IS NOT NULL"}`,
            where.params
        )
    ]);
    const r = filas[0];
    const n = k => Number(r[k]) || 0;
    const total = n('total');
    const minutos = duraciones.map(d => Number(d.minutos)).filter(Number.isFinite);
    const promedio = minutos.length ? minutos.reduce((s, x) => s + x, 0) / minutos.length / 1440 : null;
    const med = minutos.length ? spi.mediana(minutos) / 1440 : null;
    const res = {
        total,
        nuevos: n('nuevos'),
        en_atencion: n('en_atencion'),
        abiertos: n('abiertos'),
        resueltos: n('resueltos'),
        duplicados: n('duplicados'),
        no_requiere: n('no_requiere'),
        cerrados_sin_accion: n('cerrados_sin_accion'),
        cerrados: n('cerrados'),
        porcentaje_cerrados: total ? Math.round((n('cerrados') / total) * 1000) / 10 : null,
        evaluados: n('evaluados'),
        pendientes_evaluar: n('pendientes_evaluar'),
        alto_riesgo: n('alto_riesgo'),
        con_fecha: n('con_fecha'),
        abiertos_sin_plazo: n('abiertos_sin_plazo'),
        vencidos: n('vencidos'),
        proximos: n('proximos'),
        dias_aviso: op.diasAviso,
        cerrados_con_plazo: n('cerrados_con_plazo'),
        cerrados_en_plazo: n('cerrados_en_plazo'),
        porcentaje_en_plazo: n('cerrados_con_plazo') ? Math.round((n('cerrados_en_plazo') / n('cerrados_con_plazo')) * 1000) / 10 : null,
        acciones_abiertas: n('acciones_abiertas'),
        acciones_vencidas: n('acciones_vencidas'),
        acciones_por_verificar: n('acciones_por_verificar'),
        // Tiempo de resolución: se reportan promedio y mediana (la mediana no se
        // distorsiona por casos extremos). Duplicados y "No requiere atención"
        // no cuentan como resueltos.
        dias_promedio_resolucion: promedio == null ? null : Math.round(promedio * 100) / 100,
        dias_mediana_resolucion: med == null ? null : Math.round(med * 100) / 100,
        resueltos_con_fecha: minutos.length,
        resueltos_sin_registro: n('resueltos') - minutos.length
    };
    // Cuadre explícito de las cifras (siempre debe cumplirse por construcción)
    res.coherencia = {
        total_igual_abiertos_mas_cerrados: res.total === res.abiertos + res.cerrados,
        abiertos_igual_nuevos_mas_atencion: res.abiertos === res.nuevos + res.en_atencion,
        cerrados_igual_suma_de_cierres: res.cerrados === res.resueltos + res.duplicados + res.no_requiere
    };
    return res;
}

/**
 * Indicadores del periodo actual y del anterior, para la variación de las
 * tarjetas de la vista general.
 * Se usa la MISMA consulta y los MISMOS filtros que las tarjetas; solo cambia
 * el rango de la fecha del reporte (ver spi.periodoIndicadores). Cada periodo
 * agrupa los reportes con fecha en él y su estatus es el vigente hoy, así que
 * cualquier cifra del periodo anterior se reproduce eligiendo ese periodo.
 * @param {Promise|object|null} principal  indicadores ya calculados con `filtros`
 *        (se reutilizan cuando el periodo actual es exactamente el filtrado)
 */
async function comparacionIndicadores(db, { filtros, matriz, hoy, principal = null, alcanceDepartamento = null, ventanaDias = 30 }) {
    const p = spi.periodoIndicadores(filtros, hoy, { ventanaDias });
    const conRango = r => {
        const f = { ...filtros, desde: r.desde, hasta: r.hasta };
        delete f.fecha;
        return f;
    };
    const reutilizable = principal && (filtros.fecha || (filtros.desde && filtros.hasta));
    const [actual, anterior] = await Promise.all([
        reutilizable ? principal : indicadores(db, { filtros: conRango(p.actual), matriz, alcanceDepartamento }),
        indicadores(db, { filtros: conRango(p.anterior), matriz, alcanceDepartamento })
    ]);
    return { ...p, valores: { actual, anterior } };
}

function mesesEntre(desde, hasta) {
    const out = [];
    if (!desde || !hasta) return out;
    let [y, m] = desde.split('-').map(Number);
    const [y2, m2] = hasta.split('-').map(Number);
    let guard = 0;
    while ((y < y2 || (y === y2 && m <= m2)) && guard++ < 240) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m++; if (m > 12) { m = 1; y++; }
    }
    return out;
}

async function analisis(db, { filtros, matriz, alcanceDepartamento = null }) {
    const op = opcionesMatriz(matriz);
    const where = whereAlcance(construirWhere(filtros, op), alcanceDepartamento);
    const conFiltro = sql => db.query(`${BASE_CTE}, f AS (SELECT b.* FROM base b ${where.sql})\n${sql}`, where.params);

    const [[recibidos], [resueltos], [areas], [estatus], [categorias], [niveles], [celdas], [diario], [cierres], [horas], [tipos]] = await Promise.all([
        conFiltro(`SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, COUNT(*) AS n, SUM(estado IN ('D','E','F')) AS cerrados FROM f GROUP BY mes ORDER BY mes`),
        conFiltro(`SELECT DATE_FORMAT(fecha_resolucion, '%Y-%m') AS mes, COUNT(*) AS n,
                          AVG(GREATEST(TIMESTAMPDIFF(MINUTE, fecha, fecha_resolucion), 0) / 1440) AS dias
                   FROM f WHERE estado = 'D' AND fecha_resolucion IS NOT NULL
                   GROUP BY mes ORDER BY mes`),
        conFiltro(`SELECT d.id, d.nombre, d.activo,
                          COUNT(DISTINCT f.id) AS total,
                          COUNT(DISTINCT CASE WHEN f.estado IN ('D','E','F') THEN f.id END) AS cerrados
                   FROM f
                   JOIN reporte_departamento rd ON rd.id_reporte = f.id
                   JOIN departamentos d ON d.id = rd.id_departamento
                   GROUP BY d.id, d.nombre, d.activo
                   ORDER BY total DESC, d.nombre
                   LIMIT 15`),
        conFiltro(`SELECT estado, COUNT(*) AS n FROM f GROUP BY estado`),
        conFiltro(`SELECT tipo_problema AS categoria, COUNT(*) AS n,
                          SUM(estado IN ('D','E','F')) AS cerrados
                   FROM f GROUP BY tipo_problema ORDER BY n DESC, tipo_problema LIMIT 10`),
        conFiltro(`SELECT riesgo_nivel AS nivel, COUNT(*) AS n FROM f GROUP BY riesgo_nivel`),
        conFiltro(`SELECT riesgo_probabilidad AS p, riesgo_severidad AS s, COUNT(*) AS n
                   FROM f WHERE riesgo_nivel IS NOT NULL GROUP BY riesgo_probabilidad, riesgo_severidad`),
        // Series diarias (ya agregadas en la base: el tamaño depende de los días, no de los reportes)
        conFiltro(`SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS dia, COUNT(*) AS n,
                          SUM(estado = 'A') AS nuevos, SUM(estado IN ('B','C')) AS atencion,
                          SUM(estado = 'D') AS resueltos, SUM(estado IN ('E','F')) AS sin_accion
                   FROM f GROUP BY dia ORDER BY dia`),
        conFiltro(`SELECT DATE_FORMAT(fecha_cierre, '%Y-%m-%d') AS dia, COUNT(*) AS n
                   FROM f WHERE fecha_cierre IS NOT NULL GROUP BY dia ORDER BY dia`),
        conFiltro(`SELECT HOUR(fecha) AS hora, COUNT(*) AS n FROM f GROUP BY hora`),
        conFiltro(`SELECT tipo_reporte AS tipo, COUNT(*) AS n, SUM(estado IN ('D','E','F')) AS cerrados
                   FROM f GROUP BY tipo_reporte`)
    ]);

    const todos = [...recibidos.map(r => r.mes), ...resueltos.map(r => r.mes)].filter(Boolean).sort();
    const meses = mesesEntre(todos[0], todos[todos.length - 1]);
    const porMes = Object.fromEntries(recibidos.map(r => [r.mes, Number(r.n)]));
    const cerradosMes = Object.fromEntries(recibidos.map(r => [r.mes, Number(r.cerrados) || 0]));
    const resMes = Object.fromEntries(resueltos.map(r => [r.mes, { n: Number(r.n), dias: Number(r.dias) }]));

    const conteoNivel = Object.fromEntries(niveles.map(r => [r.nivel || 'sin_evaluar', Number(r.n)]));
    const porHora = Object.fromEntries(horas.map(r => [Number(r.hora), Number(r.n)]));
    const cierresDiarios = cierres.map(r => ({ dia: r.dia, cerrados: Number(r.n) }));
    const cerradosTotal = estatus.filter(x => ['D', 'E', 'F'].includes(x.estado)).reduce((s, x) => s + Number(x.n), 0);

    return {
        // Por día de la fecha del reporte, con su estatus vigente agrupado como en las tarjetas
        diario: diario.map(r => ({
            dia: r.dia,
            recibidos: Number(r.n),
            nuevos: Number(r.nuevos) || 0,
            atencion: Number(r.atencion) || 0,
            resueltos: Number(r.resueltos) || 0,
            sin_accion: Number(r.sin_accion) || 0
        })),
        // Por día en que se registró el cierre vigente (D, E o F) de esos mismos reportes
        cierres_diarios: cierresDiarios,
        // Cerrados sin seguimiento de cierre registrado: no tienen fecha y no entran a las series por fecha de cierre
        cerrados_sin_fecha: cerradosTotal - cierresDiarios.reduce((s, x) => s + x.cerrados, 0),
        // Hora del día (0–23) en que se registró el reporte
        por_hora: Array.from({ length: 24 }, (_, h) => ({ hora: h, n: porHora[h] || 0 })),
        mensual: meses.map(mes => ({
            mes,
            recibidos: porMes[mes] || 0,
            // De los recibidos en ese mes: cuántos ya están cerrados (D, E, F) y cuántos siguen abiertos
            cerrados: cerradosMes[mes] || 0,
            abiertos: (porMes[mes] || 0) - (cerradosMes[mes] || 0),
            resueltos: resMes[mes] ? resMes[mes].n : 0,
            dias_promedio_resolucion: resMes[mes] ? Math.round(resMes[mes].dias * 10) / 10 : null
        })),
        por_area: areas.map(a => ({ id: a.id, nombre: a.nombre, activo: Boolean(a.activo), total: Number(a.total), cerrados: Number(a.cerrados), abiertos: Number(a.total) - Number(a.cerrados) })),
        por_estatus: ['A', 'B', 'C', 'D', 'E', 'F'].map(e => ({ estado: e, n: Number((estatus.find(x => x.estado === e) || {}).n || 0) })),
        categorias: categorias.map(c => ({ categoria: c.categoria, n: Number(c.n), cerrados: Number(c.cerrados) })),
        // Los 6 tipos siempre (aunque estén en cero) y al final los reportes sin clasificar
        por_tipo_reporte: porTipo(tipos),
        riesgo: {
            niveles: matriz.niveles.map(n => ({ clave: n.clave, nombre: n.nombre, color: n.color, n: conteoNivel[n.clave] || 0 })),
            sin_evaluar: conteoNivel.sin_evaluar || 0,
            celdas: celdas.map(c => ({ p: Number(c.p), s: Number(c.s), n: Number(c.n) }))
        }
    };
}

/** Filas ligeras (todas las del filtro) para SPI, comparativos y recurrencias. */
async function filasAnalisis(db, { filtros, matriz, alcanceDepartamento = null, limite = 50000 }) {
    const op = opcionesMatriz(matriz);
    const where = whereAlcance(construirWhere(filtros, op), alcanceDepartamento);
    const [filas] = await db.query(
        `${BASE_CTE}
SELECT b.id, b.folio, b.fecha, b.estado, b.riesgo_nivel, b.fecha_resolucion, b.fecha_cierre, b.plazo_reporte,
       b.cerrado_en_plazo, b.tipo_problema, b.lugar, b.id_zona, b.zona_nombre
FROM base b
${where.sql}
ORDER BY b.fecha
LIMIT ${Number(limite)}`,
        where.params
    );
    return filas;
}

async function accionesDeReportes(db, ids) {
    if (!ids.length) return [];
    const [filas] = await db.query(
        `SELECT id, id_reporte, id_departamento_responsable, estado, efectividad, fecha_compromiso,
                fecha_cumplimiento, fecha_verificacion
         FROM acciones_correctivas WHERE id_reporte IN (?)`, [ids]);
    return filas;
}

/**
 * Desempeño por ÁREA RESPONSABLE (reporte_departamento.es_responsable = 1).
 * Un reporte con dos áreas responsables cuenta en cada una; la fila de
 * totales cuenta cada reporte una sola vez.
 */
async function desempenoAreas(db, { filtros, matriz, alcanceDepartamento = null }) {
    const op = opcionesMatriz(matriz);
    const where = whereAlcance(construirWhere(filtros, op), alcanceDepartamento);
    const metricas = `
        COUNT(*) AS total,
        SUM(f.estado NOT IN ('D','E','F')) AS abiertos,
        SUM(f.estado IN ('D','E','F')) AS cerrados,
        SUM(f.estado = 'D') AS resueltos,
        AVG(CASE WHEN f.estado = 'D' AND f.fecha_resolucion IS NOT NULL
                 THEN GREATEST(TIMESTAMPDIFF(MINUTE, f.fecha, f.fecha_resolucion), 0) / 1440 END) AS dias_resolucion,
        SUM(f.fecha_vencimiento < CURDATE()) AS vencidos,
        SUM(f.estado NOT IN ('D','E','F') AND f.fecha_vencimiento IS NULL) AS sin_plazo,
        SUM(f.cerrado_en_plazo IS NOT NULL) AS cerrados_con_plazo,
        SUM(f.cerrado_en_plazo = 1) AS cerrados_en_plazo,
        SUM(f.riesgo_nivel IS NULL AND f.estado NOT IN ('D','E','F')) AS pendientes_evaluar`;
    const conFiltro = sql => db.query(`${BASE_CTE}, f AS (SELECT b.* FROM base b ${where.sql})\n${sql}`, where.params);
    const [[porArea], [sinArea], [total], [acc]] = await Promise.all([
        conFiltro(`SELECT d.id, d.nombre, d.activo, ${metricas}
                   FROM f
                   JOIN reporte_departamento rd ON rd.id_reporte = f.id AND rd.es_responsable = 1
                   JOIN departamentos d ON d.id = rd.id_departamento
                   GROUP BY d.id, d.nombre, d.activo
                   ORDER BY total DESC, d.nombre`),
        conFiltro(`SELECT ${metricas} FROM f WHERE f.responsables IS NULL`),
        conFiltro(`SELECT ${metricas} FROM f`),
        conFiltro(`SELECT a.id_departamento_responsable AS id,
                          COUNT(*) AS acciones,
                          SUM(a.estado IN ('pendiente','en_proceso')) AS acciones_abiertas,
                          SUM(a.estado IN ('pendiente','en_proceso') AND a.fecha_compromiso < CURDATE()) AS acciones_vencidas,
                          SUM(a.estado IN ('completada','verificada')) AS acciones_concluidas,
                          SUM(a.estado IN ('completada','verificada') AND DATE(a.fecha_cumplimiento) <= a.fecha_compromiso) AS acciones_en_plazo
                   FROM acciones_correctivas a
                   WHERE a.id_reporte IN (SELECT id FROM f)
                   GROUP BY a.id_departamento_responsable`)
    ]);
    const accPor = Object.fromEntries(acc.map(a => [a.id == null ? 'sin' : a.id, a]));
    const fila = (r, extra) => {
        const n = k => Number(r[k]) || 0;
        const a = extra || {};
        const na = k => Number(a[k]) || 0;
        return {
            total: n('total'),
            abiertos: n('abiertos'),
            cerrados: n('cerrados'),
            resueltos: n('resueltos'),
            porcentaje_cierre: n('total') ? Math.round((n('cerrados') / n('total')) * 1000) / 10 : null,
            dias_resolucion: r.dias_resolucion == null ? null : Math.round(Number(r.dias_resolucion) * 100) / 100,
            vencidos: n('vencidos'),
            sin_plazo: n('sin_plazo'),
            cerrados_con_plazo: n('cerrados_con_plazo'),
            porcentaje_en_plazo: n('cerrados_con_plazo') ? Math.round((n('cerrados_en_plazo') / n('cerrados_con_plazo')) * 1000) / 10 : null,
            pendientes_evaluar: n('pendientes_evaluar'),
            acciones: na('acciones'),
            acciones_abiertas: na('acciones_abiertas'),
            acciones_vencidas: na('acciones_vencidas'),
            acciones_concluidas: na('acciones_concluidas'),
            porcentaje_acciones_en_plazo: na('acciones_concluidas') ? Math.round((na('acciones_en_plazo') / na('acciones_concluidas')) * 1000) / 10 : null
        };
    };
    const totalAcc = acc.reduce((o, a) => {
        for (const k of ['acciones', 'acciones_abiertas', 'acciones_vencidas', 'acciones_concluidas', 'acciones_en_plazo']) o[k] = (o[k] || 0) + (Number(a[k]) || 0);
        return o;
    }, {});
    return {
        areas: porArea.map(a => ({ id: a.id, nombre: a.nombre, activo: Boolean(a.activo), ...fila(a, accPor[a.id]) })),
        sin_area: fila(sinArea[0] || {}, accPor.sin),
        total: fila(total[0] || {}, totalAcc)
    };
}

/**
 * Revisión de consistencia de los datos. Solo informa: NO corrige registros.
 */
async function calidadDatos(db) {
    const q = sql => db.query(`${BASE_CTE}\n${sql}`);
    const [[estado], [sinResp], [resSinReg], [cerradosAbiertas], [segPrevios], [sinPlazo]] = await Promise.all([
        q(`SELECT b.folio, b.estado_registro, b.estado FROM base b WHERE b.estado_registro <> b.estado ORDER BY b.id`),
        q(`SELECT b.folio, b.estado FROM base b WHERE b.responsables IS NULL ORDER BY b.id`),
        q(`SELECT b.folio FROM base b WHERE b.estado = 'D' AND b.fecha_resolucion IS NULL ORDER BY b.id`),
        q(`SELECT b.folio, b.estado, b.acciones_abiertas FROM base b WHERE b.estado IN ('D','E','F') AND b.acciones_abiertas > 0 ORDER BY b.id`),
        db.query(`SELECT r.folio, s.folio_seguimiento FROM seguimiento s JOIN reportes r ON r.id = s.id_reporte WHERE s.fecha < r.fecha ORDER BY s.id LIMIT 200`),
        q(`SELECT b.folio FROM base b WHERE b.estado NOT IN ('D','E','F') AND b.fecha_vencimiento IS NULL ORDER BY b.id`)
    ]);
    const bloque = (clave, titulo, explicacion, filas, gravedad) => ({ clave, titulo, explicacion, gravedad, n: filas.length, ejemplos: filas.slice(0, 50) });
    return [
        bloque('estatus_distinto', 'Estatus del registro distinto al del último seguimiento',
            'El campo "estado" de la tabla de reportes no coincide con el último seguimiento. El sistema usa el último seguimiento como estatus vigente; conviene revisar el caso y registrar el seguimiento correcto.', estado, 'revisar'),
        bloque('resuelto_sin_registro', 'Resueltos sin registro de resolución',
            'Tienen estatus Resuelto pero ningún seguimiento de resolución posterior a su última reapertura; no entran al cálculo del tiempo de resolución.', resSinReg, 'revisar'),
        bloque('cerrado_con_acciones', 'Cerrados con acciones correctivas abiertas',
            'El reporte está cerrado pero conserva acciones pendientes o en proceso.', cerradosAbiertas, 'revisar'),
        bloque('seguimiento_previo', 'Seguimientos con fecha anterior al reporte',
            'La fecha del seguimiento es anterior a la del reporte.', segPrevios, 'revisar'),
        bloque('sin_responsable', 'Reportes sin área responsable',
            'Tienen áreas notificadas, pero ninguna marcada como responsable. No aparecen en el desempeño por área responsable.', sinResp, 'info'),
        bloque('abierto_sin_plazo', 'Reportes abiertos sin plazo',
            'No tienen fecha compromiso, plazo por nivel de riesgo ni acciones con fecha compromiso; el semáforo de plazos no puede evaluarlos.', sinPlazo, 'info')
    ];
}

module.exports = {
    BASE_CTE,
    opcionesMatriz,
    whereAlcance,
    mapearFila,
    listarReportes,
    conteoTipos,
    todasLasFilas,
    indicadores,
    comparacionIndicadores,
    analisis,
    filasAnalisis,
    accionesDeReportes,
    desempenoAreas,
    calidadDatos,
    mesesEntre
};
