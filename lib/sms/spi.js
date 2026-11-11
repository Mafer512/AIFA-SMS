/* ============================================================================
   Indicadores de desempeño de seguridad operacional (SPI) y métricas por
   periodo.
   ----------------------------------------------------------------------------
   - Las métricas se calculan SOLO a partir de los registros reales.
   - Los SPI (nombre, métrica, meta y nivel de alerta) los define un
     administrador. No hay metas precargadas: sin configuración, el sistema
     muestra los valores y "Meta no configurada".
   - Funciones puras (sin BD), para poder probarlas de forma aislada.
   ========================================================================= */
'use strict';

const CLAVE_CONFIG = 'sms_spi';
const CERRADOS = ['D', 'E', 'F'];

const METRICAS = {
    recibidos: {
        nombre: 'Reportes recibidos', unidad: 'reportes', formato: 'entero', direccion: 'mayor',
        descripcion: 'Reportes recibidos en el mes.'
    },
    alto_riesgo: {
        nombre: 'Reportes de alto riesgo', unidad: 'reportes', formato: 'entero', direccion: 'menor',
        descripcion: 'Reportes recibidos en el mes cuyo riesgo vigente es de un nivel marcado como alto en la matriz.'
    },
    porcentaje_cerrados: {
        nombre: 'Reportes cerrados', unidad: '%', formato: 'porcentaje', direccion: 'mayor',
        descripcion: 'De los reportes recibidos en el mes, porcentaje que ya está cerrado (Resuelto, Duplicado o No requiere atención).'
    },
    porcentaje_en_plazo: {
        nombre: 'Reportes cerrados en plazo', unidad: '%', formato: 'porcentaje', direccion: 'mayor',
        descripcion: 'De los reportes cerrados en el mes que tenían fecha compromiso o plazo por riesgo, porcentaje cerrado a tiempo.'
    },
    dias_resolucion: {
        nombre: 'Tiempo promedio de resolución', unidad: 'días', formato: 'decimal', direccion: 'menor',
        descripcion: 'Promedio de días entre la fecha del reporte y su registro como Resuelto, de los resueltos en el mes.'
    },
    acciones_en_plazo: {
        nombre: 'Acciones concluidas en plazo', unidad: '%', formato: 'porcentaje', direccion: 'mayor',
        descripcion: 'De las acciones correctivas concluidas en el mes, porcentaje concluido a más tardar en su fecha compromiso.'
    },
    acciones_efectivas: {
        nombre: 'Acciones verificadas como efectivas', unidad: '%', formato: 'porcentaje', direccion: 'mayor',
        descripcion: 'De las verificaciones de efectividad registradas en el mes, porcentaje que resultó efectiva.'
    }
};

const CONFIG_INICIAL = Object.freeze({
    indicadores: [],
    umbral_recurrencia: 3,
    ventana_recurrencia_dias: 90,
    validado: false,
    nota: ''
});

const CLAVE_RE = /^[a-z0-9_]{1,40}$/;

// ------------------------------------------------------------------ fechas
function aFecha(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(String(v).length === 10 ? v + 'T00:00:00' : v);
    return Number.isNaN(d.getTime()) ? null : d;
}
function mesDe(v) {
    const d = aFecha(v);
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;
}
function diaDe(v) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = aFecha(v);
    return d ? `${mesDe(d)}-${String(d.getDate()).padStart(2, '0')}` : null;
}
function enRango(v, desde, hasta) {
    const d = diaDe(v);
    return Boolean(d) && (!desde || d >= desde) && (!hasta || d <= hasta);
}
function mediana(lista) {
    if (!lista.length) return null;
    const o = [...lista].sort((a, b) => a - b);
    const m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}
function redondear(v, dec = 1) {
    if (v == null || !Number.isFinite(v)) return null;
    const f = 10 ** dec;
    return Math.round(v * f) / f;
}
function minutosResolucion(f) {
    const a = aFecha(f.fecha), b = aFecha(f.fecha_resolucion);
    return a && b ? Math.max(0, (b - a) / 60000) : null;
}

