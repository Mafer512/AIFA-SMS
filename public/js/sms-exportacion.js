/* S.A.G.A. · Reglas compartidas de la exportación (PDF y Excel)
   Un solo catálogo de columnas, indicadores, gráficas y textos para que el PDF
   (se arma en el navegador) y el Excel (se arma en el servidor) digan lo mismo
   que la vista general:
     - INDICADORES  mismas cifras, nombres y sentido que las tarjetas
     - COLUMNAS     columnas exportables (algunas solo con permiso)
     - GRAFICAS     gráficas disponibles para el PDF
     - normalizarOpciones  valida lo que elige la persona (navegador y servidor)
     - variacion / resumenEjecutivo / observaciones   textos con cifras reales
     - textoSeguro  evita que un texto se interprete como fórmula en Excel
     - fechaExcel   fecha "de reloj" de la Ciudad de México (Excel no tiene zona)
   Funciona en el navegador (window.SMSExportacion), en un Web Worker y en Node. */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.SMSExportacion = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var ZONA = 'America/Mexico_City';
    var ESTADOS = { A: 'Generado', B: 'Enterado', C: 'En atención', D: 'Resuelto', E: 'Duplicado', F: 'No requiere atención' };
    var CERRADOS = ['D', 'E', 'F'];
    var TITULO = 'Reporte general de hallazgos SMS';
    var MAX_TITULO = 120;
    var MAX_NOTAS = 1500;
    /** Tope de seguridad de filas por exportación (se avisa si se alcanza). */
    var LIMITE_FILAS = 50000;

    // ------------------------------------------------------------ fechas
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    var fmtPartes = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    var fmtCorta = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: ZONA });
    var fmtHora = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
    var fmtMes = new Intl.DateTimeFormat('es-MX', { month: 'short', year: 'numeric', timeZone: 'UTC' });

    function aInstante(v) {
        if (v == null || v === '') return null;
        if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
        // Día sin hora (AAAA-MM-DD): mediodía de México, igual que la vista general
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T12:00:00-06:00');
        var d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    /** Año, mes, día, hora… del instante en la hora de la Ciudad de México. */
    function partesMX(v) {
        var d = aInstante(v);
        if (!d) return null;
        var p = {};
        fmtPartes.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
        return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, s: +p.second };
    }
    function diaMX(v) {
        var p = partesMX(v);
        return p ? p.y + '-' + pad(p.m) + '-' + pad(p.d) : null;
    }
    /**
     * Fecha para una celda de Excel. Excel no guarda zona horaria: se escribe la
     * hora "de reloj" de México para que la celda muestre lo mismo que el sistema
     * (sin esto, una hora de las 09:45 aparecía como 15:45).
     */
    function fechaExcel(v, soloDia) {
        var p = partesMX(v);
        if (!p) return null;
        return soloDia ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : new Date(Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s));
    }
    function diasEntre(a, b) {
        return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
    }
    function sinPunto(t) { return String(t).replace(/\./g, ''); }
    function fecha(v) { var d = aInstante(v); return d ? sinPunto(fmtCorta.format(d)) : '—'; }
    function hora(v) { var d = aInstante(v); return d ? fmtHora.format(d) : ''; }
    function fechaHora(v) { var d = aInstante(v); return d ? fecha(d) + ' · ' + hora(d) : '—'; }
    function mes(yyyyMm) {
        var p = String(yyyyMm).split('-');
        return sinPunto(fmtMes.format(new Date(Date.UTC(+p[0], +p[1] - 1, 15))));
    }
    function rangoTexto(desde, hasta) {
        if (!desde && !hasta) return 'Todo el historial';
        if (desde && hasta) return desde === hasta ? fecha(desde) : fecha(desde) + ' – ' + fecha(hasta);
        return desde ? 'Desde el ' + fecha(desde) : 'Hasta el ' + fecha(hasta);
    }
    /** Periodo consultado según los filtros de fecha (texto y número de días). */
    function periodoConsultado(filtros) {
        filtros = filtros || {};
        if (filtros.fecha) return { desde: filtros.fecha, hasta: filtros.fecha, dias: 1, texto: fecha(filtros.fecha) + ' (1 día)' };
        var desde = filtros.desde || null, hasta = filtros.hasta || null;
        if (desde && hasta) {
            var n = diasEntre(desde, hasta) + 1;
            return { desde: desde, hasta: hasta, dias: n, texto: rangoTexto(desde, hasta) + ' (' + numero(n) + (n === 1 ? ' día)' : ' días)') };
        }
        return { desde: desde, hasta: hasta, dias: null, texto: rangoTexto(desde, hasta) };
    }

    // ------------------------------------------------------------ números
    function numero(n, dec) {
        if (n == null || isNaN(n)) return '—';
        return Number(n).toLocaleString('es-MX', { maximumFractionDigits: dec == null ? 0 : dec, minimumFractionDigits: 0 });
    }
    /** Días → "25 min", "7.4 h", "3.2 días" (mismo criterio que la vista general). */
    function duracionDias(dias) {
        if (dias == null || isNaN(dias)) return '—';
        var m = Number(dias) * 1440;
        if (m < 60) return Math.round(m) + ' min';
        if (m < 1440) return numero(m / 60, 1) + ' h';
        var d = m / 1440;
        return numero(d, 1) + (Math.round(d * 10) === 10 ? ' día' : ' días');
    }
    function plural(n, uno, varios) { return numero(n) + ' ' + (n === 1 ? uno : varios); }

    // ------------------------------------------------- semáforo de plazos
    var SEMAFORO = {
        vencido: 'Vencido', proximo: 'Próximo a vencer', en_tiempo: 'En tiempo', sin_plazo: 'Sin plazo',
        cerrado_en_plazo: 'Cerrado en plazo', cerrado_fuera: 'Cerrado fuera de plazo', cerrado: 'Cerrado sin plazo'
    };
    function semaforo(r, hoy, diasAviso) {
        if (CERRADOS.indexOf(r.estado) >= 0) {
            if (r.cerrado_en_plazo === true) return 'cerrado_en_plazo';
            if (r.cerrado_en_plazo === false) return 'cerrado_fuera';
            return 'cerrado';
        }
        if (!r.fecha_vencimiento) return 'sin_plazo';
        var d = diasEntre(hoy, diaMX(r.fecha_vencimiento));
        if (d < 0) return 'vencido';
        return d <= (diasAviso == null ? 7 : diasAviso) ? 'proximo' : 'en_tiempo';
    }

    // ---------------------------------------------------------- indicadores
    // tipo: n = conteo · pct = porcentaje (varía en puntos) · dur = días
    // sentido: bien = subir es favorable · mal = subir es desfavorable · neutra = sin juicio
    var GRUPOS_INDICADORES = [
        { k: 'estatus', t: 'Estatus de los reportes' },
        { k: 'gestion', t: 'Gestión, plazos y riesgo' }
    ];
    var INDICADORES = [
        { k: 'total', grupo: 'estatus', t: 'Total de reportes', tipo: 'n', sentido: 'neutra', tono: 'brand',
          v: function (i) { return i.total; },
          det: function (i) { return i.total ? i.abiertos + ' abiertos · ' + i.cerrados + ' cerrados' : 'Sin reportes con estos filtros'; },
          como: 'Reportes que cumplen los filtros. Cada reporte cuenta una sola vez aunque esté asignado a varias áreas.' },
        { k: 'nuevos', grupo: 'estatus', t: 'Nuevos', tipo: 'n', sentido: 'mal', tono: 'warn',
          v: function (i) { return i.nuevos; }, det: function () { return 'A · Generado'; },
          como: 'Reportes en estatus A · Generado (aún sin atender).' },
        { k: 'atencion', grupo: 'estatus', t: 'En atención', tipo: 'n', sentido: 'neutra', tono: 'info',
          v: function (i) { return i.en_atencion; }, det: function () { return 'B · Enterado y C · En atención'; },
          como: 'Reportes en estatus B · Enterado o C · En atención.' },
        { k: 'resueltos', grupo: 'estatus', t: 'Resueltos', tipo: 'n', sentido: 'bien', tono: 'ok',
          v: function (i) { return i.resueltos; }, det: function () { return 'D · Resuelto'; },
          como: 'Reportes en estatus D · Resuelto (el hallazgo se atendió).' },
        { k: 'sinaccion', grupo: 'estatus', t: 'Cerrados sin acción', tipo: 'n', sentido: 'neutra', tono: 'neutro',
          v: function (i) { return i.duplicados + i.no_requiere; },
          det: function (i) { return i.duplicados + ' duplicado' + (i.duplicados === 1 ? '' : 's') + ' · ' + i.no_requiere + ' no requiere' + (i.no_requiere === 1 ? '' : 'n'); },
          como: 'Reportes cerrados como E · Duplicado o F · No requiere atención.' },
        { k: 'cerrados', grupo: 'estatus', t: 'Reportes cerrados', tipo: 'pct', sentido: 'bien', tono: 'ok',
          v: function (i) { return i.porcentaje_cerrados; },
          det: function (i) { return i.total ? i.cerrados + ' de ' + i.total + ' reportes' : 'Sin reportes con estos filtros'; },
          como: 'Porcentaje del total que ya está cerrado (Resuelto, Duplicado o No requiere atención).' },
        { k: 'enplazo', grupo: 'gestion', t: 'Cumplimiento de plazos', tipo: 'pct', sentido: 'bien', tono: 'ok',
          v: function (i) { return i.porcentaje_en_plazo; },
          det: function (i) { return i.cerrados_con_plazo ? i.cerrados_en_plazo + ' de ' + i.cerrados_con_plazo + ' cerrados con plazo' : (i.cerrados ? 'Ningún cerrado tenía plazo' : 'Sin reportes cerrados'); },
          como: 'De los reportes cerrados que tenían plazo (fecha compromiso o plazo por nivel de riesgo), porcentaje cerrado a más tardar en esa fecha.' },
        { k: 'tiempo', grupo: 'gestion', t: 'Tiempo de resolución (mediana)', tipo: 'dur', sentido: 'mal', tono: 'info',
          v: function (i) { return i.dias_mediana_resolucion; },
          det: function (i) { return i.dias_mediana_resolucion == null ? 'Sin reportes resueltos' : 'Promedio ' + duracionDias(i.dias_promedio_resolucion) + ' · ' + i.resueltos_con_fecha + ' resuelto' + (i.resueltos_con_fecha === 1 ? '' : 's'); },
          como: 'Desde la fecha del reporte hasta su registro como Resuelto. Solo cuenta los Resueltos; la mediana no se distorsiona por casos extremos.' },
        { k: 'alto', grupo: 'gestion', t: 'Alto riesgo', tipo: 'n', sentido: 'mal', tono: 'crit',
          v: function (i) { return i.evaluados ? i.alto_riesgo : null; },
          det: function (i) { return i.evaluados ? 'De ' + i.evaluados + ' evaluado(s)' : 'Ningún reporte evaluado aún'; },
          como: 'Reportes cuyo riesgo vigente es de nivel alto según la matriz de riesgo.' },
        { k: 'pendeval', grupo: 'gestion', t: 'Pendientes de evaluar', tipo: 'n', sentido: 'mal', tono: 'warn',
          v: function (i) { return i.pendientes_evaluar; },
          det: function (i) { return i.abiertos ? 'De ' + i.abiertos + ' abiertos' : 'Sin reportes abiertos'; },
          como: 'Reportes abiertos que aún no tienen evaluación de riesgo.' },
        { k: 'vencidos', grupo: 'gestion', t: 'Vencidos', tipo: 'n', sentido: 'mal', tono: 'crit',
          v: function (i) { return i.con_fecha ? i.vencidos : null; },
          det: function (i) { return i.con_fecha ? 'De ' + i.con_fecha + ' con plazo' : (i.abiertos ? 'Ningún abierto tiene plazo' : 'Sin reportes abiertos'); },
          como: 'Reportes abiertos cuya fecha compromiso o plazo ya pasó.' },
        { k: 'proximos', grupo: 'gestion', t: 'Próximos a vencer', tipo: 'n', sentido: 'neutra', tono: 'warn',
          v: function (i) { return i.con_fecha ? i.proximos : null; },
          det: function (i) { return i.con_fecha ? 'En los próximos ' + i.dias_aviso + ' días' : (i.abiertos ? 'Ningún abierto tiene plazo' : 'Sin reportes abiertos'); },
          como: 'Reportes abiertos que vencen dentro de los días de aviso configurados.' }
    ];
    var INDICADOR = {};
    INDICADORES.forEach(function (d) { INDICADOR[d.k] = d; });

    function cifraTexto(def, v) {
        if (v == null) return 'Sin datos';
        if (def.tipo === 'pct') return numero(v, 1) + ' %';
        if (def.tipo === 'dur') return duracionDias(v);
        return numero(v);
    }
    function porcentajeTexto(x) {
        var t = numero(x, x < 10 ? 1 : 0);
        return t === '0' ? '< 0.1' : t;
    }
    var LECTURA = { bueno: 'Favorable', malo: 'Desfavorable', neutro: 'Sin juicio de valor', igual: 'Sin cambio', nd: 'Sin comparación' };
    /**
     * Variación de un indicador entre el periodo actual y el anterior, con el
     * mismo criterio que las tarjetas: porcentajes en puntos (pts); si el
     * anterior fue 0 no hay porcentaje, solo la diferencia.
     */
    function variacion(def, comp) {
        var act = comp && comp.valores ? def.v(comp.valores.actual) : null;
        var ant = comp && comp.valores ? def.v(comp.valores.anterior) : null;
        if (act == null || ant == null) {
            var sin = !comp ? 'Sin comparación disponible'
                : act == null && ant == null ? 'Sin datos para comparar'
                : ant == null ? 'Sin dato previo' : 'Sin datos en el periodo';
            return { estado: 'nd', tono: 'nd', act: act, ant: ant, dif: null, rel: null, texto: sin, lectura: LECTURA.nd };
        }
        var dif = act - ant;
        if (Math.abs(dif) < 1e-9) return { estado: 'igual', tono: 'igual', act: act, ant: ant, dif: 0, rel: ant ? 0 : null, texto: 'Sin cambio', lectura: LECTURA.igual };
        var sube = dif > 0;
        var signo = sube ? '+' : '−';
        var tono = def.sentido === 'neutra' ? 'neutro' : (sube === (def.sentido === 'bien') ? 'bueno' : 'malo');
        var texto, rel = null, textoDif;
        if (def.tipo === 'pct') {
            texto = textoDif = signo + numero(Math.abs(dif), 1) + ' pts';
        } else {
            textoDif = signo + (def.tipo === 'dur' ? duracionDias(Math.abs(dif)) : numero(Math.abs(dif)));
            if (ant === 0) texto = textoDif;
            else { rel = dif / ant; texto = signo + porcentajeTexto(Math.abs(rel) * 100) + ' %'; }
        }
        return { estado: 'cambio', tono: tono, sube: sube, act: act, ant: ant, dif: dif, rel: rel, texto: texto, textoDif: textoDif, lectura: LECTURA[tono] };
    }
    /** Nombre de los dos periodos que se comparan. */
    function nombresComparacion(comp) {
        if (!comp) return null;
        return {
            actual: comp.automatico ? 'Últimos ' + comp.dias + ' días' : 'Periodo consultado',
            anterior: comp.automatico ? comp.dias + ' días previos' : 'Periodo anterior',
            rangoActual: rangoTexto(comp.actual.desde, comp.actual.hasta),
            rangoAnterior: rangoTexto(comp.anterior.desde, comp.anterior.hasta),
            nota: comp.automatico
                ? 'Sin periodo elegido: se comparan los últimos ' + comp.dias + ' días con los ' + comp.dias + ' previos.'
                : 'Se compara con el periodo anterior de igual duración (' + comp.dias + (comp.dias === 1 ? ' día' : ' días') + ').'
        };
    }

    // ------------------------------------------------------------ columnas
    // tipo: texto · largo (texto extenso) · fecha · fechahora · entero · decimal
    // xlsx / pdf: incluida por omisión en ese formato · fija: siempre se incluye
    // restringida: capacidad necesaria (datos personales) · soloExcel: no va al PDF
    function areasDe(f) {
        var resp = f.areas_responsables || [], notif = f.areas_notificadas || [];
        if (resp.length) return resp.join(', ');
        return notif.length ? notif.join(', ') + ' (notificada)' : 'Sin área asignada';
    }
    function horasA(a, b) {
        var x = aInstante(a), y = aInstante(b);
        return x && y ? Math.max(0, (y.getTime() - x.getTime()) / 86400000) : null;
    }
    var COLUMNAS = [
        { k: 'folio', t: 'Folio', tipo: 'texto', ancho: 12, mm: 19, fija: true, xlsx: true, pdf: true, v: function (f) { return f.folio; } },
        { k: 'fecha', t: 'Fecha del reporte', tipo: 'fechahora', ancho: 18, mm: 21, xlsx: true, pdf: true, v: function (f) { return f.fecha; } },
        { k: 'act', t: 'Última actualización', tipo: 'fechahora', ancho: 18, mm: 21, xlsx: true, pdf: false, v: function (f) { return f.fecha_actualizacion; } },
        { k: 'estado', t: 'Estatus', tipo: 'texto', ancho: 22, mm: 27, xlsx: true, pdf: true, v: function (f) { return f.estado + ' · ' + (ESTADOS[f.estado] || ''); } },
        { k: 'categoria', t: 'Categoría', tipo: 'texto', ancho: 28, mm: 30, xlsx: true, pdf: true, v: function (f) { return f.tipo_problema || ''; } },
        { k: 'descripcion', t: 'Descripción', tipo: 'largo', ancho: 60, mm: 0, xlsx: true, pdf: true, v: function (f) { return f.descripcion || ''; } },
        { k: 'lugar', t: 'Ubicación', tipo: 'texto', ancho: 32, mm: 30, xlsx: true, pdf: false, v: function (f) { return f.lugar || ''; } },
        { k: 'area', t: 'Área', tipo: 'texto', ancho: 34, mm: 32, xlsx: false, pdf: true, v: areasDe,
          ayuda: 'Áreas responsables; si no hay, las notificadas (como en la tabla de la vista general)' },
        { k: 'responsables', t: 'Áreas responsables', tipo: 'texto', ancho: 34, mm: 32, xlsx: true, pdf: false, v: function (f) { return (f.areas_responsables || []).join(', '); } },
        { k: 'notificadas', t: 'Áreas notificadas', tipo: 'texto', ancho: 34, mm: 32, xlsx: true, pdf: false, v: function (f) { return (f.areas_notificadas || []).join(', '); } },
        { k: 'zona', t: 'Zona', tipo: 'texto', ancho: 22, mm: 24, xlsx: true, pdf: false, v: function (f) { return f.zona ? f.zona.nombre : ''; } },
        { k: 'tipo_rep', t: 'Tipo de reporte', tipo: 'texto', ancho: 20, mm: 24, xlsx: true, pdf: false, v: function (f) { return f.tipo_reporte_nombre || 'Sin clasificar'; } },
        { k: 'vuelo', t: 'Vuelo', tipo: 'texto', ancho: 10, mm: 14, xlsx: true, pdf: false, v: function (f) { return f.vuelo || ''; } },
        { k: 'matricula', t: 'Matrícula', tipo: 'texto', ancho: 11, mm: 14, xlsx: true, pdf: false, v: function (f) { return f.matricula || ''; } },
        { k: 'posicion', t: 'Posición', tipo: 'texto', ancho: 10, mm: 14, xlsx: true, pdf: false, v: function (f) { return f.posicion || ''; } },
        { k: 'gse', t: 'Equipo de apoyo (GSE)', tipo: 'texto', ancho: 26, mm: 28, xlsx: true, pdf: false, v: function (f) { return f.gse ? [f.gse.tipo, f.gse.numero].filter(Boolean).join(' · ') : ''; } },
        { k: 'perc_p', t: 'Frecuencia según quien reportó (1-5)', tipo: 'entero', ancho: 12, mm: 16, xlsx: true, pdf: false, v: function (f) { return f.percepcion ? f.percepcion.probabilidad : null; } },
        { k: 'perc_s', t: 'Gravedad según quien reportó (1-5)', tipo: 'entero', ancho: 12, mm: 16, xlsx: true, pdf: false, v: function (f) { return f.percepcion ? f.percepcion.severidad : null; } },
        { k: 'sugerencia', t: 'Sugerencia de prevención', tipo: 'largo', ancho: 50, mm: 0, xlsx: true, pdf: false, v: function (f) { return f.sugerencia_prevencion || ''; } },
        { k: 'riesgo', t: 'Riesgo vigente', tipo: 'texto', ancho: 20, mm: 25, xlsx: true, pdf: true, v: function (f) { return f.riesgo ? f.riesgo.nombre : 'Sin evaluar'; } },
        { k: 'indice', t: 'Índice de riesgo', tipo: 'texto', ancho: 10, mm: 14, xlsx: true, pdf: false, v: function (f) { return f.riesgo ? String(f.riesgo.indice) : ''; } },
        { k: 'tipo_eval', t: 'Tipo de evaluación', tipo: 'texto', ancho: 13, mm: 18, xlsx: true, pdf: false, v: function (f) { return f.riesgo ? (f.riesgo.tipo === 'residual' ? 'Residual' : 'Inicial') : ''; } },
        { k: 'riesgo_ini', t: 'Riesgo inicial', tipo: 'texto', ancho: 22, mm: 25, xlsx: true, pdf: false, v: function (f) { return f.riesgo_inicial ? f.riesgo_inicial.indice + ' · ' + f.riesgo_inicial.nombre : ''; } },
        { k: 'comp', t: 'Fecha compromiso', tipo: 'fecha', ancho: 14, mm: 20, xlsx: true, pdf: false, v: function (f) { return f.compromiso ? f.compromiso.fecha : null; } },
        { k: 'comp_resp', t: 'Responsable del compromiso', tipo: 'texto', ancho: 30, mm: 30, xlsx: true, pdf: false, v: function (f) { return f.compromiso ? [f.compromiso.area, f.compromiso.responsable].filter(Boolean).join(' · ') : ''; } },
        { k: 'venc', t: 'Fecha de vencimiento', tipo: 'fecha', ancho: 14, mm: 20, xlsx: true, pdf: false, v: function (f) { return f.fecha_vencimiento; } },
        { k: 'situacion', t: 'Semáforo de plazo', tipo: 'texto', ancho: 20, mm: 26, xlsx: true, pdf: true, v: function (f, c) { return SEMAFORO[semaforo(f, c.hoy, c.diasAviso)]; } },
        { k: 'cierre', t: 'Fecha de cierre', tipo: 'fechahora', ancho: 18, mm: 21, xlsx: true, pdf: false, v: function (f) { return f.fecha_cierre; } },
        { k: 'dias_cierre', t: 'Días hasta el cierre', tipo: 'decimal', ancho: 12, mm: 16, xlsx: true, pdf: false, v: function (f) { return horasA(f.fecha, f.fecha_cierre); },
          ayuda: 'Días entre la fecha del reporte y su cierre (en Excel es una fórmula si también se exportan ambas fechas)' },
        { k: 'abiertas', t: 'Acciones abiertas', tipo: 'entero', ancho: 11, mm: 15, xlsx: true, pdf: false, v: function (f) { return f.acciones ? f.acciones.abiertas : 0; } },
        { k: 'acciones', t: 'Acciones totales', tipo: 'entero', ancho: 11, mm: 15, xlsx: true, pdf: false, v: function (f) { return f.acciones ? f.acciones.total : 0; } },
        { k: 'ultimo', t: 'Último seguimiento', tipo: 'largo', ancho: 50, mm: 0, xlsx: true, pdf: false, v: function (f) { return f.ultimo_seguimiento || ''; } },
        { k: 'rep_nombre', t: 'Reportante', tipo: 'texto', ancho: 26, restringida: 'exportar_detalle', soloExcel: true, xlsx: true, v: function (f, c) { return (c.personales[f.id] || {}).nombre || ''; } },
        { k: 'rep_tel', t: 'Teléfono', tipo: 'texto', ancho: 14, restringida: 'exportar_detalle', soloExcel: true, xlsx: true, v: function (f, c) { return (c.personales[f.id] || {}).telefono || ''; } },
        { k: 'rep_area', t: 'Gerencia del reportante', tipo: 'texto', ancho: 24, restringida: 'exportar_detalle', soloExcel: true, xlsx: true, v: function (f, c) { return (c.personales[f.id] || {}).area || ''; } },
        { k: 'rep_cargo', t: 'Cargo', tipo: 'texto', ancho: 20, restringida: 'exportar_detalle', soloExcel: true, xlsx: true, v: function (f, c) { return (c.personales[f.id] || {}).cargo || ''; } }
    ];
    var COLUMNA = {};
    COLUMNAS.forEach(function (c) { COLUMNA[c.k] = c; });

    // ------------------------------------------------------------ gráficas
    // media: en PDF horizontal va a media hoja, junto a otra gráfica compacta
    var GRAFICAS = [
        { k: 'evolucion', t: 'Evolución de reportes recibidos y cerrados', sub: 'Recibidos por fecha del reporte y cerrados por fecha de cierre.', pdf: true },
        { k: 'periodos', t: 'Reportes por periodo y estatus', sub: 'Estatus vigente de los reportes recibidos en cada periodo.', pdf: false },
        { k: 'flujo', t: 'Flujo acumulado', sub: 'Recibidos y cerrados acumulados; la distancia entre ambas curvas son los reportes pendientes.', pdf: false },
        { k: 'estatus', t: 'Distribución por estatus', sub: 'Estatus vigente de cada reporte.', pdf: true, media: true },
        { k: 'horas', t: 'Concentración por hora del día', sub: 'Hora en que se registró cada reporte.', pdf: false, media: true },
        { k: 'tendencia', t: 'Tendencia de resolución', sub: 'Días promedio para resolver, por mes de resolución.', pdf: false, media: true },
        { k: 'areas', t: 'Hallazgos por área', sub: 'Áreas notificadas o responsables (15 con más reportes).', pdf: true, media: true },
        { k: 'categorias', t: 'Categorías más frecuentes', sub: 'Las 10 categorías con más reportes.', pdf: true, media: true },
        { k: 'riesgo', t: 'Clasificación por nivel de riesgo', sub: 'Reportes evaluados en la matriz de probabilidad × severidad.', pdf: true }
    ];

    // Secciones de contenido que se pueden incluir u omitir
    var CONTENIDO = [
        { k: 'comparativo', t: 'Comparación con el periodo anterior', d: 'Cada indicador frente al periodo anterior de igual duración' },
        { k: 'tablas', t: 'Tablas de resumen', d: 'Por estatus, área, categoría y nivel de riesgo' },
        { k: 'detalle', t: 'Listado detallado de reportes', d: 'Una fila por reporte con las columnas elegidas' },
        { k: 'observaciones', t: 'Observaciones', d: 'Alertas y notas de calidad de datos, solo cuando existen' }
    ];

    // ------------------------------------------------------------ opciones
    // Sin el parámetro = valor por omisión; parámetro vacío = ninguno (la persona quitó todo)
    function lista(v) {
        if (Array.isArray(v)) return v.map(String);
        if (v == null) return null;
        return String(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    }
    function textoLimpio(v, max) {
        return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
    }
    /**
     * Valida y completa las opciones de exportación. Lo que falta toma el valor
     * por omisión (por eso una URL sin opciones exporta todo, como antes).
     * @param {object} o  { formato, titulo, indicadores, graficas, columnas, contenido, orientacion, notas }
     * @param {object} permisos { puedeDetalle }  columnas con datos personales
     */
    function normalizarOpciones(o, permisos) {
        o = o || {};
        permisos = permisos || {};
        var formato = o.formato === 'pdf' ? 'pdf' : 'xlsx';
        var enCatalogo = function (pedidas, catalogo, porOmision) {
            var ks = lista(pedidas);
            if (ks === null) return porOmision;
            var validas = {};
            catalogo.forEach(function (c) { validas[c.k] = true; });
            var vistos = {};
            return ks.filter(function (k) { if (!validas[k] || vistos[k]) return false; vistos[k] = true; return true; });
        };
        var indicadores = enCatalogo(o.indicadores, INDICADORES, INDICADORES.map(function (d) { return d.k; }));
        var graficas = formato === 'pdf' ? enCatalogo(o.graficas, GRAFICAS, GRAFICAS.filter(function (g) { return g.pdf; }).map(function (g) { return g.k; })) : [];
        var permitida = function (c) {
            if (c.restringida && !(c.restringida === 'exportar_detalle' && permisos.puedeDetalle)) return false;
            return !(c.soloExcel && formato === 'pdf');
        };
        var porOmisionCols = COLUMNAS.filter(function (c) { return c[formato] && permitida(c); }).map(function (c) { return c.k; });
        var columnas = enCatalogo(o.columnas, COLUMNAS, porOmisionCols);
        var omitidas = columnas.filter(function (k) { return !permitida(COLUMNA[k]); });
        columnas = columnas.filter(function (k) { return permitida(COLUMNA[k]) && !COLUMNA[k].fija; });
        // Las columnas fijas van siempre y primero; el resto, en el orden del catálogo
        columnas = COLUMNAS.filter(function (c) { return c.fija || columnas.indexOf(c.k) >= 0; }).map(function (c) { return c.k; });
        var cont = lista(o.contenido);
        var contenido = {};
        CONTENIDO.forEach(function (c) { contenido[c.k] = cont === null ? true : cont.indexOf(c.k) >= 0; });
        var orientacion = ['vertical', 'horizontal'].indexOf(o.orientacion) >= 0 ? o.orientacion : 'auto';
        return {
            formato: formato,
            titulo: textoLimpio(o.titulo, MAX_TITULO).replace(/\n/g, ' ') || TITULO,
            indicadores: indicadores,
            graficas: graficas,
            columnas: columnas,
            columnasOmitidas: omitidas.map(function (k) { return COLUMNA[k].t; }),
            contenido: contenido,
            orientacion: orientacion,
            notas: textoLimpio(o.notas, MAX_NOTAS)
        };
    }
    /**
     * Orientación del PDF. Automática: horizontal cuando el listado no cabe en
     * vertical (suma de anchos mínimos de las columnas > ancho útil de A4).
     */
    var ANCHO_UTIL_VERTICAL = 182;   // mm (A4 de 210 mm con márgenes de 14 mm)
    function anchoListado(op) {
        return op.columnas.map(function (k) { return COLUMNA[k]; }).filter(function (c) { return c && !c.soloExcel; })
            .reduce(function (s, c) { return s + (c.mm || 58); }, 0);
    }
    function orientacionPdf(op) {
        if (op.orientacion === 'vertical' || op.orientacion === 'horizontal') return op.orientacion;
        return op.contenido && op.contenido.detalle && anchoListado(op) > ANCHO_UTIL_VERTICAL ? 'horizontal' : 'vertical';
    }
    var ORDEN = {
        fecha: 'fecha del reporte', prioridad: 'prioridad (nivel de riesgo)', actualizacion: 'última actualización',
        vencimiento: 'plazo (vence primero)', folio: 'folio', area: 'área', categoria: 'categoría', estado: 'estatus'
    };
    function ordenTexto(orden) {
        if (!orden || !orden.campo) return '';
        return (ORDEN[orden.campo] || orden.campo) + (orden.dir === 'asc' ? ', ascendente' : ', descendente');
    }
    /** Opciones → parámetros de URL (lo que entiende /api/sms/exportar.xlsx). */
    function opcionesAParametros(op, params) {
        params.set('titulo', op.titulo);
        params.set('indicadores', op.indicadores.join(','));
        params.set('columnas', op.columnas.join(','));
        params.set('contenido', CONTENIDO.filter(function (c) { return op.contenido[c.k]; }).map(function (c) { return c.k; }).join(','));
        if (op.notas) params.set('notas', op.notas);
        return params;
    }

    // ------------------------------------------- textos con cifras reales
    /** Puntos del resumen ejecutivo (solo cifras calculadas por el sistema). */
    function resumenEjecutivo(i, comp) {
        var p = [];
        if (!i.total) return ['No hay reportes que cumplan los filtros en el periodo consultado.'];
        p.push(plural(i.total, 'reporte', 'reportes') + ': ' + plural(i.abiertos, 'abierto', 'abiertos') + ' y ' + plural(i.cerrados, 'cerrado', 'cerrados') +
            ' (' + plural(i.resueltos, 'resuelto', 'resueltos') + ', ' + plural(i.duplicados, 'duplicado', 'duplicados') + ' y ' + numero(i.no_requiere) +
            (i.no_requiere === 1 ? ' que no requería atención' : ' que no requerían atención') + '). El ' + numero(i.porcentaje_cerrados, 1) + ' % ya está cerrado.');
        if (i.dias_mediana_resolucion != null) {
            p.push('Tiempo de resolución: mediana de ' + duracionDias(i.dias_mediana_resolucion) + ' y promedio de ' + duracionDias(i.dias_promedio_resolucion) +
                ' (' + plural(i.resueltos_con_fecha, 'resuelto', 'resueltos') + ').');
        }
        if (i.cerrados_con_plazo) {
            p.push('Cumplimiento de plazos: ' + numero(i.porcentaje_en_plazo, 1) + ' % (' + numero(i.cerrados_en_plazo) + ' de ' + numero(i.cerrados_con_plazo) + ' cerrados con plazo se cerraron a tiempo).');
        }
        if (comp && comp.valores) {
            var nc = nombresComparacion(comp), va = variacion(INDICADOR.total, comp);
            var a = comp.valores.actual.total, b = comp.valores.anterior.total;
            p.push((comp.automatico ? 'En los últimos ' + comp.dias + ' días (' + nc.rangoActual + ')' : 'En el periodo (' + nc.rangoActual + ')') +
                ' se recibieron ' + plural(a, 'reporte', 'reportes') + ', frente a ' + numero(b) + ' en ' + nc.rangoAnterior +
                (va.estado === 'cambio' ? ' (' + va.texto + ').' : va.estado === 'igual' ? ' (sin cambio).' : '.'));
        }
        if (i.evaluados) p.push(plural(i.alto_riesgo, 'reporte', 'reportes') + ' de alto riesgo entre ' + plural(i.evaluados, 'evaluado', 'evaluados') + '.');
        return p;
    }
    /**
     * Observaciones pertinentes (solo las que aplican). tipo: alerta | aviso | info
     * extra: { matrizValidada, cerradosSinFecha, truncado: { exportados, total }, recortadas }
     */
    function observaciones(i, extra) {
        extra = extra || {};
        var o = [];
        var c = i.coherencia || {};
        if (c.total_igual_abiertos_mas_cerrados === false || c.abiertos_igual_nuevos_mas_atencion === false || c.cerrados_igual_suma_de_cierres === false) {
            o.push({ tipo: 'alerta', texto: 'Las cifras de estatus no cuadran (total = abiertos + cerrados). Revisa la calidad de datos antes de usar este documento.' });
        }
        if (i.vencidos) o.push({ tipo: 'alerta', texto: plural(i.vencidos, 'reporte abierto ya venció su plazo', 'reportes abiertos ya vencieron su plazo') + '.' });
        if (i.proximos) o.push({ tipo: 'aviso', texto: plural(i.proximos, 'reporte vence', 'reportes vencen') + ' en los próximos ' + i.dias_aviso + ' días.' });
        if (i.acciones_vencidas) o.push({ tipo: 'alerta', texto: plural(i.acciones_vencidas, 'acción correctiva abierta está vencida', 'acciones correctivas abiertas están vencidas') + '.' });
        if (i.pendientes_evaluar) o.push({ tipo: 'aviso', texto: plural(i.pendientes_evaluar, 'reporte abierto está', 'reportes abiertos están') + ' pendientes de evaluación de riesgo.' });
        if (i.abiertos_sin_plazo) o.push({ tipo: 'aviso', texto: numero(i.abiertos_sin_plazo) + ' de ' + plural(i.abiertos, 'reporte abierto no tiene', 'reportes abiertos no tienen') + ' fecha compromiso ni plazo por nivel de riesgo.' });
        if (i.acciones_por_verificar) o.push({ tipo: 'info', texto: plural(i.acciones_por_verificar, 'acción concluida espera', 'acciones concluidas esperan') + ' la verificación de su efectividad.' });
        if (i.resueltos_sin_registro > 0) o.push({ tipo: 'info', texto: plural(i.resueltos_sin_registro, 'reporte resuelto no tiene', 'reportes resueltos no tienen') + ' fecha de resolución registrada; no se consideran en el tiempo de resolución.' });
        if (extra.cerradosSinFecha > 0) o.push({ tipo: 'info', texto: plural(extra.cerradosSinFecha, 'reporte cerrado no tiene', 'reportes cerrados no tienen') + ' registro de cierre con fecha; no aparecen en las series por fecha de cierre.' });
        if (extra.matrizValidada === false) o.push({ tipo: 'info', texto: 'La matriz de riesgo tiene los criterios del Manual SMS (numeral 5.3) y está pendiente de confirmar en el sistema.' });
        if (extra.truncado) o.push({ tipo: 'alerta', texto: 'El listado incluye los primeros ' + numero(extra.truncado.exportados) + ' de ' + numero(extra.truncado.total) + ' reportes (tope de seguridad). Acota el periodo o los filtros para exportar el resto.' });
        if (extra.recortadas) o.push({ tipo: 'info', texto: plural(extra.recortadas, 'texto largo se recortó', 'textos largos se recortaron') + ' en el listado del PDF; el texto completo está en la exportación a Excel.' });
        return o;
    }
    var NOTAS_METODO = [
        'Las cifras provienen de las mismas consultas que la vista general del SMS y respetan los filtros indicados.',
        'Cada reporte cuenta una sola vez aunque esté asignado a varias áreas. El estatus es el vigente a la fecha de generación.',
        'Variación: misma cifra, con los mismos filtros, en el periodo anterior de igual duración; los porcentajes cambian en puntos (pts).',
        'Fechas y horas en el horario del centro de México (America/Mexico_City).'
    ];

    // ----------------------------------------------------- hojas de cálculo
    // Un texto que empieza con = + - @ (o tabulador/retorno) podría ejecutarse
    // como fórmula al editarlo o al pasarlo a CSV: se antepone un apóstrofo.
    var PELIGRO_FORMULA = /^[=+\-@\t\r＝＋－＠]/;
    function textoSeguro(t) {
        if (t == null) return t;
        var s = String(t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, '');
        return PELIGRO_FORMULA.test(s) ? "'" + s : s;
    }

    return {
        ZONA: ZONA, ESTADOS: ESTADOS, CERRADOS: CERRADOS, TITULO: TITULO, LIMITE_FILAS: LIMITE_FILAS,
        MAX_TITULO: MAX_TITULO, MAX_NOTAS: MAX_NOTAS,
        SEMAFORO: SEMAFORO, semaforo: semaforo,
        GRUPOS_INDICADORES: GRUPOS_INDICADORES, INDICADORES: INDICADORES, INDICADOR: INDICADOR,
        COLUMNAS: COLUMNAS, COLUMNA: COLUMNA, GRAFICAS: GRAFICAS, CONTENIDO: CONTENIDO,
        normalizarOpciones: normalizarOpciones, opcionesAParametros: opcionesAParametros,
        orientacionPdf: orientacionPdf, anchoListado: anchoListado, ANCHO_UTIL_VERTICAL: ANCHO_UTIL_VERTICAL, ordenTexto: ordenTexto,
        variacion: variacion, nombresComparacion: nombresComparacion, cifraTexto: cifraTexto, LECTURA: LECTURA,
        resumenEjecutivo: resumenEjecutivo, observaciones: observaciones, NOTAS_METODO: NOTAS_METODO,
        textoSeguro: textoSeguro, PELIGRO_FORMULA: PELIGRO_FORMULA,
        aInstante: aInstante, partesMX: partesMX, diaMX: diaMX, fechaExcel: fechaExcel, diasEntre: diasEntre,
        fecha: fecha, hora: hora, fechaHora: fechaHora, mes: mes, rangoTexto: rangoTexto, periodoConsultado: periodoConsultado,
        numero: numero, duracionDias: duracionDias, plural: plural
    };
});
