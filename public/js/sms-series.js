/* S.A.G.A. · Series por periodo para las gráficas del análisis estadístico.
   Funciones puras (sin DOM ni red): las prueba tests/unit/series.test.js.
   El servidor entrega conteos YA AGREGADOS por día (GET /api/sms/analisis):
     diario:          [{ dia, recibidos, nuevos, atencion, resueltos, sin_accion }]
                      por fecha del reporte, con su estatus vigente
     cierres_diarios: [{ dia, cerrados }]  por fecha en que se registró el cierre vigente
   Aquí solo se reparten esos días en cubetas (día, semana o mes), así que el
   costo depende del número de días, no del número de reportes.

   - rangoEfectivo(filtros, diario, hoy)   periodo que cubren las gráficas
   - rangoFlujo(rango, cierres, hoy)        el mismo, extendido hasta el último cierre
   - granularidad(desde, hasta)             'dia' | 'semana' | 'mes' automática
   - periodos(desde, hasta, gran)           cubetas [{ clave, desde, hasta, parcial }]
   - agrupar(diario, cierres, cubetas)      recibidos y estatus por cubeta; cerrados por fecha de cierre
   - acumulado(diario, cierres, cubetas)    recibidos y cerrados acumulados al final de cada cubeta
   Fechas como texto 'YYYY-MM-DD' y aritmética en UTC (sin saltos por horario). */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.SMSSeries = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MAX_DIAS_POR_DIA = 400;     // más días que esto no se dibujan uno por uno
    var AUTO_DIA = 62;              // hasta ~2 meses: por día
    var AUTO_SEMANA = 182;          // hasta ~6 meses: por semana; después, por mes

    function sumar(iso, n) {
        var d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }
    function dias(desde, hasta) {
        return Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / 86400000) + 1;
    }
    function lunes(iso) {
        var w = (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
        return sumar(iso, -w);
    }
    function finDeMes(iso) {
        var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
        return iso.slice(0, 8) + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
    }
    function min(a, b) { return a < b ? a : b; }
    function max(a, b) { return a > b ? a : b; }

    /**
     * Periodo de las gráficas por fecha.
     * - Fecha específica o desde/hasta de los filtros.
     * - Sin inicio: desde el primer día con reportes.
     * - Sin fin: hasta hoy si los filtros fijan el inicio; si no, hasta el último día con reportes.
     * @returns {{desde, hasta}|null}  null cuando no hay ningún dato ni periodo
     */
    function rangoEfectivo(filtros, diario, hoy) {
        filtros = filtros || {};
        diario = diario || [];
        var primero = diario.length ? diario[0].dia : null;
        var ultimo = diario.length ? diario[diario.length - 1].dia : null;
        var desde = filtros.fecha || filtros.desde || primero;
        var hasta = filtros.fecha || filtros.hasta || (filtros.desde ? max(hoy, filtros.desde) : ultimo);
        if (!desde || !hasta) return null;
        if (hasta < desde) hasta = desde;
        return { desde: desde, hasta: hasta };
    }

    /** El flujo acumulado sigue a los reportes del periodo hasta su último cierre (sin pasar de hoy). */
    function rangoFlujo(rango, cierres, hoy) {
        if (!rango) return null;
        var ultimo = cierres && cierres.length ? cierres[cierres.length - 1].dia : null;
        var hasta = ultimo && ultimo > rango.hasta ? min(ultimo, max(hoy, rango.hasta)) : rango.hasta;
        return { desde: rango.desde, hasta: hasta };
    }

    function granularidad(desde, hasta) {
        var n = dias(desde, hasta);
        return n <= AUTO_DIA ? 'dia' : n <= AUTO_SEMANA ? 'semana' : 'mes';
    }

    /**
     * Cubetas contiguas que cubren [desde, hasta]. Semanas de lunes a domingo;
     * la primera y la última se recortan al periodo y se marcan como parciales.
     * Un periodo demasiado largo para verse por día se agrupa por semana.
     * @returns {{ gran: string, cubetas: Array<{clave, desde, hasta, parcial}> }}
     */
    function periodos(desde, hasta, gran) {
        if (gran === 'dia' && dias(desde, hasta) > MAX_DIAS_POR_DIA) gran = 'semana';
        var out = [];
        var ini, fin, guardia = 0;
        if (gran === 'dia') {
            for (ini = desde; ini <= hasta && guardia++ < 5000; ini = sumar(ini, 1)) out.push({ clave: ini, desde: ini, hasta: ini, parcial: false });
        } else if (gran === 'semana') {
            for (ini = lunes(desde); ini <= hasta && guardia++ < 5000; ini = sumar(ini, 7)) {
                fin = sumar(ini, 6);
                out.push({ clave: ini, desde: max(ini, desde), hasta: min(fin, hasta), parcial: ini < desde || fin > hasta });
            }
        } else {
            gran = 'mes';
            for (ini = desde.slice(0, 8) + '01'; ini <= hasta && guardia++ < 5000; ini = sumar(finDeMes(ini), 1)) {
                fin = finDeMes(ini);
                out.push({ clave: ini.slice(0, 7), desde: max(ini, desde), hasta: min(fin, hasta), parcial: ini < desde || fin > hasta });
            }
        }
        return { gran: gran, cubetas: out };
    }

    /** Índice de la cubeta que contiene el día (búsqueda binaria); -1 si queda fuera. */
    function indiceDe(cubetas, dia) {
        var lo = 0, hi = cubetas.length - 1;
        if (hi < 0 || dia < cubetas[0].desde || dia > cubetas[hi].hasta) return -1;
        while (lo < hi) {
            var m = (lo + hi) >> 1;
            if (cubetas[m].hasta < dia) lo = m + 1; else hi = m;
        }
        return lo;
    }

    /**
     * Recibidos (y su estatus vigente) por fecha del reporte, y cerrados por la
     * fecha en que se registró su cierre. Días fuera de las cubetas no se cuentan.
     */
    function agrupar(diario, cierres, cubetas) {
        var out = cubetas.map(function (c) {
            return { clave: c.clave, desde: c.desde, hasta: c.hasta, parcial: c.parcial, recibidos: 0, nuevos: 0, atencion: 0, resueltos: 0, sin_accion: 0, cerrados: 0 };
        });
        (diario || []).forEach(function (d) {
            var i = indiceDe(cubetas, d.dia);
            if (i < 0) return;
            var o = out[i];
            o.recibidos += d.recibidos; o.nuevos += d.nuevos; o.atencion += d.atencion;
            o.resueltos += d.resueltos; o.sin_accion += d.sin_accion;
        });
        (cierres || []).forEach(function (c) {
            var i = indiceDe(cubetas, c.dia);
            if (i >= 0) out[i].cerrados += c.cerrados;
        });
        return out;
    }

    /**
     * Recibidos y cerrados acumulados al final de cada cubeta; la diferencia son
     * los reportes que seguían abiertos ese día (según su cierre vigente).
     * Un cierre registrado antes del inicio (dato inconsistente) se cuenta en la primera cubeta.
     */
    function acumulado(diario, cierres, cubetas) {
        var g = agrupar(diario, [], cubetas);
        var cer = cubetas.map(function () { return 0; });
        (cierres || []).forEach(function (c) {
            if (!cubetas.length) return;
            var i = c.dia < cubetas[0].desde ? 0 : indiceDe(cubetas, c.dia);
            if (i >= 0) cer[i] += c.cerrados;
        });
        var r = 0, k = 0;
        return g.map(function (o, i) {
            r += o.recibidos; k += cer[i];
            return { clave: o.clave, desde: o.desde, hasta: o.hasta, parcial: o.parcial, recibidos: r, cerrados: k, pendientes: r - k };
        });
    }

    return {
        MAX_DIAS_POR_DIA: MAX_DIAS_POR_DIA,
        sumar: sumar, dias: dias, lunes: lunes, finDeMes: finDeMes,
        rangoEfectivo: rangoEfectivo, rangoFlujo: rangoFlujo, granularidad: granularidad,
        periodos: periodos, indiceDe: indiceDe, agrupar: agrupar, acumulado: acumulado
    };
});