// --------------------------------------------------------- métricas por mes
/**
 * Valor de una métrica en un mes.
 * ctx: { filas, acciones, nivelesAltos, categoria }
 * @returns {{ valor: number|null, numerador: number, denominador: number|null }}
 */
function valorMensual(metrica, mes, ctx) {
    const cat = ctx.categoria ? f => f.tipo_problema === ctx.categoria : () => true;
    const filas = ctx.filas.filter(cat);
    const pct = (num, den) => ({ valor: den ? redondear((num / den) * 100) : null, numerador: num, denominador: den });

    switch (metrica) {
        case 'recibidos': {
            const n = filas.filter(f => mesDe(f.fecha) === mes).length;
            return { valor: n, numerador: n, denominador: null };
        }
        case 'alto_riesgo': {
            const altos = new Set(ctx.nivelesAltos || []);
            const n = filas.filter(f => mesDe(f.fecha) === mes && altos.has(f.riesgo_nivel)).length;
            return { valor: n, numerador: n, denominador: null };
        }
        case 'porcentaje_cerrados': {
            const rec = filas.filter(f => mesDe(f.fecha) === mes);
            return pct(rec.filter(f => CERRADOS.includes(f.estado)).length, rec.length);
        }
        case 'porcentaje_en_plazo': {
            const c = filas.filter(f => CERRADOS.includes(f.estado) && mesDe(f.fecha_cierre) === mes && f.cerrado_en_plazo != null);
            return pct(c.filter(f => Number(f.cerrado_en_plazo) === 1).length, c.length);
        }
        case 'dias_resolucion': {
            const m = filas.filter(f => f.estado === 'D' && mesDe(f.fecha_resolucion) === mes).map(minutosResolucion).filter(x => x != null);
            return { valor: m.length ? redondear(m.reduce((s, x) => s + x, 0) / m.length / 1440) : null, numerador: m.length, denominador: m.length };
        }
        case 'acciones_en_plazo': {
            const ids = ctx.categoria ? new Set(filas.map(f => f.id)) : null;
            const a = (ctx.acciones || []).filter(x => (!ids || ids.has(x.id_reporte)) &&
                ['completada', 'verificada'].includes(x.estado) && mesDe(x.fecha_cumplimiento) === mes);
            return pct(a.filter(x => diaDe(x.fecha_cumplimiento) <= diaDe(x.fecha_compromiso)).length, a.length);
        }
        case 'acciones_efectivas': {
            const ids = ctx.categoria ? new Set(filas.map(f => f.id)) : null;
            const a = (ctx.acciones || []).filter(x => (!ids || ids.has(x.id_reporte)) &&
                ['efectiva', 'no_efectiva'].includes(x.efectividad) && mesDe(x.fecha_verificacion) === mes);
            return pct(a.filter(x => x.efectividad === 'efectiva').length, a.length);
        }
        default:
            throw new Error(`Métrica desconocida: ${metrica}`);
    }
}

/** Estado de un SPI frente a su meta y nivel de alerta. */
function estadoSPI(spi, valor) {
    if (valor == null) return { estado: 'sin_datos', etiqueta: 'Sin datos en el periodo' };
    if (spi.meta == null) return { estado: 'sin_meta', etiqueta: 'Meta no configurada' };
    const menor = spi.direccion === 'menor';
    const cumple = menor ? valor <= spi.meta : valor >= spi.meta;
    if (cumple) return { estado: 'meta', etiqueta: 'Dentro de la meta' };
    if (spi.alerta == null) return { estado: 'alerta', etiqueta: 'Fuera de la meta' };
    const enAlerta = menor ? valor >= spi.alerta : valor <= spi.alerta;
    return enAlerta ? { estado: 'alerta', etiqueta: 'Nivel de alerta' } : { estado: 'vigilancia', etiqueta: 'En vigilancia' };
}

