/* S.A.G.A. · Vistas de análisis avanzado (compartidas por la página de
   análisis y el informe ejecutivo).
   - comparativo(el, datos)       comparación entre periodos
   - desempeno(el, datos)         desempeño por área responsable
   - recurrencias(elCat, elLug, datos)
   - spi(el, datos, opciones)     indicadores SPI configurados
   - calidad(el, datos)           revisión de consistencia de datos
   Todas las cifras vienen del servidor (registros reales).                   */
(function () {
    'use strict';
    var esc = SMS.esc, ic = SMS.ic, num = SMS.numero;
    function pl(n, uno, varios) { return num(n) + ' ' + (n === 1 ? uno : varios); }

    function rangoTexto(d, h) {
        return SMS.fecha(d) + ' – ' + SMS.fecha(h);
    }

    // ------------------------------------------------------- comparativo
    function variacion(a, b, tipo) {
        if (a == null || b == null) return '<span class="var var--igual">—</span>';
        var dif = a - b;
        if (Math.abs(dif) < 1e-9) return '<span class="var var--igual">Sin cambio</span>';
        var flecha = ic(dif > 0 ? 'arrow-up' : 'arrow-down');
        var signo = dif > 0 ? '+' : '−';
        var abs = Math.abs(dif);
        var texto;
        if (tipo === 'pct') texto = signo + num(abs, 1) + ' pts';
        else if (tipo === 'dur') texto = signo + SMS.duracionDias(abs);
        else texto = signo + num(abs) + (b ? ' (' + signo + num(Math.abs(dif / b) * 100, 0) + ' %)' : '');
        return '<span class="var">' + flecha + '<span>' + texto + '</span></span>';
    }
    function comparativo(cont, d) {
        var a = d.actual, b = d.anterior;
        var fila = function (nombre, ayuda, va, vb, tipo, fmt) {
            fmt = fmt || function (v) { return v == null ? '<span class="nd">Sin datos</span>' : num(v); };
            return '<tr><th scope="row">' + nombre + (ayuda ? '<small>' + ayuda + '</small>' : '') + '</th>' +
                '<td class="num">' + fmt(va) + '</td><td class="num">' + fmt(vb) + '</td><td class="num">' + variacion(va, vb, tipo) + '</td></tr>';
        };
        var pct = function (v) { return v == null ? '<span class="nd">Sin datos</span>' : num(v, 1) + ' %'; };
        var dur = function (v) { return v == null ? '<span class="nd">Sin datos</span>' : SMS.duracionDias(v); };
        cont.innerHTML = '<div class="tabla-resp"><table class="tabla-comp">' +
            '<caption class="sr-only">Comparación de indicadores entre dos periodos</caption>' +
            '<thead><tr><th scope="col">Indicador</th>' +
            '<th scope="col" class="num">Periodo<span class="sub">' + rangoTexto(a.desde, a.hasta) + '</span></th>' +
            '<th scope="col" class="num">' + (d.modo === 'anio' ? 'Mismo periodo, año anterior' : 'Periodo anterior') + '<span class="sub">' + rangoTexto(b.desde, b.hasta) + '</span></th>' +
            '<th scope="col" class="num">Variación</th></tr></thead><tbody>' +
            fila('Reportes recibidos', 'Por fecha del reporte', a.recibidos, b.recibidos) +
            fila('Ya cerrados', 'De los recibidos en el periodo', a.cerrados, b.cerrados) +
            fila('Porcentaje cerrado', null, a.porcentaje_cerrados, b.porcentaje_cerrados, 'pct', pct) +
            fila('Resueltos en el periodo', 'Por fecha de resolución', a.resueltos, b.resueltos) +
            fila('Tiempo de resolución · mediana', 'De los resueltos en el periodo', a.dias_mediana_resolucion, b.dias_mediana_resolucion, 'dur', dur) +
            fila('Tiempo de resolución · promedio', null, a.dias_promedio_resolucion, b.dias_promedio_resolucion, 'dur', dur) +
            fila('Con evaluación de riesgo', 'De los recibidos', a.evaluados, b.evaluados) +
            fila('Alto riesgo', 'De los recibidos', a.alto_riesgo, b.alto_riesgo) +
            fila('Cerrados en plazo', 'De los cerrados en el periodo que tenían plazo', a.porcentaje_en_plazo, b.porcentaje_en_plazo, 'pct', pct) +
            fila('Acciones correctivas concluidas', null, a.acciones_concluidas, b.acciones_concluidas) +
            '</tbody></table></div>';
    }

    // ------------------------------------------------------- desempeño
    function desempeno(cont, d, opciones) {
        opciones = opciones || {};
        if (!d.total.total) { SMSGraficas.vacio(cont, 'Sin reportes con estos filtros', '', 'building'); return; }
        var celdas = function (x) {
            var na = function (v, sufijo) { return v == null ? '<span class="nd">—</span>' : num(v, 1) + (sufijo || ''); };
            return '<td class="num">' + num(x.total) + '</td>' +
                '<td class="num">' + num(x.abiertos) + '</td>' +
                '<td class="num">' + num(x.cerrados) + '<span class="sub">' + na(x.porcentaje_cierre, ' %') + '</span></td>' +
                '<td class="num">' + (x.dias_resolucion == null ? '<span class="nd">—</span>' : SMS.duracionDias(x.dias_resolucion)) + '</td>' +
                '<td class="num">' + (x.vencidos ? '<strong style="color:var(--r600)">' + num(x.vencidos) + '</strong>' : '0') + '</td>' +
                (opciones.compacto ? '' : '<td class="num">' + num(x.sin_plazo) + '</td>') +
                '<td class="num">' + (x.cerrados_con_plazo ? na(x.porcentaje_en_plazo, ' %') + '<span class="sub">' + x.cerrados_con_plazo + ' con plazo</span>' : '<span class="nd">—</span>') + '</td>' +
                '<td class="num">' + num(x.pendientes_evaluar) + '</td>' +
                '<td class="num">' + (x.acciones ? num(x.acciones_abiertas) + ' / ' + num(x.acciones) + (x.acciones_vencidas ? '<span class="sub" style="color:var(--r600)">' + x.acciones_vencidas + ' vencida(s)</span>' : '') : '<span class="nd">—</span>') + '</td>';
        };
        var filas = d.areas.map(function (a) {
            return '<tr><th scope="row">' + (opciones.enlaces ? '<a href="/reportes/general?responsable=' + a.id + '">' + esc(a.nombre) + '</a>' : esc(a.nombre)) + (a.activo ? '' : (opciones.compacto ? ' <span class="sub" style="display:inline">(inactiva)</span>' : '<small>Área inactiva (histórica)</small>')) + '</th>' + celdas(a) + '</tr>';
        }).join('');
        if (d.sin_area.total) filas += '<tr><th scope="row"><em style="font-style:normal;color:var(--n600)">Sin área responsable</em><small>Solo áreas notificadas</small></th>' + celdas(d.sin_area) + '</tr>';
        cont.innerHTML = '<div class="tabla-resp"><table class="tabla-comp">' +
            '<caption class="sr-only">Desempeño por área responsable</caption>' +
            '<thead><tr><th scope="col">Área responsable</th><th scope="col" class="num">Reportes</th><th scope="col" class="num">Abiertos</th>' +
            '<th scope="col" class="num">Cerrados</th><th scope="col" class="num">Resolución<span class="sub">promedio</span></th>' +
            '<th scope="col" class="num">Vencidos</th>' + (opciones.compacto ? '' : '<th scope="col" class="num">Sin plazo</th>') + '<th scope="col" class="num">En plazo<span class="sub">de los cerrados</span></th>' +
            '<th scope="col" class="num">Por evaluar</th><th scope="col" class="num">Acciones<span class="sub">abiertas / total</span></th></tr></thead>' +
            '<tbody>' + filas + '</tbody>' +
            '<tfoot><tr><th scope="row">Total · reportes únicos</th>' + celdas(d.total) + '</tr></tfoot></table></div>' +
            '<p class="sg-help" style="margin-top:10px">Un reporte con dos áreas responsables cuenta en cada una; el total cuenta cada reporte una sola vez, por eso puede ser menor que la suma de las filas.</p>';
    }

    // ----------------------------------------------------- recurrencias
    function barra(n, abiertos, max) {
        var cer = n - abiertos;
        return '<div class="rec-barra" aria-hidden="true">' +
            (cer ? '<i style="width:' + (cer / max * 100) + '%"></i>' : '') +
            (abiertos ? '<i class="abiertos" style="width:' + (abiertos / max * 100) + '%"></i>' : '') + '</div>';
    }
    function recurrencias(contCat, contLug, d, opciones) {
        opciones = opciones || {};
        var limite = opciones.limite || 8;
        var chip = '<span class="chip-rec" data-tip="Al menos ' + d.umbral + ' reportes en ' + d.ventana_dias + ' días">' + ic('repeat') + 'Recurrente</span>';
        var cats = d.categorias.slice(0, limite);
        var maxC = Math.max.apply(null, cats.map(function (c) { return c.n; }).concat([1]));
        contCat.innerHTML = cats.length ? '<ul class="rec-lista">' + cats.map(function (c) {
            return '<li class="rec-item"><div><b>' + (opciones.enlaces ? '<a href="/reportes/general?categoria=' + encodeURIComponent(c.categoria) + '" style="color:inherit">' + esc(c.categoria) + '</a>' : esc(c.categoria)) + '</b>' + (c.recurrente ? chip : '') + '</div>' +
                '<div class="rec-n">' + num(c.en_ventana) + '<small>en ' + d.ventana_dias + ' días</small></div>' +
                barra(c.n, c.abiertos, maxC) +
                '<div class="meta">' + num(c.n) + ' en el periodo · ' + num(c.abiertos) + ' abierto' + (c.abiertos === 1 ? '' : 's') + ' · último ' + SMS.fecha(c.ultima) + '</div></li>';
        }).join('') + '</ul>' : '<p class="nd">Sin reportes en el periodo.</p>';

        var lugares = (d.zonas && d.zonas.grupos.length ? d.zonas.grupos : d.lugares).slice(0, limite);
        var maxL = Math.max.apply(null, lugares.map(function (c) { return c.n; }).concat([1]));
        contLug.innerHTML = lugares.length ? '<ul class="rec-lista">' + lugares.map(function (g) {
            var variantes = g.textos && g.textos.length > 1 ? ' · agrupa: “' + g.textos.slice(0, 3).map(esc).join('”, “') + '”' + (g.textos.length > 3 ? '…' : '') : '';
            return '<li class="rec-item"><div><b>' + esc(g.etiqueta) + '</b>' + (g.recurrente ? chip : '') + '</div>' +
                '<div class="rec-n">' + num(g.en_ventana) + '<small>en ' + d.ventana_dias + ' días</small></div>' +
                barra(g.n, g.abiertos, maxL) +
                '<div class="meta">' + num(g.n) + ' en el periodo · ' + num(g.abiertos) + ' abierto' + (g.abiertos === 1 ? '' : 's') +
                (g.categorias.length ? ' · ' + g.categorias.map(function (c) { return esc(c.nombre) + ' (' + c.n + ')'; }).join(', ') : '') + variantes +
                (opciones.enlaces && g.folios.length ? '<br>Folios recientes: ' + g.folios.map(function (f) { return '<a href="/reportes/' + encodeURIComponent(f) + '">' + esc(f) + '</a>'; }).join(', ') : '') +
                '</div></li>';
        }).join('') + '</ul>' : '<p class="nd">Sin lugares registrados en el periodo.</p>';
    }

    // ------------------------------------------------------------- SPI
    function formatoSPI(s) {
        return function (v) {
            if (v == null) return 'Sin datos';
            if (s.formato === 'porcentaje') return num(v, 1) + ' %';
            if (s.formato === 'decimal') return num(v, 2) + ' ' + s.unidad;
            return num(v);
        };
    }
    function spi(cont, d, opciones) {
        opciones = opciones || {};
        if (!d.indicadores.length) {
            cont.innerHTML = '<div class="sg-empty" style="padding:28px 16px">' + ic('gauge') + '<b>No hay indicadores SPI configurados</b>' +
                (d.configurados ? 'Todos los indicadores están inactivos.' : 'Los SPI, sus metas y niveles de alerta los define la Gerencia de SMS. Mientras no se configuren no se muestran metas.') +
                (opciones.enlaceConfig ? '<div style="margin-top:12px"><a class="btn btn-secondary btn-sm" href="/admin/spi">' + ic('settings') + 'Configuración de SPI</a></div>' : '') + '</div>';
            return;
        }
        var ICONO = { meta: 'ok', vigilancia: 'warn', alerta: 'crit', sin_meta: 'minus', sin_datos: 'minus' };
        cont.innerHTML = '<div class="spi-grid">' + d.indicadores.map(function (s, i) {
            var f = formatoSPI(s);
            var v = s.actual ? s.actual.valor : null;
            var partes = String(f(v)).split(' ');
            var valorHTML = v == null ? '<span class="nd" style="font-size:20px">Sin datos</span>' : esc(partes[0]) + (partes.length > 1 ? '<small>' + esc(partes.slice(1).join(' ')) + '</small>' : '');
            var base = s.actual && s.actual.denominador && s.formato === 'porcentaje' ? s.actual.numerador + ' de ' + s.actual.denominador : '';
            return '<article class="spi">' +
                '<div class="spi__n">' + esc(s.nombre) + '<small>' + esc(s.metrica_nombre) + (s.categoria ? ' · ' + esc(s.categoria) : '') + '</small></div>' +
                '<div class="spi__top"><div class="spi__v">' + valorHTML + '<span class="mes">' + (s.actual ? SMS.mes(s.actual.mes) : '') + (base ? ' · ' + base : '') + '</span></div>' +
                '<span class="spi-estado spi-estado--' + s.estado + '">' + ic(ICONO[s.estado] || 'minus') + esc(s.etiqueta) + '</span></div>' +
                '<div class="viz" id="spi-g-' + i + '"></div>' +
                '<div class="spi__meta">' +
                (s.meta != null ? '<span><i></i>Meta: ' + (s.direccion === 'menor' ? '≤ ' : '≥ ') + f(s.meta) + '</span>' : '<span>Sin meta</span>') +
                (s.alerta != null ? '<span><i class="alerta"></i>Alerta: ' + (s.direccion === 'menor' ? '≥ ' : '≤ ') + f(s.alerta) + '</span>' : '') +
                '<span>' + (s.direccion === 'menor' ? 'Menor es mejor' : 'Mayor es mejor') + '</span>' +
                '<button type="button" class="ayuda" data-tip="' + esc(s.definicion + (s.descripcion ? ' ' + s.descripcion : '')) + '" aria-label="Definición del indicador">' + ic('help') + '</button></div>' +
                '</article>';
        }).join('') + '</div>' +
        (d.validado ? '<p class="sg-help" style="margin-top:10px">' + ic('user-check', 'ic-16') + ' Configuración validada' + (d.validado_por ? ' por ' + esc(d.validado_por) : '') + (d.fecha_validacion ? ' el ' + SMS.fecha(d.fecha_validacion) : '') + '.</p>'
            : '<p class="sg-help" style="margin-top:10px">' + ic('warn', 'ic-16') + ' Las metas de estos indicadores aún no están marcadas como validadas institucionalmente.</p>');
        d.indicadores.forEach(function (s, i) {
            SMSGraficas.spi(document.getElementById('spi-g-' + i), {
                etiquetas: s.serie.map(function (x) { return x.mes; }),
                valores: s.serie.map(function (x) { return x.valor; }),
                formatoX: SMS.mes, formatoV: formatoSPI(s), meta: s.meta, alerta: s.alerta, nombre: s.nombre,
                descripcion: s.nombre + ' por mes', alto: opciones.alto || 110
            });
        });
    }

    // ---------------------------------------------------------- calidad
    function calidad(cont, d) {
        var c = d.coherencia, t = d.totales;
        var cuadra = c.total_igual_abiertos_mas_cerrados && c.abiertos_igual_nuevos_mas_atencion && c.cerrados_igual_suma_de_cierres;
        var html = '<div class="calidad">' +
            '<div class="calidad__item ' + (cuadra ? 'ok' : 'revisar') + '">' + ic(cuadra ? 'ok' : 'warn') +
            '<div><b>Cuadre de cifras</b><p>' + pl(t.total, 'reporte', 'reportes') + ' = ' + pl(t.abiertos, 'abierto', 'abiertos') + ' (' + pl(t.nuevos, 'nuevo', 'nuevos') + ' + ' + num(t.en_atencion) + ' en atención) + ' +
            pl(t.cerrados, 'cerrado', 'cerrados') + ' (' + pl(t.resueltos, 'resuelto', 'resueltos') + ' + ' + pl(t.duplicados, 'duplicado', 'duplicados') + ' + ' + pl(t.no_requiere, 'no requiere atención', 'no requieren atención') + ').</p></div>' +
            '<span class="n">' + (cuadra ? 'Correcto' : 'Revisar') + '</span></div>';
        d.bloques.forEach(function (b) {
            var clase = b.n === 0 ? 'ok' : (b.gravedad === 'revisar' ? 'revisar' : '');
            html += '<div class="calidad__item ' + clase + '">' + ic(b.n === 0 ? 'ok' : (b.gravedad === 'revisar' ? 'warn' : 'info')) +
                '<div><b>' + esc(b.titulo) + '</b><p>' + esc(b.explicacion) + '</p></div>' +
                '<span class="n">' + num(b.n) + '</span>' +
                (b.n ? '<div class="folios">' + b.ejemplos.slice(0, 18).map(function (e) {
                    var extra = e.estado_registro ? ' (' + e.estado_registro + ' → ' + e.estado + ')' : '';
                    return '<a href="/reportes/' + encodeURIComponent(e.folio) + '" data-tip="' + esc(e.folio + extra) + '">' + esc(e.folio) + esc(extra) + '</a>';
                }).join('') + (b.n > 18 ? '<span>y ' + (b.n - 18) + ' más</span>' : '') + '</div>' : '') +
                '</div>';
        });
        cont.innerHTML = html + '</div><p class="sg-help" style="margin-top:10px">Esta revisión solo informa: el sistema no modifica registros automáticamente. Las correcciones se registran como seguimientos para conservar la trazabilidad.</p>';
    }

    window.SMSAnalisis = { comparativo: comparativo, desempeno: desempeno, recurrencias: recurrencias, spi: spi, calidad: calidad, formatoSPI: formatoSPI, rangoTexto: rangoTexto };
})();
