/* S.A.G.A. · Exportación personalizable de la vista general (PDF y Excel)
   SMSExportar.abrir({ formato: 'pdf'|'xlsx', filtros, orden: { campo, dir } })

   La persona elige formato, periodo, indicadores, gráficas, columnas,
   orientación del PDF y qué secciones incluir. Los demás filtros activos de la
   vista (estatus, área, riesgo…) siempre se respetan.
   - Excel: lo arma el servidor (/api/sms/exportar.xlsx), que valida permisos;
     aquí se muestra el avance de la descarga.
   - PDF: se consultan los mismos endpoints que la vista general (todas las
     páginas del listado, sin cortes), se dibujan las gráficas fuera de la
     pantalla en tema claro, se convierten a PNG y el documento se arma en un
     Web Worker (public/js/sms-pdf-worker.js) para no congelar la página.
   Reglas compartidas con el servidor: public/js/sms-exportacion.js           */
(function () {
    'use strict';

    var X = window.SMSExportacion;
    var esc = SMS.esc, ic = SMS.ic, num = SMS.numero;
    var CLAVE_PREFS = 'sms-exportacion-v1';
    var POR_PAGINA = 100, CONCURRENCIA = 4;
    var PERIODOS = [
        ['vista', 'El de la vista'], ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'],
        ['mes', 'Mes actual'], ['mes_anterior', 'Mes anterior'], ['90', 'Últimos 90 días'], ['anio', 'Este año'],
        ['todo', 'Todo el historial'], ['personalizado', 'Rango personalizado']
    ];

    // ------------------------------------------------------- preferencias
    function leerPrefs() { try { return JSON.parse(localStorage.getItem(CLAVE_PREFS)) || {}; } catch (e) { return {}; } }
    function guardarPrefs(p) { try { localStorage.setItem(CLAVE_PREFS, JSON.stringify(p)); } catch (e) { /* opcional */ } }

    // ---------------------------------------------------------- utilidades
    var scripts = {};
    function cargarScript(src) {
        if (!scripts[src]) {
            scripts[src] = new Promise(function (ok, mal) {
                var s = document.createElement('script');
                s.src = src;
                s.onload = ok;
                s.onerror = function () { delete scripts[src]; mal(new Error('No se pudo cargar ' + src)); };
                document.head.appendChild(s);
            });
        }
        return scripts[src];
    }
    function qsDe(filtros, extra) {
        var q = new URLSearchParams();
        Object.keys(filtros).forEach(function (k) { if (filtros[k]) q.set(k, filtros[k]); });
        if (extra) Object.keys(extra).forEach(function (k) { if (extra[k] != null) q.set(k, extra[k]); });
        return q;
    }
    function tamano(n) { return n < 1048576 ? num(Math.max(1, n / 1024), 0) + ' KB' : num(n / 1048576, 1) + ' MB'; }
    function descargarBlob(blob, nombre) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    }
    function cuadro() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
    function errorCancelado() { var e = new Error('Exportación cancelada'); e.name = 'AbortError'; return e; }
    function comprobar(senal) { if (senal.aborted) throw errorCancelado(); }

    /** Filtros de la exportación: los de la vista con el periodo elegido en el diálogo. */
    function filtrosConPeriodo(base, periodo, desde, hasta) {
        var f = Object.assign({}, base);
        if (periodo === 'vista') return f;
        delete f.fecha; delete f.desde; delete f.hasta;
        if (periodo === 'todo') return f;
        if (periodo === 'personalizado') { if (desde) f.desde = desde; if (hasta) f.hasta = hasta; return f; }
        var r = SMS.rangoPeriodo(periodo);
        if (r) { f.desde = r.desde; f.hasta = r.hasta; }
        return f;
    }

    // ----------------------------------------------- imágenes institucionales
    function imagenDeCanvas(cv) {
        return new Promise(function (ok, mal) {
            cv.toBlob(function (b) {
                if (!b) return mal(new Error('No se pudo preparar una imagen'));
                b.arrayBuffer().then(function (ab) { ok({ datos: new Uint8Array(ab), w: cv.width, h: cv.height }); }, mal);
            }, 'image/png');
        });
    }
    function logotipo() {
        // El mismo logotipo del encabezado del sistema, rasterizado para el PDF.
        // Se carga desde su URL (la política de contenido no permite imágenes blob:).
        return new Promise(function (ok, mal) {
            var img = new Image();
            img.onload = function () {
                var h = 160, w = Math.round(h * (img.naturalWidth || 787.5) / (img.naturalHeight || 104));
                var cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                imagenDeCanvas(cv).then(ok, mal);
            };
            img.onerror = function () { mal(new Error('logo')); };
            img.src = '/img/aifa-horizontal-positivo.svg';
        }).catch(function () { return null; });
    }
    function estela() {
        var cv = document.createElement('canvas');
        cv.width = 1200; cv.height = 8;
        var ctx = cv.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, 1200, 0);
        [[0, '#078C72'], [0.22, '#2FB295'], [0.44, '#D4D9DC'], [0.5, '#EEF0F2'], [0.56, '#D4D9DC'], [0.78, '#E05269'], [1, '#CF324C']]
            .forEach(function (s) { g.addColorStop(s[0], s[1]); });
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1200, 8);
        return imagenDeCanvas(cv).catch(function () { return null; });
    }
    var recursos = null;
    function cargarRecursos() {
        if (!recursos) recursos = Promise.all([logotipo(), estela()]).then(function (r) { return { logo: r[0], estela: r[1] }; });
        return recursos;
    }
    function copiaImagen(i) { return i ? { datos: i.datos.slice(), w: i.w, h: i.h } : null; }

    // ------------------------------------------------- consulta de datos (PDF)
    async function consultarDatos(op, filtros, orden, senal, ui) {
        var api = function (ruta, extra) { return SMS.api(ruta + '?' + qsDe(filtros, extra).toString(), { signal: senal }); };
        var ordenQ = { orden: orden.campo, dir: orden.dir };
        ui.avance(0.03, 'Indicadores, gráficas y primera página del listado');
        var r = await Promise.all([
            api('/api/sms/indicadores', { comparar: '1' }),
            api('/api/sms/analisis'),
            api('/api/sms/reportes', Object.assign({ por_pagina: op.contenido.detalle ? POR_PAGINA : 10, pagina: 1 }, ordenQ))
        ]);
        var primera = r[2], total = primera.paginacion.total;
        var filas = [], truncado = null;
        if (op.contenido.detalle && total) {
            // Todas las páginas: el listado nunca queda incompleto por la paginación
            var objetivo = Math.min(total, X.LIMITE_FILAS);
            if (total > X.LIMITE_FILAS) truncado = { exportados: X.LIMITE_FILAS, total: total };
            var paginas = Math.ceil(objetivo / POR_PAGINA);
            var partes = new Array(paginas);
            partes[0] = primera.reportes;
            var cargadas = primera.reportes.length, siguiente = 2;
            var mostrar = function () { ui.avance(0.05 + 0.3 * Math.min(1, cargadas / objetivo), 'Listado: ' + num(Math.min(cargadas, objetivo)) + ' de ' + num(objetivo) + ' reportes'); };
            mostrar();
            var trabajador = async function () {
                while (siguiente <= paginas) {
                    var p = siguiente++;
                    var d = await api('/api/sms/reportes', Object.assign({ por_pagina: POR_PAGINA, pagina: p }, ordenQ));
                    partes[p - 1] = d.reportes;
                    cargadas += d.reportes.length;
                    mostrar();
                }
            };
            var hilos = [];
            for (var i = 0; i < Math.min(CONCURRENCIA, paginas - 1); i++) hilos.push(trabajador());
            await Promise.all(hilos);
            var vistos = {};
            partes.forEach(function (lst) { (lst || []).forEach(function (f) { if (!vistos[f.id]) { vistos[f.id] = true; filas.push(f); } }); });
            filas = filas.slice(0, objetivo);
        }
        return {
            indicadores: r[0].indicadores, comparacion: r[0].comparacion || null, analisis: r[1],
            filas: filas, truncado: truncado, total: total,
            filtrosActivos: primera.filtros_activos, hoy: primera.hoy, diasAviso: primera.dias_aviso
        };
    }

    // ------------------------------------------- gráficas fuera de la pantalla
    // Tokens claros de saga.css/sms.css: el PDF siempre sale en tema claro
    function tokensClaros() {
        var t = {};
        Array.prototype.forEach.call(document.styleSheets, function (h) {
            var reglas;
            try { reglas = h.cssRules; } catch (e) { return; }
            Array.prototype.forEach.call(reglas || [], function (r) {
                if (r.type !== 1 || r.selectorText !== ':root') return;
                for (var i = 0; i < r.style.length; i++) {
                    var p = r.style[i];
                    if (p.indexOf('--') === 0) t[p] = r.style.getPropertyValue(p).trim();
                }
            });
        });
        return t;
    }
    var GRUPOS = [
        { campo: 'nuevos', nombre: 'Nuevos', color: 'var(--g-nuevo)' },
        { campo: 'atencion', nombre: 'En atención', color: 'var(--g-atencion)' },
        { campo: 'resueltos', nombre: 'Resueltos', color: 'var(--g-resuelto)' },
        { campo: 'sin_accion', nombre: 'Cerrados sin acción', color: 'var(--g-sinaccion)' }
    ];
    var NOMBRE_GRAN = { dia: 'día', semana: 'semana', mes: 'mes' };
    var fmtCortaUTC = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    function etiquetaEje(c, g) { return g === 'mes' ? SMS.mes(c.clave) : fmtCortaUTC.format(new Date(c.desde + 'T12:00:00Z')).replace(/\./g, ''); }
    function pctTxt(x, y) { return y ? Math.round(x / y * 100) + ' %' : '0 %'; }

    /** Mismas gráficas que el análisis estadístico, sin interacción. */
    function definicionesGraficas(resp, filtros) {
        var a = resp.analisis, G = SMSGraficas, SS = SMSSeries, hoy = SMS.diaLocal();
        var tiempo = null;
        if (Array.isArray(a.diario) && Array.isArray(a.cierres_diarios)) {
            var base = SS.rangoEfectivo(filtros, a.diario, hoy);
            if (base) {
                var r = filtros.hasta || filtros.fecha ? base : SS.rangoFlujo(base, a.cierres_diarios, hoy);
                var p = SS.periodos(r.desde, r.hasta, SS.granularidad(r.desde, r.hasta));
                var cub = SS.agrupar(a.diario, a.cierres_diarios, p.cubetas);
                var porClave = {};
                cub.forEach(function (c) { porClave[c.clave] = c; });
                tiempo = { base: base, r: r, g: p.gran, cub: cub, eje: function (k) { return etiquetaEje(porClave[k], p.gran); } };
            }
        }
        var sinTiempo = { vacio: 'Sin reportes en el periodo del documento.' };
        var sinFecha = a.cerrados_sin_fecha > 0 ? ' ' + num(a.cerrados_sin_fecha) + ' reporte(s) cerrados sin registro de cierre no tienen fecha y no aparecen como cerrados.' : '';
        var est = {};
        a.por_estatus.forEach(function (e) { est[e.estado] = e.n; });
        return {
            evolucion: function (el) {
                if (!tiempo) return sinTiempo;
                var t = tiempo;
                G.lineas(el, {
                    etiquetas: t.cub.map(function (c) { return c.clave; }), formatoX: t.eje, tituloX: 'Periodo', alto: 230,
                    series: [
                        { nombre: 'Recibidos', color: 'var(--g-recibidos)', valores: t.cub.map(function (c) { return c.recibidos; }) },
                        { nombre: 'Cerrados', color: 'var(--g-cerrados)', valores: t.cub.map(function (c) { return c.cerrados; }) }
                    ]
                });
                return { nota: 'Agrupado por ' + NOMBRE_GRAN[t.g] + ' · ' + X.rangoTexto(t.r.desde, t.r.hasta) + '.' + sinFecha };
            },
            periodos: function (el) {
                if (!tiempo) return sinTiempo;
                var t = tiempo;
                G.columnas(el, {
                    etiquetas: t.cub.map(function (c) { return c.clave; }), formatoX: t.eje, alto: 250,
                    series: GRUPOS.map(function (x) { return { nombre: x.nombre, color: x.color, valores: t.cub.map(function (c) { return c[x.campo]; }) }; }),
                    detalleCorto: t.g === 'mes' ? function (i) { var c = t.cub[i]; return c.recibidos ? pctTxt(c.resueltos + c.sin_accion, c.recibidos) + ' cerrado' : ''; } : null
                });
                var rec = t.cub.reduce(function (s, c) { return s + c.recibidos; }, 0);
                var cer = t.cub.reduce(function (s, c) { return s + c.resueltos + c.sin_accion; }, 0);
                return { nota: 'Agrupado por ' + NOMBRE_GRAN[t.g] + '. Se recibieron ' + num(rec) + ' reportes; ' + num(cer) + ' ya están cerrados (' + pctTxt(cer, rec) + ') y ' + num(rec - cer) + ' siguen abiertos.' };
            },
            flujo: function (el) {
                if (!tiempo) return sinTiempo;
                var rf = SS.rangoFlujo(tiempo.base, a.cierres_diarios, hoy);
                var pf = SS.periodos(rf.desde, rf.hasta, SS.granularidad(rf.desde, rf.hasta));
                var ac = SS.acumulado(a.diario, a.cierres_diarios, pf.cubetas);
                if (!ac.length) return sinTiempo;
                var porClave = {};
                pf.cubetas.forEach(function (c) { porClave[c.clave] = c; });
                G.lineas(el, {
                    etiquetas: ac.map(function (c) { return c.clave; }), formatoX: function (k) { return etiquetaEje(porClave[k], pf.gran); },
                    tituloX: 'Al cierre de', alto: 230, areas: true,
                    series: [
                        { nombre: 'Recibidos acumulados', color: 'var(--g-recibidos)', valores: ac.map(function (c) { return c.recibidos; }) },
                        { nombre: 'Cerrados acumulados', color: 'var(--g-cerrados)', valores: ac.map(function (c) { return c.cerrados; }) }
                    ]
                });
                var u = ac[ac.length - 1];
                return { nota: 'Al ' + X.fecha(u.hasta) + ': ' + num(u.recibidos) + ' recibidos, ' + num(u.cerrados) + ' cerrados y ' + num(u.pendientes) + ' pendientes.' + sinFecha };
            },
            estatus: function (el) {
                var total = a.por_estatus.reduce(function (s, e) { return s + e.n; }, 0);
                if (!total) return { vacio: 'Sin reportes con los filtros del documento.' };
                G.dona(el, {
                    partes: [
                        { clave: 'A', nombre: 'Nuevos', valor: est.A || 0, color: 'var(--g-nuevo)', detalle: 'A · Generado' },
                        { clave: 'atencion', nombre: 'En atención', valor: (est.B || 0) + (est.C || 0), color: 'var(--g-atencion)', detalle: 'B · Enterado ' + num(est.B || 0) + ' · C · En atención ' + num(est.C || 0) },
                        { clave: 'D', nombre: 'Resueltos', valor: est.D || 0, color: 'var(--g-resuelto)', detalle: 'D · Resuelto' },
                        { clave: 'sin_accion', nombre: 'Cerrados sin acción', valor: (est.E || 0) + (est.F || 0), color: 'var(--g-sinaccion)', detalle: 'E · Duplicado ' + num(est.E || 0) + ' · F · No requiere ' + num(est.F || 0) }
                    ]
                });
                return {};
            },
            horas: function (el) {
                if (!Array.isArray(a.por_hora)) return { vacio: 'Gráfica no disponible en esta versión del servidor.' };
                var totalH = a.por_hora.reduce(function (s, h) { return s + h.n; }, 0);
                if (!totalH) return { vacio: 'Sin reportes con los filtros del documento.' };
                var pico = a.por_hora.reduce(function (m, h) { return h.n > m.n ? h : m; }, { n: -1 });
                var hh = function (h) { return (h < 10 ? '0' : '') + h; };
                G.columnas(el, {
                    etiquetas: a.por_hora.map(function (h) { return h.hora; }), formatoX: function (h) { return hh(h) + ' h'; }, alto: 220,
                    series: [{ nombre: 'Reportes', color: 'var(--s1)', valores: a.por_hora.map(function (h) { return h.n; }) }]
                });
                return { nota: 'Hora con más reportes: ' + hh(pico.hora) + ':00–' + hh(pico.hora) + ':59 (' + num(pico.n) + ', ' + Math.round(pico.n / totalH * 100) + ' % del total).' };
            },
            tendencia: function (el) {
                if (!a.mensual.some(function (m) { return m.dias_promedio_resolucion != null; })) return { vacio: 'Aún no hay reportes resueltos en el periodo del documento.' };
                G.lineas(el, {
                    etiquetas: a.mensual.map(function (m) { return m.mes; }), formatoX: SMS.mes, tituloX: 'Mes', alto: 220,
                    formatoY: function (v) { return num(v, 1) + ' d'; },
                    series: [{ nombre: 'Días promedio de resolución', color: 'var(--s1)', valores: a.mensual.map(function (m) { return m.dias_promedio_resolucion; }) }]
                });
                return {};
            },
            areas: function (el) {
                if (!a.por_area.length) return { vacio: 'Sin áreas con reportes con los filtros del documento.' };
                G.barras(el, {
                    series: [{ nombre: 'Abiertos', color: 'var(--s2)' }, { nombre: 'Cerrados', color: 'var(--s1)' }],
                    filas: a.por_area.map(function (x) { return { clave: x.id, nombre: x.nombre + (x.activo ? '' : ' (inactiva)'), valores: [x.abiertos, x.cerrados] }; })
                });
                return { nota: 'Un reporte con varias áreas cuenta en cada una.' };
            },
            categorias: function (el) {
                if (!a.categorias.length) return { vacio: 'Sin categorías con los filtros del documento.' };
                G.barras(el, {
                    series: [{ nombre: 'Reportes', color: 'var(--s1)' }],
                    filas: a.categorias.map(function (c) { return { clave: c.categoria, nombre: c.categoria, valores: [c.n] }; })
                });
                return {};
            },
            riesgo: function (el, otro) {
                var evaluados = a.riesgo.celdas.reduce(function (s, c) { return s + c.n; }, 0);
                if (!evaluados) return { vacio: 'Aún no hay reportes con evaluación de riesgo (' + num(a.riesgo.sin_evaluar) + ' sin evaluar).' };
                G.matriz(el, { matriz: resp.matriz, conteos: a.riesgo.celdas });
                G.barras(otro(), {
                    series: [{ nombre: 'Reportes', color: 'var(--s1)' }],
                    filas: a.riesgo.niveles.map(function (n) { return { clave: n.clave, nombre: n.nombre, valores: [n.n] }; })
                        .concat([{ clave: 'sin_evaluar', nombre: 'Sin evaluar', valores: [a.riesgo.sin_evaluar] }])
                });
                return { nota: resp.matriz.validada ? 'Matriz de riesgo validada institucionalmente.' : 'Matriz con los criterios del Manual SMS (numeral 5.3), pendiente de confirmar en el sistema.' };
            }
        };
    }

    // Ancho máximo (px) de gráficas que se ven mejor compactas
    var ANCHO_MAX = { estatus: 640 };
    async function dibujarGraficas(claves, resp, filtros, anchoRef, horizontal, senal, ui) {
        await Promise.all([cargarScript('/js/sms-series.js'), cargarScript('/js/sms-graficas.js')]);
        var defs = definicionesGraficas(resp, filtros);
        var lienzo = document.createElement('div');
        lienzo.setAttribute('aria-hidden', 'true');
        lienzo.style.cssText = 'position:fixed;left:-30000px;top:0;width:' + anchoRef + 'px;pointer-events:none;contain:layout style;';
        var tokens = tokensClaros();
        Object.keys(tokens).forEach(function (k) { lienzo.style.setProperty(k, tokens[k]); });
        lienzo.style.color = 'var(--n800)';
        lienzo.style.background = '#fff';
        lienzo.style.colorScheme = 'light';
        document.body.appendChild(lienzo);
        var salida = [];
        try {
            for (var i = 0; i < claves.length; i++) {
                comprobar(senal);
                var k = claves[i], info = X.GRAFICAS.filter(function (g) { return g.k === k; })[0];
                ui.avance(0.36 + 0.22 * i / claves.length, 'Gráfica ' + (i + 1) + ' de ' + claves.length + ': ' + info.t);
                // En horizontal, las compactas van a media hoja (8 mm de separación); el ancho se fija antes de dibujar
                var mitad = horizontal && !!info.media;
                var ancho = Math.min(mitad ? Math.floor((anchoRef - anchoRef * 8 / 269) / 2) : anchoRef, ANCHO_MAX[k] || anchoRef);
                var caja = document.createElement('div');
                // Margen derecho: las etiquetas del último periodo pueden salir del área de la gráfica
                caja.style.cssText = 'width:' + ancho + 'px;background:#fff;padding:4px 18px 2px 2px;box-sizing:border-box;';
                var viz = document.createElement('div');
                viz.className = 'viz';
                caja.appendChild(viz);
                lienzo.appendChild(caja);
                var r;
                try {
                    r = defs[k](viz, function () { var v = document.createElement('div'); v.className = 'viz'; v.style.marginTop = '18px'; caja.appendChild(v); return v; }) || {};
                } catch (e) {
                    r = { vacio: 'No se pudo dibujar esta gráfica: ' + e.message };
                }
                if (r.vacio) { salida.push({ k: k, titulo: info.t, sub: info.sub, vacio: r.vacio }); caja.remove(); continue; }
                // Sin animación de entrada: la imagen debe tomar el estado final
                caja.querySelectorAll('.viz-anim').forEach(function (s) { s.classList.remove('viz-anim'); });
                await cuadro();
                caja.querySelectorAll('.viz-anim').forEach(function (s) { s.classList.remove('viz-anim'); });
                var blob = await SMSGraficas.exportarPNG(caja, { descargar: false, escala: 2 });
                var bmp = await createImageBitmap(blob);
                var datos = new Uint8Array(await blob.arrayBuffer());
                salida.push({ k: k, titulo: info.t, sub: info.sub, nota: r.nota || '', img: { datos: datos, w: bmp.width, h: bmp.height }, anchoPx: ancho, anchoRef: anchoRef, mitad: mitad });
                if (bmp.close) bmp.close();
                caja.remove();
            }
        } finally {
            lienzo.remove();
        }
        return salida;
    }

    // -------------------------------------------------- armado del PDF
    function construirEnPagina(datos, ui) {
        return Promise.all([cargarScript('/vendor/jspdf.umd.min.js'), cargarScript('/vendor/jspdf.plugin.autotable.min.js'), cargarScript('/js/sms-pdf.js')])
            .then(cuadro)
            .then(function () {
                return window.SMSPdf.construir(datos, function (a) { ui.avance(0.6 + 0.37 * a.avance, a.texto); });
            });
    }
    function construirEnWorker(datos, ui, senal) {
        return new Promise(function (ok, mal) {
            var w;
            try { w = new Worker('/js/sms-pdf-worker.js'); } catch (e) { construirEnPagina(datos, ui).then(ok, mal); return; }
            var terminado = false;
            function fin() { terminado = true; w.terminate(); senal.removeEventListener('abort', alAbortar); }
            function alAbortar() { if (!terminado) { fin(); mal(errorCancelado()); } }
            senal.addEventListener('abort', alAbortar);
            w.onmessage = function (e) {
                var m = e.data || {};
                if (m.tipo === 'avance') ui.avance(0.6 + 0.37 * m.avance, m.texto);
                else if (m.tipo === 'listo') { fin(); ok(m); }
                else if (m.tipo === 'error') { fin(); mal(new Error('No se pudo armar el PDF: ' + m.mensaje)); }
            };
            // Si el worker no puede iniciar, el documento se arma en la página (más lento, mismo resultado)
            w.onerror = function (ev) {
                if (ev && ev.preventDefault) ev.preventDefault();
                if (terminado) return;
                fin();
                construirEnPagina(datos, ui).then(ok, mal);
            };
            // Se envía una copia (sin transferir): si hay que reintentar en la página, los datos siguen ahí
            w.postMessage({ tipo: 'construir', datos: datos });
        });
    }

    async function exportarPDF(op, filtros, ctx, sesion, ui) {
        var senal = ui.senal;
        var horizontal = X.orientacionPdf(op) === 'horizontal';
        var anchoRef = Math.round((horizontal ? 269 : X.ANCHO_UTIL_VERTICAL) / 25.4 * 96);
        ui.paso('datos');
        var precarga = op.graficas.length ? Promise.all([cargarScript('/js/sms-series.js'), cargarScript('/js/sms-graficas.js')]).catch(function () {}) : null;
        var d = await consultarDatos(op, filtros, ctx.orden, senal, ui);
        comprobar(senal);
        var graficas = [];
        if (op.graficas.length) {
            ui.paso('graficas');
            await precarga;
            graficas = await dibujarGraficas(op.graficas, d.analisis, filtros, anchoRef, horizontal, senal, ui);
        }
        comprobar(senal);
        ui.paso('documento');
        ui.avance(0.6, 'Preparando el documento');
        var rec = await cargarRecursos();
        var datos = {
            opciones: op,
            meta: {
                generado: new Date().toISOString(),
                usuario: sesion ? { nombre: sesion.nombre || sesion.username, departamento: sesion.departamento || '', rol: sesion.rol } : null,
                periodoTexto: X.periodoConsultado(filtros).texto,
                filtrosActivos: d.filtrosActivos, hoy: d.hoy, diasAviso: d.diasAviso,
                ordenTexto: X.ordenTexto(ctx.orden)
            },
            indicadores: d.indicadores, comparacion: d.comparacion,
            analisis: { por_estatus: d.analisis.analisis.por_estatus, por_area: d.analisis.analisis.por_area, categorias: d.analisis.analisis.categorias, riesgo: d.analisis.analisis.riesgo, cerrados_sin_fecha: d.analisis.analisis.cerrados_sin_fecha },
            matriz: { validada: d.analisis.matriz.validada, niveles: d.analisis.matriz.niveles },
            filas: d.filas, truncado: d.truncado,
            imagenes: { logo: copiaImagen(rec.logo), estela: copiaImagen(rec.estela) },
            graficas: graficas
        };
        var r = await construirEnWorker(datos, ui, senal);
        ui.paso('descarga');
        var blob = new Blob([r.buffer], { type: 'application/pdf' });
        var nombre = 'reporte-general-sms-aifa-' + SMS.diaLocal() + '.pdf';
        descargarBlob(blob, nombre);
        return { blob: blob, nombre: nombre, detalle: X.plural(r.paginas, 'página', 'páginas') + ' · ' + (r.horizontal ? 'horizontal' : 'vertical') + ' · ' + tamano(blob.size) };
    }

    async function exportarExcel(op, filtros, ctx, ui) {
        var q = qsDe(filtros, { orden: ctx.orden.campo, dir: ctx.orden.dir });
        X.opcionesAParametros(op, q);
        ui.paso('documento');
        ui.avance(null, 'El servidor consulta los datos y arma el libro');
        var cab = {};
        var t = SMS.token();
        if (t) cab.Authorization = 'Bearer ' + t;
        var r = await fetch('/api/sms/exportar.xlsx?' + q.toString(), { headers: cab, signal: ui.senal });
        if (!r.ok) {
            var msg = 'No se pudo generar el archivo';
            try { msg = (await r.json()).error || msg; } catch (e) { /* binario */ }
            throw new Error(msg);
        }
        ui.paso('descarga');
        var total = Number(r.headers.get('Content-Length')) || 0;
        var blob;
        if (r.body && r.body.getReader) {
            var lector = r.body.getReader(), partes = [], recibidos = 0;
            for (;;) {
                var x = await lector.read();
                if (x.done) break;
                partes.push(x.value);
                recibidos += x.value.length;
                ui.avance(total ? 0.6 + 0.4 * recibidos / total : null, 'Descargando ' + tamano(recibidos) + (total ? ' de ' + tamano(total) : ''));
            }
            blob = new Blob(partes, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        } else {
            blob = await r.blob();
        }
        var nombre = 'reportes-sms-aifa-' + SMS.diaLocal() + '.xlsx';
        descargarBlob(blob, nombre);
        var hojas = ['Resumen ejecutivo'];
        if (op.contenido.detalle) hojas.push('Datos generales');
        if (op.indicadores.length) hojas.push('Indicadores');
        if (op.contenido.comparativo) hojas.push('Comparativas');
        if (op.contenido.tablas) hojas.push('Distribuciones');
        hojas.push('Información de filtros');
        return { blob: blob, nombre: nombre, detalle: X.plural(hojas.length, 'hoja', 'hojas') + ' · ' + tamano(blob.size) };
    }

    // --------------------------------------------------------------- diálogo
    function casillas(nombre, items, elegidos) {
        return '<div class="exp-checks">' + items.map(function (it) {
            return '<label class="exp-check" data-k="' + esc(it.k) + '"><input type="checkbox" name="' + nombre + '" value="' + esc(it.k) + '"' +
                (elegidos.indexOf(it.k) >= 0 || it.fija ? ' checked' : '') + (it.fija ? ' disabled' : '') + '>' +
                '<span>' + esc(it.t) + (it.etiqueta ? ' <em class="exp-tag">' + esc(it.etiqueta) + '</em>' : '') +
                (it.d ? '<small>' + esc(it.d) + '</small>' : '') + '</span></label>';
        }).join('') + '</div>';
    }
    function rapidos(nombre, textos) {
        return '<span class="exp-rapidos"><button type="button" class="exp-mini" data-todas="' + nombre + '">' + textos[0] + '</button>' +
            '<button type="button" class="exp-mini" data-ninguna="' + nombre + '">' + textos[1] + '</button></span>';
    }

    async function abrir(ctx) {
        ctx = ctx || {};
        ctx.filtros = Object.assign({}, ctx.filtros || {});
        ctx.orden = ctx.orden || { campo: 'fecha', dir: 'desc' };
        if (document.querySelector('.exp-fondo')) return;
        var sesion = await SMS.sesion();
        var puedeDetalle = !!(sesion && sesion.capacidades && sesion.capacidades.indexOf('exportar_detalle') >= 0);
        var prefs = leerPrefs();
        var base = X.normalizarOpciones({}, { puedeDetalle: puedeDetalle });
        var st = {
            formato: ctx.formato === 'xlsx' || ctx.formato === 'pdf' ? ctx.formato : (prefs.formato || 'pdf'),
            indicadores: Array.isArray(prefs.indicadores) ? prefs.indicadores : base.indicadores,
            graficas: Array.isArray(prefs.graficas) ? prefs.graficas : X.GRAFICAS.filter(function (g) { return g.pdf; }).map(function (g) { return g.k; }),
            columnas: {
                pdf: (prefs.columnas && prefs.columnas.pdf) || X.normalizarOpciones({ formato: 'pdf' }, { puedeDetalle: puedeDetalle }).columnas,
                xlsx: (prefs.columnas && prefs.columnas.xlsx) || X.normalizarOpciones({ formato: 'xlsx' }, { puedeDetalle: puedeDetalle }).columnas
            },
            contenido: Object.assign({}, base.contenido, prefs.contenido || {}),
            orientacion: prefs.orientacion || 'auto'
        };
        var periodoVista = X.periodoConsultado(ctx.filtros).texto;
        var columnasVisibles = X.COLUMNAS.filter(function (c) { return !c.restringida || puedeDetalle; });

        var fondo = document.createElement('div');
        fondo.className = 'sg-backdrop show exp-fondo';
        fondo.innerHTML =
            '<div class="sg-dialog exp-dialogo" role="dialog" aria-modal="true" aria-labelledby="expT" aria-describedby="expD">' +
            '<div class="sg-dialog__head"><div><span class="sg-eyebrow">Vista general · exportación</span><h2 class="sg-dialog__title" id="expT">Exportar reporte</h2></div>' +
            '<button type="button" class="btn btn-ghost btn-icon" data-cerrar aria-label="Cerrar">' + ic('x') + '</button></div>' +
            '<div class="sg-dialog__body">' +
            '<form class="exp-form" novalidate>' +
            '<p class="sg-help" id="expD" style="margin:0 0 14px">Se exportan datos reales con los filtros activos de la vista. Elige qué incluir.</p>' +
            '<fieldset class="exp-bloque"><legend>Formato</legend><div class="exp-formatos">' +
            '<label class="exp-formato"><input type="radio" name="formato" value="pdf"><span class="exp-formato__ic">' + ic('print') + '</span><span><b>PDF</b><small>Documento institucional para presentar, imprimir y consultar</small></span></label>' +
            '<label class="exp-formato"><input type="radio" name="formato" value="xlsx"><span class="exp-formato__ic">' + ic('table') + '</span><span><b>Excel (.xlsx)</b><small>Hojas con datos, indicadores y fórmulas para analizar</small></span></label>' +
            '</div></fieldset>' +
            '<div class="exp-dos">' +
            '<div class="sg-field"><label for="expTitulo">Título del documento</label><input type="text" id="expTitulo" maxlength="' + X.MAX_TITULO + '" value="' + esc(X.TITULO) + '"></div>' +
            '<div class="sg-field"><label for="expPeriodo">Periodo</label><select id="expPeriodo">' +
            PERIODOS.map(function (p) { return '<option value="' + p[0] + '">' + esc(p[0] === 'vista' ? 'El de la vista · ' + periodoVista : p[1]) + '</option>'; }).join('') +
            '</select></div></div>' +
            '<div class="exp-rango" id="expRango" hidden><div class="sg-field"><label for="expDesde">Desde</label><input type="date" id="expDesde"></div><div class="sg-field"><label for="expHasta">Hasta</label><input type="date" id="expHasta"></div></div>' +
            '<p class="exp-info" id="expCuenta" aria-live="polite">' + ic('info') + '<span>Calculando…</span></p>' +
            '<fieldset class="exp-bloque"><legend>Indicadores ' + rapidos('indicadores', ['Todos', 'Ninguno']) + '</legend>' +
            X.GRUPOS_INDICADORES.map(function (g) {
                return '<div class="exp-grupo-t">' + esc(g.t) + '</div>' + casillas('indicadores', X.INDICADORES.filter(function (d) { return d.grupo === g.k; }), st.indicadores);
            }).join('') + '</fieldset>' +
            '<fieldset class="exp-bloque" data-solo="pdf"><legend>Gráficas <small class="exp-solo">solo PDF</small> ' + rapidos('graficas', ['Todas', 'Ninguna']) + '</legend>' +
            casillas('graficas', X.GRAFICAS, st.graficas) + '</fieldset>' +
            '<fieldset class="exp-bloque"><legend>Contenido</legend>' + casillas('contenido', X.CONTENIDO, X.CONTENIDO.filter(function (c) { return st.contenido[c.k]; }).map(function (c) { return c.k; })) + '</fieldset>' +
            '<fieldset class="exp-bloque" id="expColumnas"><legend>Columnas del listado ' + rapidos('columnas', ['Todas', 'Predeterminadas']) + '</legend>' +
            casillas('columnas', columnasVisibles.map(function (c) { return { k: c.k, t: c.t, fija: c.fija, etiqueta: c.restringida ? 'Datos personales · solo Excel' : '', d: c.ayuda || '' }; }), st.columnas[st.formato]) +
            (puedeDetalle ? '' : '<p class="sg-help" style="margin-top:6px">Los datos personales del reportante solo se exportan con rol de supervisión o administración.</p>') +
            '</fieldset>' +
            '<fieldset class="exp-bloque" data-solo="pdf"><legend>Orientación del PDF</legend><div class="segm" role="radiogroup" aria-label="Orientación del PDF">' +
            [['auto', 'Automática'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal']].map(function (o) {
                return '<button type="button" role="radio" data-orientacion="' + o[0] + '" aria-checked="false" aria-pressed="false">' + o[1] + '</button>';
            }).join('') + '</div><p class="sg-help" id="expOrientTxt" style="margin-top:6px"></p></fieldset>' +
            '<div class="sg-field"><label for="expNotas">Observaciones adicionales <small>(opcional · aparecen en el documento)</small></label>' +
            '<textarea id="expNotas" rows="3" maxlength="' + X.MAX_NOTAS + '" placeholder="Contexto, acuerdos o aclaraciones para quien lea el documento"></textarea></div>' +
            '<div class="sg-banner crit" role="alert" id="expError" hidden style="margin-top:14px">' + ic('crit') + '<span></span></div>' +
            '</form>' +
            '<div class="exp-progreso" id="expProgreso" hidden role="status" aria-live="polite">' +
            '<div class="exp-progreso__t"><span class="sg-spinner sg-spinner--sm" id="expSpin"></span><span id="expPasoT">Preparando…</span></div>' +
            '<div class="exp-barra" id="expBarra"><i></i></div>' +
            '<p class="exp-detalle" id="expDetalle"></p>' +
            '<ol class="exp-pasos" id="expPasos"></ol>' +
            '</div>' +
            '<div class="exp-listo" id="expListo" hidden role="status">' + ic('ok', 'ic-ok') + '<div><b id="expListoT"></b><p class="sg-help" id="expListoD"></p></div></div>' +
            '</div>' +
            '<div class="exp-pie"><span class="exp-resumen" id="expResumen"></span><div class="exp-botones">' +
            '<button type="button" class="btn btn-secondary" id="expCancelar">Cancelar</button>' +
            '<button type="button" class="btn btn-secondary" id="expOtra" hidden>' + ic('back') + 'Nueva exportación</button>' +
            '<button type="button" class="btn btn-secondary" id="expOtraVez" hidden>' + ic('download') + 'Descargar de nuevo</button>' +
            '<button type="button" class="btn btn-primary" id="expGenerar">' + ic('download') + '<span>Generar</span></button>' +
            '</div></div></div>';
        document.body.appendChild(fondo);
        document.body.style.overflow = 'hidden';
        var anterior = document.activeElement;
        var $ = function (id) { return fondo.querySelector('#' + id); };
        var form = fondo.querySelector('form');
        var controlador = null, resultado = null, cerrado = false;

        // -------------------------------------------------- estado del form
        function marcados(nombre) {
            return Array.prototype.filter.call(form.querySelectorAll('input[name="' + nombre + '"]'), function (i) { return i.checked && !i.disabled; }).map(function (i) { return i.value; });
        }
        // Las columnas se leen aunque estén desactivadas (listado apagado), para no perder la elección
        function leerColumnas() {
            st.columnas[st.formato] = ['folio'].concat(Array.prototype.filter.call(form.querySelectorAll('input[name="columnas"]'), function (i) {
                return i.checked && !X.COLUMNA[i.value].fija;
            }).map(function (i) { return i.value; }));
        }
        function pintarFormato() {
            form.querySelectorAll('input[name="formato"]').forEach(function (r) { r.checked = r.value === st.formato; });
            var pdf = st.formato === 'pdf';
            form.querySelectorAll('[data-solo="pdf"]').forEach(function (b) {
                b.disabled = !pdf;
                b.setAttribute('aria-disabled', pdf ? 'false' : 'true');
            });
            // Columnas del formato actual; las de datos personales no van al PDF
            form.querySelectorAll('input[name="columnas"]').forEach(function (i) {
                var c = X.COLUMNA[i.value];
                if (c.fija) return;
                var bloqueada = c.soloExcel && pdf;
                i.disabled = bloqueada;
                i.checked = !bloqueada && st.columnas[st.formato].indexOf(c.k) >= 0;
                i.closest('.exp-check').classList.toggle('is-off', bloqueada);
            });
            $('expGenerar').querySelector('span').textContent = pdf ? 'Generar PDF' : 'Generar Excel';
            $('expColumnas').querySelector('legend').firstChild.textContent = pdf ? 'Columnas del listado ' : 'Columnas de «Datos generales» ';
        }
        function pintarOrientacion() {
            fondo.querySelectorAll('[data-orientacion]').forEach(function (b) {
                var si = b.dataset.orientacion === st.orientacion;
                b.setAttribute('aria-pressed', si ? 'true' : 'false');
                b.setAttribute('aria-checked', si ? 'true' : 'false');
            });
            var op = opciones();
            var o = X.orientacionPdf(op);
            $('expOrientTxt').textContent = st.orientacion === 'auto'
                ? 'Se usará ' + o + ': ' + (op.contenido.detalle ? (o === 'horizontal' ? 'el listado tiene muchas columnas para el ancho vertical.' : 'el listado cabe a lo ancho de la hoja vertical.') : 'sin listado detallado basta la hoja vertical.')
                : 'Hoja ' + st.orientacion + ' en todo el documento.';
        }
        function opciones() {
            return X.normalizarOpciones({
                formato: st.formato,
                titulo: $('expTitulo').value,
                indicadores: marcados('indicadores'),
                graficas: marcados('graficas'),
                columnas: st.columnas[st.formato],
                contenido: marcados('contenido'),
                orientacion: st.orientacion,
                notas: $('expNotas').value
            }, { puedeDetalle: puedeDetalle });
        }
        function filtrosExport() {
            return filtrosConPeriodo(ctx.filtros, $('expPeriodo').value, $('expDesde').value, $('expHasta').value);
        }
        var ultimoTotal = null;
        function pintarResumen() {
            var op = opciones();
            var partes = [st.formato === 'pdf' ? 'PDF ' + X.orientacionPdf(op) : 'Excel'];
            if (ultimoTotal != null) partes.push(X.plural(ultimoTotal, 'reporte', 'reportes'));
            partes.push(X.plural(op.indicadores.length, 'indicador', 'indicadores'));
            if (st.formato === 'pdf') partes.push(X.plural(op.graficas.length, 'gráfica', 'gráficas'));
            if (op.contenido.detalle) partes.push('listado con ' + X.plural(op.columnas.length, 'columna', 'columnas'));
            $('expResumen').textContent = partes.join(' · ');
            $('expColumnas').classList.toggle('is-apagado', !op.contenido.detalle);
            form.querySelectorAll('input[name="columnas"]').forEach(function (i) { if (!X.COLUMNA[i.value].fija && !(X.COLUMNA[i.value].soloExcel && st.formato === 'pdf')) i.disabled = !op.contenido.detalle; });
            pintarOrientacion();
        }
        // Cuántos reportes entran con el periodo elegido (misma consulta que la tabla)
        var temporizadorCuenta = null, controlCuenta = null;
        function contar() {
            clearTimeout(temporizadorCuenta);
            temporizadorCuenta = setTimeout(async function () {
                if (controlCuenta) controlCuenta.abort();
                controlCuenta = new AbortController();
                var f = filtrosExport();
                var span = $('expCuenta').querySelector('span');
                try {
                    var d = await SMS.api('/api/sms/reportes?' + qsDe(f, { por_pagina: 10, pagina: 1 }).toString(), { signal: controlCuenta.signal });
                    ultimoTotal = d.paginacion.total;
                    var otros = (d.filtros_activos || []).filter(function (x) { return x.clave !== 'rango' && x.clave !== 'fecha'; });
                    var txt = X.periodoConsultado(f).texto + ' · ' + X.plural(ultimoTotal, 'reporte', 'reportes') +
                        (otros.length ? ' con los filtros: ' + otros.map(function (x) { return x.etiqueta + ': ' + x.valor; }).join(' · ') : ' (sin otros filtros)') + '.';
                    var op = opciones();
                    if (st.formato === 'pdf' && op.contenido.detalle && ultimoTotal > 2000) txt += ' El listado será extenso; para analizar muchos registros conviene Excel o quitar el listado.';
                    if (ultimoTotal > X.LIMITE_FILAS && op.contenido.detalle) txt += ' Se superan ' + num(X.LIMITE_FILAS) + ' reportes: el listado se acotará y el documento lo indicará.';
                    span.textContent = txt;
                    pintarResumen();
                } catch (e) {
                    if (e.name !== 'AbortError') span.textContent = 'No se pudo calcular cuántos reportes se incluyen: ' + e.message;
                }
            }, 220);
        }

        // ---------------------------------------------------- progreso
        var PASOS = {
            pdf: [['datos', 'Consultar los datos (todas las páginas del listado)'], ['graficas', 'Dibujar las gráficas'], ['documento', 'Armar el documento'], ['descarga', 'Descargar']],
            xlsx: [['documento', 'Consultar y armar el libro en el servidor'], ['descarga', 'Descargar']]
        };
        var ui = {
            senal: null,
            paso: function (clave) {
                var lista = $('expPasos').querySelectorAll('li');
                var visto = false;
                lista.forEach(function (li) {
                    var es = li.dataset.paso === clave;
                    li.classList.toggle('is-actual', es);
                    li.classList.toggle('is-hecho', !visto && !es);
                    if (es) visto = true;
                    if (visto && !es) li.classList.remove('is-hecho');
                });
                var actual = $('expPasos').querySelector('[data-paso="' + clave + '"]');
                if (actual) $('expPasoT').textContent = actual.textContent + '…';
            },
            avance: function (v, detalle) {
                var barra = $('expBarra');
                barra.classList.toggle('is-indef', v == null);
                barra.querySelector('i').style.width = v == null ? '' : Math.round(Math.max(0, Math.min(1, v)) * 100) + '%';
                if (detalle != null) $('expDetalle').textContent = detalle;
            }
        };
        function vista(cual) {
            form.hidden = cual !== 'form';
            $('expProgreso').hidden = cual !== 'progreso';
            $('expListo').hidden = cual !== 'listo';
            $('expGenerar').hidden = cual !== 'form';
            $('expOtra').hidden = cual !== 'listo';
            $('expOtraVez').hidden = cual !== 'listo';
            $('expCancelar').textContent = cual === 'listo' ? 'Cerrar' : 'Cancelar';
            $('expResumen').hidden = cual === 'listo';
            fondo.querySelector('.sg-dialog__body').scrollTop = 0;
        }
        function mostrarError(msg) {
            var b = $('expError');
            b.querySelector('span').textContent = msg;
            b.hidden = !msg;
            if (msg) b.scrollIntoView({ block: 'nearest' });
        }

        async function generar() {
            mostrarError('');
            leerColumnas();
            var periodo = $('expPeriodo').value;
            if (periodo === 'personalizado') {
                var de = $('expDesde').value, a = $('expHasta').value;
                if (!de && !a) { mostrarError('Indica al menos una fecha para el rango personalizado.'); $('expDesde').focus(); return; }
                if (de && a && de > a) { mostrarError('La fecha inicial no puede ser posterior a la final.'); $('expDesde').focus(); return; }
            }
            var op = opciones();
            guardarPrefs({ formato: st.formato, indicadores: op.indicadores, graficas: st.formato === 'pdf' ? op.graficas : st.graficas, columnas: st.columnas, contenido: op.contenido, orientacion: st.orientacion });
            if (st.formato === 'pdf') st.graficas = op.graficas;
            var f = filtrosExport();
            $('expPasos').innerHTML = PASOS[st.formato].filter(function (p) { return p[0] !== 'graficas' || op.graficas.length; })
                .map(function (p) { return '<li data-paso="' + p[0] + '">' + esc(p[1]) + '</li>'; }).join('');
            $('expSpin').hidden = false;
            ui.avance(0, '');
            vista('progreso');
            controlador = new AbortController();
            ui.senal = controlador.signal;
            $('expCancelar').focus();
            try {
                resultado = st.formato === 'pdf' ? await exportarPDF(op, f, ctx, sesion, ui) : await exportarExcel(op, f, ctx, ui);
                ui.avance(1, '');
                $('expListoT').textContent = 'Listo: ' + resultado.nombre;
                $('expListoD').textContent = resultado.detalle + '. Se descargó en tu equipo.';
                vista('listo');
                $('expOtraVez').focus();
                if (window.SAGA) SAGA.toast(st.formato === 'pdf' ? 'PDF generado' : 'Archivo de Excel generado', 'success', { duracion: 2500 });
            } catch (e) {
                vista('form');
                if (e.name === 'AbortError') { if (window.SAGA && !cerrado) SAGA.toast('Exportación cancelada', 'info', { duracion: 2500 }); }
                else mostrarError(e.message || 'No se pudo generar el documento');
            } finally {
                controlador = null;
            }
        }

        // ----------------------------------------------------------- eventos
        function cerrar() {
            if (cerrado) return;
            cerrado = true;
            if (controlador) controlador.abort();
            if (controlCuenta) controlCuenta.abort();
            fondo.remove();
            document.body.style.overflow = '';
            if (anterior && anterior.focus && document.body.contains(anterior)) anterior.focus();
        }
        fondo.addEventListener('click', function (e) {
            if (e.target === fondo && !controlador) { cerrar(); return; }
            if (e.target.closest('[data-cerrar]')) { cerrar(); return; }
            var t = e.target.closest('[data-todas], [data-ninguna]');
            if (t) {
                var nombre = t.dataset.todas || t.dataset.ninguna;
                var todas = !!t.dataset.todas;
                if (nombre === 'columnas' && !todas) {
                    st.columnas[st.formato] = X.normalizarOpciones({ formato: st.formato }, { puedeDetalle: puedeDetalle }).columnas;
                    pintarFormato();
                } else {
                    form.querySelectorAll('input[name="' + nombre + '"]').forEach(function (i) { if (!i.disabled) i.checked = todas; });
                    if (nombre === 'columnas') leerColumnas();
                }
                pintarResumen();
                return;
            }
            var o = e.target.closest('[data-orientacion]');
            if (o) { st.orientacion = o.dataset.orientacion; pintarOrientacion(); pintarResumen(); }
        });
        fondo.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
            if (e.key !== 'Tab') return;
            var f = Array.prototype.filter.call(fondo.querySelectorAll('button, input, select, textarea, a[href]'), function (x) { return !x.disabled && x.offsetParent !== null; });
            if (!f.length) return;
            var a = f[0], z = f[f.length - 1];
            if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
            else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
        });
        form.addEventListener('change', function (e) {
            if (e.target.name === 'formato') { leerColumnas(); st.formato = e.target.value; pintarFormato(); contar(); }
            if (e.target.name === 'columnas') leerColumnas();
            if (e.target.id === 'expPeriodo') {
                $('expRango').hidden = e.target.value !== 'personalizado';
                if (e.target.value === 'personalizado' && !$('expDesde').value && !$('expHasta').value) {
                    $('expDesde').value = ctx.filtros.desde || ctx.filtros.fecha || '';
                    $('expHasta').value = ctx.filtros.hasta || ctx.filtros.fecha || '';
                }
            }
            if (['expPeriodo', 'expDesde', 'expHasta'].indexOf(e.target.id) >= 0) contar();
            if (e.target.name === 'contenido') contar();
            pintarResumen();
        });
        form.addEventListener('submit', function (e) { e.preventDefault(); generar(); });
        $('expGenerar').addEventListener('click', generar);
        $('expCancelar').addEventListener('click', function () {
            if (controlador) controlador.abort();
            else cerrar();
        });
        $('expOtra').addEventListener('click', function () { vista('form'); $('expGenerar').focus(); });
        $('expOtraVez').addEventListener('click', function () { if (resultado) descargarBlob(resultado.blob, resultado.nombre); });

        pintarFormato();
        pintarResumen();
        contar();
        vista('form');
        setTimeout(function () { var r = form.querySelector('input[name="formato"]:checked'); (r || $('expTitulo')).focus(); }, 30);
    }

    window.SMSExportar = { abrir: abrir, filtrosConPeriodo: filtrosConPeriodo };
})();