/** Series mensuales y estado vigente de cada SPI activo. */
function calcularSPI(config, { filas, acciones, meses, nivelesAltos }) {
    return (config.indicadores || []).filter(s => s.activo).map(s => {
        const ctx = { filas, acciones, nivelesAltos, categoria: s.categoria || null };
        const serie = meses.map(mes => ({ mes, ...valorMensual(s.metrica, mes, ctx) }));
        const ultimo = serie.length ? serie[serie.length - 1] : null;
        return {
            ...s,
            metrica_nombre: METRICAS[s.metrica].nombre,
            unidad: METRICAS[s.metrica].unidad,
            formato: METRICAS[s.metrica].formato,
            definicion: METRICAS[s.metrica].descripcion,
            serie,
            actual: ultimo,
            ...estadoSPI(s, ultimo ? ultimo.valor : null)
        };
    });
}

// ------------------------------------------------------ métricas por periodo
/** Resumen de un periodo [desde, hasta] (YYYY-MM-DD, inclusivo). */
function resumenPeriodo(filas, acciones, desde, hasta, { nivelesAltos = [] } = {}) {
    const altos = new Set(nivelesAltos);
    const rec = filas.filter(f => enRango(f.fecha, desde, hasta));
    const cerrados = rec.filter(f => CERRADOS.includes(f.estado));
    const resueltos = filas.filter(f => f.estado === 'D' && enRango(f.fecha_resolucion, desde, hasta));
    const minutos = resueltos.map(minutosResolucion).filter(x => x != null);
    const cierresConPlazo = filas.filter(f => CERRADOS.includes(f.estado) && enRango(f.fecha_cierre, desde, hasta) && f.cerrado_en_plazo != null);
    const concluidas = (acciones || []).filter(a => ['completada', 'verificada'].includes(a.estado) && enRango(a.fecha_cumplimiento, desde, hasta));
    const pct = (a, b) => (b ? redondear((a / b) * 100) : null);
    return {
        desde, hasta,
        recibidos: rec.length,
        cerrados: cerrados.length,
        porcentaje_cerrados: pct(cerrados.length, rec.length),
        resueltos: resueltos.length,
        duplicados: rec.filter(f => f.estado === 'E').length,
        no_requiere: rec.filter(f => f.estado === 'F').length,
        dias_promedio_resolucion: minutos.length ? redondear(minutos.reduce((s, x) => s + x, 0) / minutos.length / 1440, 2) : null,
        dias_mediana_resolucion: minutos.length ? redondear(mediana(minutos) / 1440, 2) : null,
        evaluados: rec.filter(f => f.riesgo_nivel).length,
        alto_riesgo: rec.filter(f => altos.has(f.riesgo_nivel)).length,
        cerrados_con_plazo: cierresConPlazo.length,
        porcentaje_en_plazo: pct(cierresConPlazo.filter(f => Number(f.cerrado_en_plazo) === 1).length, cierresConPlazo.length),
        acciones_concluidas: concluidas.length
    };
}

/** Periodo de comparación: el inmediato anterior de igual duración o el mismo del año anterior. */
function periodoComparacion(desde, hasta, modo = 'anterior') {
    const d = new Date(desde + 'T00:00:00Z');
    const h = new Date(hasta + 'T00:00:00Z');
    const iso = x => x.toISOString().slice(0, 10);
    if (modo === 'anio') {
        const a = new Date(d); a.setUTCFullYear(a.getUTCFullYear() - 1);
        const b = new Date(h); b.setUTCFullYear(b.getUTCFullYear() - 1);
        return { desde: iso(a), hasta: iso(b) };
    }
    const dias = Math.round((h - d) / 86400000) + 1;
    const b = new Date(d); b.setUTCDate(b.getUTCDate() - 1);
    const a = new Date(b); a.setUTCDate(a.getUTCDate() - (dias - 1));
    return { desde: iso(a), hasta: iso(b) };
}

