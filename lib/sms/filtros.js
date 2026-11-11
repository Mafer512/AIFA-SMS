/* ============================================================================
   Filtros de reportes: lectura y validación de parámetros + SQL parametrizado.
   Los mismos filtros alimentan la tabla, los indicadores, las gráficas y las
   exportaciones, para que todas las cifras coincidan.
   ========================================================================= */
'use strict';

const mysql = require('mysql2');
const { CLAVES_TIPO, nombreTipo } = require('./clasificacion');

const ESTADOS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ESTADOS_CERRADOS = ['D', 'E', 'F'];
const VENCIMIENTOS = ['vencidos', 'proximos', 'en_tiempo', 'con_fecha', 'sin_fecha', 'cerrado_en_plazo', 'cerrado_fuera'];
const POR_PAGINA = [10, 25, 50, 100];

// Columnas por las que se puede ordenar (clave pública => expresión SQL)
const ORDENABLES = {
    folio: 'CAST(SUBSTRING_INDEX(b.folio, \'-\', -1) AS UNSIGNED)',
    fecha: 'b.fecha',
    actualizacion: 'b.fecha_actualizacion',
    area: 'b.area_orden',
    categoria: 'b.tipo_problema',
    estado: 'b.estado',
    vencimiento: 'b.fecha_vencimiento',
    prioridad: null // se arma con la matriz configurada
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(v) {
    if (!FECHA_RE.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function entero(v, min, max) {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function escaparLike(t) {
    return t.replace(/[\\%_]/g, c => '\\' + c);
}

/**
 * Lee los filtros de un objeto de consulta (req.query).
 * Ignora valores inválidos y devuelve solo los filtros aplicables.
 */
function leerFiltros(q = {}, { nivelesRiesgo = [] } = {}) {
    const f = {};
    const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

    const folio = txt(q.folio, 50).toUpperCase();
    if (folio && /^[A-Z0-9-]+$/.test(folio)) f.folio = folio;

    const palabras = txt(q.q, 120);
    if (palabras) f.q = palabras;

    const fecha = txt(q.fecha, 10);
    if (fecha && fechaValida(fecha)) f.fecha = fecha;

    const desde = txt(q.desde, 10);
    const hasta = txt(q.hasta, 10);
    if (desde && fechaValida(desde)) f.desde = desde;
    if (hasta && fechaValida(hasta)) f.hasta = hasta;
    if (f.desde && f.hasta && f.desde > f.hasta) [f.desde, f.hasta] = [f.hasta, f.desde];

    const area = entero(q.area, 1, 1e9);
    if (area) f.area = area;

    const responsable = entero(q.responsable, 1, 1e9);
    if (responsable) f.responsable = responsable;

    const zona = entero(q.zona, 1, 1e9);
    if (zona) f.zona = zona;

    const categoria = txt(q.categoria, 150);
    if (categoria) f.categoria = categoria;

    const tipo = txt(q.tipo, 30);
    if (CLAVES_TIPO.includes(tipo) || tipo === 'sin_clasificar') f.tipo = tipo;

    const estado = txt(q.estado, 10);
    if (ESTADOS.includes(estado) || ['abiertos', 'cerrados', 'atencion', 'sin_accion'].includes(estado)) f.estado = estado;

    const riesgo = txt(q.riesgo, 40);
    if (['sin_evaluar', 'pendiente_evaluar', 'altos'].includes(riesgo) || nivelesRiesgo.includes(riesgo)) f.riesgo = riesgo;

    const venc = txt(q.vencimiento, 20);
    if (VENCIMIENTOS.includes(venc)) f.vencimiento = venc;

    return f;
}

function leerOrden(q = {}) {
    const campo = Object.prototype.hasOwnProperty.call(ORDENABLES, q.orden) ? q.orden : 'fecha';
    const dir = q.dir === 'asc' ? 'asc' : 'desc';
    return { campo, dir };
}

function leerPagina(q = {}) {
    const porPagina = POR_PAGINA.includes(Number(q.por_pagina)) ? Number(q.por_pagina) : 25;
    const pagina = entero(q.pagina, 1, 100000) || 1;
    return { pagina, porPagina, offset: (pagina - 1) * porPagina };
}

/**
 * Construye la cláusula WHERE (sobre el alias b de la consulta base).
 * @returns {{ sql: string, params: any[] }}
 */
function construirWhere(f, { diasAviso = 7, nivelesAltos = [] } = {}) {
    const w = [];
    const p = [];

    if (f.folio) { w.push('b.folio LIKE ?'); p.push('%' + escaparLike(f.folio) + '%'); }

    if (f.q) {
        const palabras = f.q.split(/\s+/).filter(Boolean).slice(0, 8);
        for (const palabra of palabras) {
            const like = '%' + escaparLike(palabra) + '%';
            w.push(`(b.descripcion LIKE ? OR b.lugar LIKE ? OR b.tipo_problema LIKE ? OR b.folio LIKE ?
                     OR EXISTS (SELECT 1 FROM seguimiento sx WHERE sx.id_reporte = b.id AND sx.descripcion LIKE ?))`);
            p.push(like, like, like, like, like);
        }
    }

    if (f.fecha) { w.push('b.fecha >= ? AND b.fecha < DATE_ADD(?, INTERVAL 1 DAY)'); p.push(f.fecha, f.fecha); }
    if (f.desde) { w.push('b.fecha >= ?'); p.push(f.desde); }
    if (f.hasta) { w.push('b.fecha < DATE_ADD(?, INTERVAL 1 DAY)'); p.push(f.hasta); }

    if (f.area) {
        w.push('EXISTS (SELECT 1 FROM reporte_departamento rdx WHERE rdx.id_reporte = b.id AND rdx.id_departamento = ?)');
        p.push(f.area);
    }
    if (f.responsable) {
        w.push(`(EXISTS (SELECT 1 FROM reporte_departamento rdr WHERE rdr.id_reporte = b.id AND rdr.id_departamento = ? AND rdr.es_responsable = 1)
                 OR b.compromiso_id_area = ?
                 OR EXISTS (SELECT 1 FROM acciones_correctivas acr WHERE acr.id_reporte = b.id AND acr.id_departamento_responsable = ?))`);
        p.push(f.responsable, f.responsable, f.responsable);
    }

    if (f.zona) { w.push('b.id_zona = ?'); p.push(f.zona); }

    if (f.categoria) { w.push('b.tipo_problema = ?'); p.push(f.categoria); }

    if (f.tipo === 'sin_clasificar') w.push('b.tipo_reporte IS NULL');
    else if (f.tipo) { w.push('b.tipo_reporte = ?'); p.push(f.tipo); }

    if (f.estado === 'abiertos') w.push(`b.estado NOT IN ('D','E','F')`);
    else if (f.estado === 'cerrados') w.push(`b.estado IN ('D','E','F')`);
    else if (f.estado === 'atencion') w.push(`b.estado IN ('B','C')`);
    else if (f.estado === 'sin_accion') w.push(`b.estado IN ('E','F')`);
    else if (f.estado) { w.push('b.estado = ?'); p.push(f.estado); }

    if (f.riesgo === 'sin_evaluar') w.push('b.riesgo_nivel IS NULL');
    else if (f.riesgo === 'pendiente_evaluar') w.push(`b.riesgo_nivel IS NULL AND b.estado NOT IN ('D','E','F')`);
    else if (f.riesgo === 'altos') {
        if (nivelesAltos.length) { w.push('b.riesgo_nivel IN (?)'); p.push(nivelesAltos); }
        else w.push('FALSE');
    } else if (f.riesgo) { w.push('b.riesgo_nivel = ?'); p.push(f.riesgo); }

    if (f.vencimiento === 'vencidos') w.push('b.fecha_vencimiento < CURDATE()');
    else if (f.vencimiento === 'proximos') {
        w.push('b.fecha_vencimiento >= CURDATE() AND b.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL ? DAY)');
        p.push(diasAviso);
    } else if (f.vencimiento === 'en_tiempo') {
        w.push('b.fecha_vencimiento > DATE_ADD(CURDATE(), INTERVAL ? DAY)');
        p.push(diasAviso);
    } else if (f.vencimiento === 'con_fecha') w.push('b.fecha_vencimiento IS NOT NULL');
    else if (f.vencimiento === 'sin_fecha') w.push(`b.fecha_vencimiento IS NULL AND b.estado NOT IN ('D','E','F')`);
    else if (f.vencimiento === 'cerrado_en_plazo') w.push('b.cerrado_en_plazo = 1');
    else if (f.vencimiento === 'cerrado_fuera') w.push('b.cerrado_en_plazo = 0');

    return { sql: w.length ? 'WHERE ' + w.join('\n  AND ') : '', params: p };
}

/** ORDER BY seguro: solo columnas permitidas; prioridad según la matriz. */
function construirOrden({ campo, dir }, { nivelesOrden = [] } = {}) {
    const d = dir === 'asc' ? 'ASC' : 'DESC';
    if (campo === 'prioridad') {
        // Mayor prioridad primero (en desc); los no evaluados siempre al final
        const field = nivelesOrden.length
            ? `FIELD(b.riesgo_nivel, ${nivelesOrden.map(n => mysql.escape(n)).join(', ')})`
            : '0';
        const inv = d === 'DESC' ? 'ASC' : 'DESC';
        return `ORDER BY (b.riesgo_nivel IS NULL) ASC, ${field} ${inv}, b.fecha DESC, b.id DESC`;
    }
    if (campo === 'vencimiento') {
        return `ORDER BY (b.fecha_vencimiento IS NULL) ASC, b.fecha_vencimiento ${d}, b.fecha DESC, b.id DESC`;
    }
    if (campo === 'area') {
        return `ORDER BY (b.area_orden IS NULL) ASC, b.area_orden ${d}, b.fecha DESC, b.id DESC`;
    }
    const expr = ORDENABLES[campo] || 'b.fecha';
    return `ORDER BY ${expr} ${d}, b.id ${d}`;
}

/** Filtros como lista legible (para chips de "filtros activos" y reportes). */
function describirFiltros(f, catalogos = {}) {
    const nombreDepto = id => (catalogos.departamentos || {})[id] || `Área ${id}`;
    const estados = { A: 'Generado', B: 'Enterado', C: 'En atención', D: 'Resuelto', E: 'Duplicado', F: 'No requiere atención', abiertos: 'Abiertos', cerrados: 'Cerrados', atencion: 'Enterado o En atención', sin_accion: 'Duplicado o No requiere atención' };
    const venc = { vencidos: 'Vencidos', proximos: 'Próximos a vencer', en_tiempo: 'En tiempo', con_fecha: 'Con plazo', sin_fecha: 'Abiertos sin plazo', cerrado_en_plazo: 'Cerrados en plazo', cerrado_fuera: 'Cerrados fuera de plazo' };
    const out = [];
    if (f.folio) out.push({ clave: 'folio', etiqueta: 'Folio', valor: f.folio });
    if (f.q) out.push({ clave: 'q', etiqueta: 'Palabras', valor: f.q });
    if (f.fecha) out.push({ clave: 'fecha', etiqueta: 'Fecha', valor: f.fecha });
    if (f.desde || f.hasta) out.push({ clave: 'rango', etiqueta: 'Periodo', valor: `${f.desde || '…'} a ${f.hasta || '…'}` });
    if (f.area) out.push({ clave: 'area', etiqueta: 'Área', valor: nombreDepto(f.area) });
    if (f.responsable) out.push({ clave: 'responsable', etiqueta: 'Responsable', valor: nombreDepto(f.responsable) });
    if (f.zona) out.push({ clave: 'zona', etiqueta: 'Zona', valor: (catalogos.zonas || {})[f.zona] || `Zona ${f.zona}` });
    if (f.categoria) out.push({ clave: 'categoria', etiqueta: 'Categoría', valor: f.categoria });
    if (f.tipo) out.push({ clave: 'tipo', etiqueta: 'Tipo de reporte', valor: f.tipo === 'sin_clasificar' ? 'Sin clasificar' : (nombreTipo(f.tipo) || f.tipo) });
    if (f.estado) out.push({ clave: 'estado', etiqueta: 'Estatus', valor: estados[f.estado] || f.estado });
    if (f.riesgo) out.push({ clave: 'riesgo', etiqueta: 'Riesgo', valor: f.riesgo === 'sin_evaluar' ? 'Sin evaluar' : f.riesgo === 'pendiente_evaluar' ? 'Pendientes de evaluar (abiertos)' : f.riesgo === 'altos' ? 'Alto riesgo' : ((catalogos.niveles || {})[f.riesgo] || f.riesgo) });
    if (f.vencimiento) out.push({ clave: 'vencimiento', etiqueta: 'Plazo', valor: venc[f.vencimiento] });
    return out;
}

module.exports = {
    ESTADOS,
    ESTADOS_CERRADOS,
    POR_PAGINA,
    ORDENABLES,
    leerFiltros,
    leerOrden,
    leerPagina,
    construirWhere,
    construirOrden,
    describirFiltros,
    escaparLike
};