/**
 * Periodos para la variación de las tarjetas de indicadores de la vista general.
 * - Fecha específica o rango completo: ese periodo frente al inmediato anterior
 *   de igual duración.
 * - Solo "desde": del "desde" a hoy, frente al anterior de igual duración.
 * - Sin fecha inicial (sin fechas o solo "hasta"): ventana automática de los
 *   últimos `ventanaDias` días (hasta hoy o hasta el "hasta") frente a los
 *   `ventanaDias` días previos.
 * @param {object} filtros  filtros ya validados (leerFiltros)
 * @param {string} hoy      'YYYY-MM-DD'
 * @returns {{ automatico: boolean, dias: number, actual: {desde, hasta}, anterior: {desde, hasta} }}
 */
function periodoIndicadores(filtros = {}, hoy, { ventanaDias = 30 } = {}) {
    let desde = filtros.fecha || filtros.desde || null;
    let hasta = filtros.fecha || filtros.hasta || null;
    let automatico = false;
    if (!desde) {
        automatico = true;
        hasta = hasta || hoy;
        const ini = new Date(hasta + 'T00:00:00Z');
        ini.setUTCDate(ini.getUTCDate() - (ventanaDias - 1));
        desde = ini.toISOString().slice(0, 10);
    } else if (!hasta) {
        hasta = hoy > desde ? hoy : desde;
    }
    const dias = Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / 86400000) + 1;
    return { automatico, dias, actual: { desde, hasta }, anterior: periodoComparacion(desde, hasta, 'anterior') };
}

// --------------------------------------------------------------- recurrencia
/**
 * Categorías con reportes recurrentes.
 * Recurrente = al menos `umbral` reportes dentro de la ventana de días que
 * termina en la fecha `hasta` (o en el reporte más reciente).
 */
function categoriasRecurrentes(filas, { umbral = 3, ventanaDias = 90, hasta = null } = {}) {
    const fin = hasta || filas.reduce((m, f) => { const d = diaDe(f.fecha); return d > m ? d : m; }, '');
    if (!fin) return [];
    const ini = new Date(fin + 'T00:00:00Z');
    ini.setUTCDate(ini.getUTCDate() - (ventanaDias - 1));
    const desde = ini.toISOString().slice(0, 10);
    const grupos = new Map();
    for (const f of filas) {
        const k = f.tipo_problema || 'Sin categoría';
        if (!grupos.has(k)) grupos.set(k, { categoria: k, n: 0, en_ventana: 0, abiertos: 0, ultima: null });
        const g = grupos.get(k);
        g.n++;
        if (enRango(f.fecha, desde, fin)) g.en_ventana++;
        if (!CERRADOS.includes(f.estado)) g.abiertos++;
        const d = diaDe(f.fecha);
        if (!g.ultima || d > g.ultima) g.ultima = d;
    }
    return [...grupos.values()]
        .map(g => ({ ...g, recurrente: g.en_ventana >= umbral }))
        .sort((a, b) => b.en_ventana - a.en_ventana || b.n - a.n || a.categoria.localeCompare(b.categoria, 'es'));
}

// ------------------------------------------------------------- configuración
function numeroONulo(v, campo, { max = 1e6 } = {}) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`El valor de "${campo}" no es válido`);
    return n;
}

function validarConfig(entrada, { categorias = null } = {}) {
    if (!entrada || typeof entrada !== 'object') throw new Error('Configuración de SPI inválida');
    const lista = Array.isArray(entrada.indicadores) ? entrada.indicadores : [];
    if (lista.length > 20) throw new Error('Se admiten hasta 20 indicadores');
    const claves = new Set();
    const indicadores = lista.map((s, i) => {
        const metrica = String(s.metrica || '');
        const def = METRICAS[metrica];
        if (!def) throw new Error(`Indicador ${i + 1}: elige una métrica válida`);
        const nombre = String(s.nombre || '').trim();
        if (!nombre) throw new Error(`Indicador ${i + 1}: el nombre es obligatorio`);
        if (nombre.length > 120) throw new Error(`Indicador ${i + 1}: el nombre admite máximo 120 caracteres`);
        let clave = String(s.clave || '').trim();
        if (!CLAVE_RE.test(clave)) clave = `spi_${i + 1}`;
        while (claves.has(clave)) clave += '_b';
        claves.add(clave);
        const direccion = s.direccion === 'menor' ? 'menor' : s.direccion === 'mayor' ? 'mayor' : def.direccion;
        const maxValor = def.formato === 'porcentaje' ? 100 : 1e6;
        const meta = numeroONulo(s.meta, `meta del indicador ${i + 1}`, { max: maxValor });
        const alerta = numeroONulo(s.alerta, `alerta del indicador ${i + 1}`, { max: maxValor });
        if (alerta != null && meta == null) throw new Error(`Indicador ${i + 1}: define la meta antes del nivel de alerta`);
        if (alerta != null && direccion === 'menor' && alerta < meta) throw new Error(`Indicador ${i + 1}: si "menor es mejor", el nivel de alerta debe ser mayor o igual que la meta`);
        if (alerta != null && direccion === 'mayor' && alerta > meta) throw new Error(`Indicador ${i + 1}: si "mayor es mejor", el nivel de alerta debe ser menor o igual que la meta`);
        const categoria = String(s.categoria || '').trim().slice(0, 150) || null;
        if (categoria && Array.isArray(categorias) && !categorias.includes(categoria)) {
            throw new Error(`Indicador ${i + 1}: la categoría "${categoria}" no existe en el catálogo`);
        }
        return {
            clave, nombre, metrica, categoria, direccion, meta, alerta,
            activo: s.activo === undefined ? true : Boolean(s.activo),
            descripcion: String(s.descripcion || '').trim().slice(0, 300)
        };
    });
    const umbral = Number(entrada.umbral_recurrencia == null ? CONFIG_INICIAL.umbral_recurrencia : entrada.umbral_recurrencia);
    if (!Number.isInteger(umbral) || umbral < 2 || umbral > 100) throw new Error('El umbral de recurrencia debe ser un entero entre 2 y 100');
    const ventana = Number(entrada.ventana_recurrencia_dias == null ? CONFIG_INICIAL.ventana_recurrencia_dias : entrada.ventana_recurrencia_dias);
    if (!Number.isInteger(ventana) || ventana < 7 || ventana > 730) throw new Error('La ventana de recurrencia debe estar entre 7 y 730 días');
    return {
        indicadores,
        umbral_recurrencia: umbral,
        ventana_recurrencia_dias: ventana,
        validado: Boolean(entrada.validado),
        validado_por: entrada.validado_por || null,
        fecha_validacion: entrada.fecha_validacion || null,
        nota: String(entrada.nota || '').trim().slice(0, 500)
    };
}

async function obtenerConfig(db) {
    try {
        const [f] = await db.query('SELECT valor FROM configuracion_sistema WHERE clave = ? LIMIT 1', [CLAVE_CONFIG]);
        if (f.length && f[0].valor) {
            const v = typeof f[0].valor === 'string' ? JSON.parse(f[0].valor) : f[0].valor;
            return validarConfig(v);
        }
    } catch (e) {
        console.error('Configuración de SPI inválida; se usa la inicial:', e.message);
    }
    return JSON.parse(JSON.stringify(CONFIG_INICIAL));
}

async function guardarConfig(db, config) {
    await db.query(
        `INSERT INTO configuracion_sistema (clave, valor, tipo, descripcion, editable, categoria)
         VALUES (?, ?, 'json', 'Indicadores de desempeño de seguridad operacional (SPI)', 1, 'sms')
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [CLAVE_CONFIG, JSON.stringify(config)]
    );
    return config;
}

module.exports = {
    CLAVE_CONFIG, METRICAS, CONFIG_INICIAL,
    mesDe, diaDe, enRango, mediana, redondear,
    valorMensual, estadoSPI, calcularSPI,
    resumenPeriodo, periodoComparacion, periodoIndicadores, categoriasRecurrentes,
    validarConfig, obtenerConfig, guardarConfig
};
