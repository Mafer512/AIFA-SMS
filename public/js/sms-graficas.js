/* S.A.G.A. · Gráficas del módulo SMS (SVG/HTML propios, sin dependencias)
   - lineas(el, cfg)      evolución en el tiempo; crosshair + tooltip con todas las series
   - columnas(el, cfg)    columnas apiladas por periodo, total en la punta
   - barras(el, cfg)      barras horizontales (simples o apiladas), valor en la punta
   - segmentada(el, cfg)  una parte-del-todo (≤ 6 partes) con leyenda y porcentajes
   - matriz(el, cfg)      mapa de calor 5×5 de la matriz de riesgo
   - spi(el, cfg)         columnas mensuales de un indicador con meta y alerta
   - dona(el, cfg)        parte-del-todo en anillo con lista de valores (clic para filtrar)
   - restablecer(el)      quita el zoom y vuelve a mostrar las series ocultas
   - exportarPNG(tarjeta) descarga la tarjeta (título, leyenda y gráfica) como PNG
   Opciones interactivas (todas opcionales; sin ellas cada gráfica se comporta como antes):
     interactiva  la leyenda activa/desactiva series (la escala se recalcula)
     zoom         en líneas: arrastrar sobre la gráfica acerca ese tramo
     alElegir     clic o Enter sobre un periodo, barra o sector (p. ej. para filtrar)
     pista        texto al pie del tooltip ("Clic para filtrar…")
   Una gráfica solo se vuelve a dibujar si cambian sus datos, el ancho o la vista.
   Al cambiar la vista se emite el evento "viz:vista" (detail.alterada).
   Cada gráfica genera su "vista de tabla" (accesible) en el contenedor indicado.
   Los textos se insertan con textContent (los nombres vienen de la BD).      */
(function () {
    'use strict';

    var NS = 'http://www.w3.org/2000/svg';
    var esc = function (t) { return window.SMS ? SMS.esc(t) : String(t); };
    var num = function (n, d) { return window.SMS ? SMS.numero(n, d) : String(n); };
    var sinMovimiento = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // Estado de la vista de cada gráfica (series ocultas y zoom); sobrevive al redibujo
    function vista(contenedor) {
        if (!contenedor._vista) contenedor._vista = { ocultas: new Set(), zoom: null };
        return contenedor._vista;
    }
    function avisarVista(contenedor) {
        var v = vista(contenedor);
        var alterada = v.ocultas.size > 0 || !!v.zoom;
        if (contenedor._alterada === alterada) return;
        contenedor._alterada = alterada;
        contenedor.dispatchEvent(new CustomEvent('viz:vista', { bubbles: true, detail: { alterada: alterada } }));
    }
    /** true si los datos son los mismos del último dibujo (no hace falta redibujar) */
    function sinCambios(contenedor, datos) {
        var f;
        try { f = JSON.stringify(datos); } catch (e) { f = String(Math.random()); }
        if (contenedor._firma === f && contenedor._redibujar && contenedor.firstChild) return true;
        contenedor._firma = f;
        return false;
    }
    function olvidar(contenedor) {
        contenedor._firma = null;
        contenedor._redibujar = null;
        if (contenedor._vista) contenedor._vista.zoom = null;
        avisarVista(contenedor);
    }
    function animarEntrada(svg, animar) {
        if (animar && !sinMovimiento) svg.classList.add('viz-anim');
    }

    function el(tag, attrs, padre) {
        var n = document.createElementNS(NS, tag);
        for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
        if (padre) padre.appendChild(n);
        return n;
    }

    /** Escala con pasos limpios (1, 2, 5 × 10^n). Para conteos, paso mínimo 1. */
    function escala(maxV, entero) {
        if (!(maxV > 0)) return { max: 4, paso: 1 };
        var bruto = maxV / 4;
        var exp = Math.pow(10, Math.floor(Math.log10(bruto)));
        var f = bruto / exp;
        var paso = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
        if (entero && paso < 1) paso = 1;
        var max = Math.ceil(maxV / paso) * paso;
        if (max - maxV < paso * 0.15) max += paso;   // aire sobre el valor más alto
        return { max: max, paso: paso };
    }

    function vacio(contenedor, titulo, texto, icono) {
        olvidar(contenedor);
        contenedor.innerHTML = '<div class="viz-vacia"><svg class="ic" aria-hidden="true"><use href="/img/icons.svg#i-' + (icono || 'chart-bar') + '"/></svg><b></b><span></span></div>';
        contenedor.querySelector('b').textContent = titulo;
        contenedor.querySelector('span').textContent = texto || '';
    }

    function tooltip(contenedor) {
        var t = document.createElement('div');
        t.className = 'viz-tip';
        t.setAttribute('role', 'status');
        contenedor.appendChild(t);
        return {
            mostrar: function (titulo, filas, x, y, pie) {
                t.innerHTML = '';
                var h = document.createElement('div'); h.className = 't'; h.textContent = titulo; t.appendChild(h);
                filas.forEach(function (f) {
                    var r = document.createElement('div'); r.className = 'r' + (f.separador ? ' sep' : '');
                    var i = document.createElement('i'); i.style.setProperty('--c', f.color || 'var(--n400)');
                    var b = document.createElement('b'); b.textContent = f.valor;
                    var s = document.createElement('span'); s.textContent = f.nombre;
                    r.appendChild(i); r.appendChild(b); r.appendChild(s); t.appendChild(r);
                });
                if (pie) { var p = document.createElement('div'); p.className = 'p'; p.textContent = pie; t.appendChild(p); }
                t.classList.add('is-on');
                var ancho = contenedor.clientWidth;
                var w = t.offsetWidth;
                var left = Math.min(Math.max(8, x + 14), ancho - w - 8);
                if (x + 14 + w > ancho) left = Math.max(8, x - w - 14);
                t.style.left = left + 'px';
                t.style.top = Math.max(0, y - t.offsetHeight - 10) + 'px';
            },
            ocultar: function () { t.classList.remove('is-on'); }
        };
    }

    // Leyenda; con opciones.alAlternar cada serie es un botón que la muestra u oculta
    function leyenda(series, linea, opciones) {
        opciones = opciones || {};
        var interactiva = typeof opciones.alAlternar === 'function';
        var l = document.createElement('div');
        l.className = 'viz-leyenda' + (interactiva ? ' is-interactiva' : '');
        if (interactiva) { l.setAttribute('role', 'group'); l.setAttribute('aria-label', 'Series: toca una para mostrarla u ocultarla'); }
        series.forEach(function (s) {
            var sp = document.createElement(interactiva ? 'button' : 'span');
            var i = document.createElement('i');
            if (linea) i.className = 'linea';
            i.style.setProperty('--c', s.color);
            sp.appendChild(i);
            sp.appendChild(document.createTextNode(s.nombre));
            if (interactiva) {
                var visible = !(opciones.ocultas && opciones.ocultas.has(s.nombre));
                sp.type = 'button';
                sp.setAttribute('aria-pressed', visible ? 'true' : 'false');
                sp.setAttribute('data-tip', (visible ? 'Ocultar ' : 'Mostrar ') + s.nombre);
                sp.addEventListener('click', function () { opciones.alAlternar(s.nombre); });
            }
            l.appendChild(sp);
        });
        return l;
    }
    /** Alterna una serie; nunca deja la gráfica sin series visibles */
    function alternarSerie(v, todas, nombre) {
        if (v.ocultas.has(nombre)) v.ocultas.delete(nombre);
        else if (todas.length - v.ocultas.size > 1) v.ocultas.add(nombre);
    }

    /** Tabla accesible equivalente a la gráfica */
    function tabla(destino, encabezados, filas) {
        if (!destino) return;
        var t = document.createElement('table');
        var thead = t.createTHead().insertRow();
        encabezados.forEach(function (h, i) {
            var th = document.createElement('th'); th.textContent = h; th.scope = 'col';
            if (i > 0) th.className = 'num';
            thead.appendChild(th);
        });
        var tb = t.createTBody();
        filas.forEach(function (f) {
            var tr = tb.insertRow();
            f.forEach(function (v, i) {
                var td = tr.insertCell(); td.textContent = v;
                if (i > 0) td.className = 'num';
            });
        });
        destino.innerHTML = '';
        destino.appendChild(t);
    }

    function alRedimensionar(contenedor, fn) {
        if (contenedor._ro) contenedor._ro.disconnect();
        var ancho = contenedor.clientWidth;
        if (!('ResizeObserver' in window)) return;
        contenedor._ro = new ResizeObserver(function () {
            if (Math.abs(contenedor.clientWidth - ancho) > 24) { ancho = contenedor.clientWidth; fn(); }
        });
        contenedor._ro.observe(contenedor);
    }

    // ------------------------------------------------------------- líneas
    // cfg: { etiquetas, series: [{ nombre, color, valores }], formatoX, formatoY, tituloX, descripcion, alto,
    //        area (una serie: relleno tenue, por omisión sí) · areas (relleno en todas las series),
    //        interactiva, zoom, alElegir(i), titulos[i] (título del tooltip), extraTooltip(i), pista,
    //        tabla, vacioTitulo, vacioTexto }
    // Los índices que reciben alElegir/titulos/extraTooltip son siempre los de los datos completos.
    function lineas(contenedor, cfg) {
        var todas = cfg.series || [];
        var etiquetasTodas = cfg.etiquetas || [];
        var fx = cfg.formatoX || String, fy = cfg.formatoY || num;
        var hayDatos = todas.some(function (s) { return s.valores.some(function (v) { return v != null && v > 0; }); });
        tabla(cfg.tabla, [cfg.tituloX || 'Periodo'].concat(todas.map(function (s) { return s.nombre; })),
            etiquetasTodas.map(function (e, i) {
                return [fx(e)].concat(todas.map(function (s) { return s.valores[i] == null ? '—' : fy(s.valores[i]); }));
            }));
        if (!etiquetasTodas.length || !hayDatos) return vacio(contenedor, cfg.vacioTitulo || 'Sin datos para este periodo', cfg.vacioTexto, 'chart-line');
        if (sinCambios(contenedor, [etiquetasTodas, todas.map(function (s) { return [s.nombre, s.color, s.valores]; }), cfg.alto])) return;
        var v = vista(contenedor);
        v.zoom = null;   // datos nuevos: el zoom anterior ya no aplica

        function dibujar(animar) {
            var visibles = todas.filter(function (s) { return !v.ocultas.has(s.nombre); });
            if (!visibles.length) { v.ocultas.clear(); visibles = todas; }
            var a0 = v.zoom ? v.zoom[0] : 0;
            var a1 = v.zoom ? v.zoom[1] : etiquetasTodas.length - 1;
            var etiquetas = etiquetasTodas.slice(a0, a1 + 1);
            var series = visibles.map(function (s) { return { nombre: s.nombre, color: s.color, valores: s.valores.slice(a0, a1 + 1) }; });
            var conRelleno = cfg.areas || (todas.length === 1 && cfg.area !== false);

            contenedor.innerHTML = '';
            if (todas.length > 1) {
                contenedor.appendChild(leyenda(todas, !cfg.areas, cfg.interactiva ? {
                    ocultas: v.ocultas,
                    alAlternar: function (nombre) { alternarSerie(v, todas, nombre); dibujar(false); }
                } : null));
            }
            var W = Math.max(280, contenedor.clientWidth);
            var H = cfg.alto || 240;
            var m = { t: 14, r: todas.length === 1 ? 40 : 16, b: 30, l: 36 };
            var iw = W - m.l - m.r, ih = H - m.t - m.b;
            var maxV = 0;
            series.forEach(function (s) { s.valores.forEach(function (x) { if (x != null && x > maxV) maxV = x; }); });
            var esc0 = escala(maxV, cfg.entero !== false && !cfg.formatoY);
            var maxY = esc0.max;
            var n = etiquetas.length;
            var x = function (i) { return m.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1)); };
            var y = function (val) { return m.t + ih - (val / maxY) * ih; };
            var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': cfg.descripcion || '' });

            var rej = el('g', { class: 'rejilla' }, svg);
            var eje = el('g', { class: 'eje' }, svg);
            for (var k = 0; k <= Math.round(maxY / esc0.paso); k++) {
                var vy = esc0.paso * k;
                var yy = y(vy);
                if (k > 0) el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy }, rej);
                var t = el('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, eje);
                t.textContent = num(vy, esc0.paso < 1 ? 1 : 0);
            }
            el('line', { class: 'base', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }, svg);
            var cada = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
            etiquetas.forEach(function (e, i) {
                if (i % cada !== 0 && i !== n - 1) return;
                if (i !== n - 1 && i !== 0 && n - 1 - i < cada) return;   // evita encimar la penúltima con la última
                var tx = el('text', { x: x(i), y: H - 8, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, eje);
                tx.textContent = fx(e);
            });

            var cruz = el('line', { class: 'cruz', y1: m.t, y2: m.t + ih, x1: -10, x2: -10, visibility: 'hidden' }, svg);
            var puntosActivos = [];
            var conPuntos = n === 1 || iw / (n - 1) >= 16;   // con periodos muy juntos solo se dibuja la línea
            series.forEach(function (s) {
                var g = el('g', { class: 'marca' }, svg);
                if (conRelleno) {
                    var seg0 = [];
                    s.valores.forEach(function (val, i) { if (val != null) seg0.push([x(i), y(val)]); });
                    if (seg0.length > 1) {
                        var dA = 'M' + seg0[0][0] + ',' + (m.t + ih) + seg0.map(function (p) { return 'L' + p[0] + ',' + p[1]; }).join('') + 'L' + seg0[seg0.length - 1][0] + ',' + (m.t + ih) + 'Z';
                        el('path', { class: 'relleno', d: dA, fill: s.color, 'fill-opacity': .1 }, g);
                    }
                }
                var d = '', abierto = false;
                s.valores.forEach(function (val, i) {
                    if (val == null) { abierto = false; return; }
                    d += (abierto ? 'L' : 'M') + x(i) + ',' + y(val);
                    abierto = true;
                });
                el('path', { class: 'trazo', pathLength: 1, d: d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
                if (conPuntos) {
                    s.valores.forEach(function (val, i) {
                        if (val == null) return;
                        el('circle', { class: 'punto', cx: x(i), cy: y(val), r: 4, fill: s.color, stroke: 'var(--sf)', 'stroke-width': 2 }, g);
                    });
                }
                var activo = el('circle', { r: 5, fill: s.color, stroke: 'var(--sf)', 'stroke-width': 2, visibility: 'hidden' }, svg);
                puntosActivos.push(activo);
                // Valor solo al final (una serie): etiquetado selectivo
                if (todas.length === 1) {
                    for (var j = s.valores.length - 1; j >= 0; j--) {
                        if (s.valores[j] != null) {
                            var tv = el('text', { class: 'etq-val', x: x(j) + 8, y: y(s.valores[j]) + 4 }, svg);
                            tv.textContent = fy(s.valores[j]);
                            break;
                        }
                    }
                }
            });

            var acciones = [];
            if (cfg.alElegir) acciones.push('Enter para elegir el periodo');
            if (cfg.zoom) acciones.push('arrastra para acercar');
            var hit = el('rect', {
                class: 'hit' + (cfg.alElegir ? ' es-elegible' : '') + (cfg.zoom ? ' con-zoom' : ''),
                x: m.l - 10, y: m.t, width: iw + 20, height: ih, tabindex: 0,
                'aria-label': (cfg.descripcion || 'Gráfica') + '. Usa las flechas para recorrer los periodos' + (acciones.length ? '; ' + acciones.join(', ') : '') + '.'
            }, svg);
            contenedor.appendChild(svg);
            animarEntrada(svg, animar);
            var tip = tooltip(contenedor);
            var actual = -1;

            function marcar(i) {
                actual = i;
                var px = x(i);
                cruz.setAttribute('x1', px); cruz.setAttribute('x2', px); cruz.setAttribute('visibility', 'visible');
                var filas = [];
                var minY = m.t + ih;
                series.forEach(function (s, k) {
                    var val = s.valores[i];
                    var p = puntosActivos[k];
                    if (val == null) { p.setAttribute('visibility', 'hidden'); }
                    else { p.setAttribute('cx', px); p.setAttribute('cy', y(val)); p.setAttribute('visibility', 'visible'); minY = Math.min(minY, y(val)); }
                    filas.push({ nombre: s.nombre, valor: val == null ? '—' : fy(val), color: s.color });
                });
                if (cfg.extraTooltip) filas = filas.concat(cfg.extraTooltip(a0 + i, v.ocultas));
                var escalaPx = contenedor.clientWidth / W;
                var ley = contenedor.querySelector('.viz-leyenda');
                tip.mostrar(cfg.titulos ? cfg.titulos[a0 + i] : fx(etiquetas[i]), filas, px * escalaPx, minY * escalaPx + (ley ? ley.offsetHeight + 12 : 0), cfg.pista);
            }
            function limpiar() {
                cruz.setAttribute('visibility', 'hidden');
                puntosActivos.forEach(function (p) { p.setAttribute('visibility', 'hidden'); });
                tip.ocultar();
            }
            function indiceDesde(ev) {
                var r = svg.getBoundingClientRect();
                var px = ((ev.clientX - r.left) / r.width) * W;
                if (n === 1) return 0;
                return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
            }

            // Arrastrar = acercar (zoom) · clic sin arrastre = elegir el periodo
            var arrastre = null, sel = null;
            hit.addEventListener('pointerdown', function (ev) {
                if (ev.button !== 0) return;
                arrastre = { x0: ev.clientX, i0: indiceDesde(ev), movio: false };
                if (cfg.zoom && hit.setPointerCapture) hit.setPointerCapture(ev.pointerId);
            });
            hit.addEventListener('pointermove', function (ev) {
                var i = indiceDesde(ev);
                marcar(i);
                if (!arrastre || !cfg.zoom || Math.abs(ev.clientX - arrastre.x0) < 6) return;
                arrastre.movio = true;
                if (!sel) { sel = el('rect', { class: 'seleccion', y: m.t, height: ih }); svg.insertBefore(sel, hit); }
                var xa = Math.min(x(arrastre.i0), x(i)), xb = Math.max(x(arrastre.i0), x(i));
                sel.setAttribute('x', xa - 3);
                sel.setAttribute('width', xb - xa + 6);
            });
            hit.addEventListener('pointerup', function (ev) {
                if (!arrastre) return;
                var a = arrastre, i = indiceDesde(ev);
                arrastre = null;
                if (sel) { sel.remove(); sel = null; }
                if (a.movio) {
                    var lo = Math.min(a.i0, i), hi = Math.max(a.i0, i);
                    if (hi > lo) { v.zoom = [a0 + lo, a0 + hi]; dibujar(false); avisarVista(contenedor); }
                    return;
                }
                if (cfg.alElegir) cfg.alElegir(a0 + i);
            });
            hit.addEventListener('pointercancel', function () { arrastre = null; if (sel) { sel.remove(); sel = null; } });
            hit.addEventListener('pointerleave', function () { if (!arrastre) limpiar(); });
            hit.addEventListener('focus', function () { marcar(actual < 0 ? n - 1 : actual); });
            hit.addEventListener('blur', limpiar);
            hit.addEventListener('keydown', function (ev) {
                if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
                    ev.preventDefault();
                    marcar(Math.max(0, Math.min(n - 1, (actual < 0 ? n - 1 : actual) + (ev.key === 'ArrowRight' ? 1 : -1))));
                } else if ((ev.key === 'Enter' || ev.key === ' ') && cfg.alElegir && actual >= 0) {
                    ev.preventDefault();
                    cfg.alElegir(a0 + actual);
                }
            });
            avisarVista(contenedor);
        }
        contenedor._redibujar = function () { dibujar(false); };
        dibujar(true);
        alRedimensionar(contenedor, function () { dibujar(false); });
    }

    // ----------------------------------------------------------- columnas
    // Columnas apiladas por periodo.
    // cfg: { etiquetas, formatoX, series: [{ nombre, color, valores }] (la 1.ª va abajo),
    //        detalle(i) → texto bajo la etiqueta del periodo, extraTooltip(i) → [{nombre, valor}],
    //        tabla, encabezadosTabla, filasTabla, descripcion, alto,
    //        interactiva, alElegir(i), titulos[i], pista, vacioTitulo, vacioTexto }
    // Con muchos periodos solo se rotula la columna más alta (etiquetado selectivo).
    function columnas(contenedor, cfg) {
        var todas = cfg.series || [];
        var etiquetas = cfg.etiquetas || [];
        var n = etiquetas.length;
        var fx = cfg.formatoX || String;
        var sumaDe = function (lista) { return etiquetas.map(function (_, i) { return lista.reduce(function (s, x) { return s + (x.valores[i] || 0); }, 0); }); };
        var totalesTodos = sumaDe(todas);
        if (cfg.tabla) {
            if (cfg.encabezadosTabla) tabla(cfg.tabla, cfg.encabezadosTabla, cfg.filasTabla || []);
            else tabla(cfg.tabla, ['Periodo'].concat(todas.map(function (s) { return s.nombre; })).concat(['Total']),
                etiquetas.map(function (e, i) { return [fx(e)].concat(todas.map(function (s) { return num(s.valores[i] || 0); })).concat([num(totalesTodos[i])]); }));
        }
        if (!n || !totalesTodos.some(function (t) { return t > 0; })) return vacio(contenedor, cfg.vacioTitulo || 'Sin datos para este periodo', cfg.vacioTexto, 'chart-bar');
        if (sinCambios(contenedor, [etiquetas, todas.map(function (s) { return [s.nombre, s.color, s.valores]; }), cfg.alto])) return;
        var v = vista(contenedor);

        function dibujar(animar) {
            var series = todas.filter(function (s) { return !v.ocultas.has(s.nombre); });
            if (!series.length) { v.ocultas.clear(); series = todas; }
            var totales = sumaDe(series);
            contenedor.innerHTML = '';
            if (todas.length > 1) {
                contenedor.appendChild(leyenda(todas, false, cfg.interactiva ? {
                    ocultas: v.ocultas,
                    alAlternar: function (nombre) { alternarSerie(v, todas, nombre); dibujar(false); }
                } : null));
            }
            var W = Math.max(280, contenedor.clientWidth);
            var H = cfg.alto || 280;
            var m = { t: 24, r: 8, b: 52, l: 36 };
            var iw = W - m.l - m.r, ih = H - m.t - m.b;
            var esc0 = escala(Math.max.apply(null, totales), true);
            var maxY = esc0.max;
            var y = function (val) { return m.t + ih - (val / maxY) * ih; };
            var slot = iw / n;
            var bw = Math.max(Math.min(6, slot * 0.8), Math.min(24, slot * 0.55));
            var cx = function (i) { return m.l + slot * i + slot / 2; };
            var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': cfg.descripcion || '' });

            var rej = el('g', { class: 'rejilla' }, svg);
            var eje = el('g', { class: 'eje' }, svg);
            for (var k = 0; k <= Math.round(maxY / esc0.paso); k++) {
                var vy = esc0.paso * k;
                if (k > 0) el('line', { x1: m.l, x2: W - m.r, y1: y(vy), y2: y(vy) }, rej);
                var t = el('text', { x: m.l - 8, y: y(vy) + 4, 'text-anchor': 'end' }, eje);
                t.textContent = num(vy);
            }

            // Etiquetas del eje X (se espacian si hay muchos periodos)
            var cada = Math.max(1, Math.ceil(70 / slot));
            // Detalle completo si cabe; versión corta en pantallas angostas
            var ancho = slot * cada;
            var textoDetalle = typeof cfg.detalle === 'function' && ancho >= 130 ? cfg.detalle
                : typeof cfg.detalleCorto === 'function' && ancho >= 56 ? cfg.detalleCorto : null;
            // Total en la punta: en todas si caben; si no, solo en la más alta
            var rotularTodas = slot >= 26;
            var iMax = totales.indexOf(Math.max.apply(null, totales));
            var grupos = [];
            etiquetas.forEach(function (e, i) {
                var g = el('g', { class: 'marca barra-col' }, svg);
                grupos.push(g);
                var base = m.t + ih;
                var visibles = series.map(function (s) { return { v: s.valores[i] || 0, color: s.color }; }).filter(function (p) { return p.v > 0; });
                visibles.forEach(function (p, j) {
                    var alto = (p.v / maxY) * ih;
                    var y0 = base - alto;
                    var hueco = j > 0 ? 2 : 0;             // separación de 2 px entre segmentos
                    var h = Math.max(1, alto - hueco);
                    var x0 = cx(i) - bw / 2;
                    if (j === visibles.length - 1) {
                        // Segmento superior: extremo de datos redondeado (4 px), base recta
                        var r = Math.min(4, h, bw / 2);
                        var yb = y0 + h;
                        el('path', {
                            d: 'M' + x0 + ',' + yb + 'V' + (y0 + r) + 'Q' + x0 + ',' + y0 + ' ' + (x0 + r) + ',' + y0 +
                               'H' + (x0 + bw - r) + 'Q' + (x0 + bw) + ',' + y0 + ' ' + (x0 + bw) + ',' + (y0 + r) + 'V' + yb + 'Z',
                            fill: p.color
                        }, g);
                    } else {
                        el('rect', { x: x0, y: y0, width: bw, height: h, fill: p.color }, g);
                    }
                    base = y0;
                });
                if (totales[i] > 0 && (rotularTodas || i === iMax)) {
                    var tv = el('text', { class: 'etq-val', x: cx(i), y: y(totales[i]) - 7, 'text-anchor': 'middle' }, svg);
                    tv.textContent = num(totales[i]);
                }
                if (i % cada === 0 || i === n - 1) {
                    if (i !== n - 1 && i % cada === 0 && n - 1 - i < cada) return;   // la última siempre; sin encimar
                    var tx = el('text', { class: 'etq-cat', x: cx(i), y: m.t + ih + 20, 'text-anchor': 'middle' }, svg);
                    tx.textContent = fx(e);
                    if (textoDetalle) {
                        var td = el('text', { class: 'etq', x: cx(i), y: m.t + ih + 37, 'text-anchor': 'middle' }, svg);
                        td.textContent = textoDetalle(i);
                    }
                }
            });
            el('line', { class: 'base', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }, svg);

            var hit = el('rect', {
                class: 'hit' + (cfg.alElegir ? ' es-elegible' : ''), x: m.l, y: m.t, width: iw, height: ih + 40, tabindex: 0,
                'aria-label': (cfg.descripcion || 'Gráfica') + '. Usa las flechas para recorrer los periodos' + (cfg.alElegir ? ' y Enter para elegir uno' : '') + '.'
            }, svg);
            contenedor.appendChild(svg);
            animarEntrada(svg, animar);
            var tip = tooltip(contenedor);
            var actual = -1;
            function marcar(i) {
                actual = i;
                contenedor.classList.add('is-hover');
                grupos.forEach(function (g, j) { g.classList.toggle('is-activa', j === i); });
                var filas = series.map(function (s) { return { nombre: s.nombre, valor: num(s.valores[i] || 0), color: s.color }; });
                if (series.length > 1) filas.push({ nombre: 'Total', valor: num(totales[i]), color: 'transparent', separador: true });
                if (cfg.extraTooltip) filas = filas.concat(cfg.extraTooltip(i, v.ocultas));
                var escalaPx = contenedor.clientWidth / W;
                var ley = contenedor.querySelector('.viz-leyenda');
                tip.mostrar(cfg.titulos ? cfg.titulos[i] : fx(etiquetas[i]), filas, cx(i) * escalaPx, y(totales[i]) * escalaPx + (ley ? ley.offsetHeight + 12 : 0), cfg.pista);
            }
            function limpiar() { contenedor.classList.remove('is-hover'); grupos.forEach(function (g) { g.classList.remove('is-activa'); }); tip.ocultar(); }
            function indiceDesde(ev) {
                var r = svg.getBoundingClientRect();
                var px = ((ev.clientX - r.left) / r.width) * W;
                return Math.max(0, Math.min(n - 1, Math.floor((px - m.l) / slot)));
            }
            hit.addEventListener('pointermove', function (ev) { marcar(indiceDesde(ev)); });
            hit.addEventListener('pointerleave', limpiar);
            if (cfg.alElegir) hit.addEventListener('click', function (ev) { cfg.alElegir(indiceDesde(ev)); });
            hit.addEventListener('focus', function () { marcar(actual < 0 ? n - 1 : actual); });
            hit.addEventListener('blur', limpiar);
            hit.addEventListener('keydown', function (ev) {
                if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
                    ev.preventDefault();
                    marcar(Math.max(0, Math.min(n - 1, (actual < 0 ? n - 1 : actual) + (ev.key === 'ArrowRight' ? 1 : -1))));
                } else if ((ev.key === 'Enter' || ev.key === ' ') && cfg.alElegir && actual >= 0) {
                    ev.preventDefault();
                    cfg.alElegir(actual);
                }
            });
            avisarVista(contenedor);
        }
        contenedor._redibujar = function () { dibujar(false); };
        dibujar(true);
        alRedimensionar(contenedor, function () { dibujar(false); });
    }

    // ------------------------------------------------------------- barras
    // cfg: { filas: [{ nombre, valores: [..], enlace?, clave? }], series: [{ nombre, color }], formato,
    //        interactiva (leyenda que oculta series), alElegir(fila) (clic o Enter en la barra),
    //        seleccion (clave de la fila elegida: las demás se atenúan), pista }
    function barras(contenedor, cfg) {
        var todas = cfg.series;
        var filas = cfg.filas || [];
        tabla(cfg.tabla, [cfg.tituloCategoria || 'Categoría'].concat(todas.map(function (s) { return s.nombre; })).concat(todas.length > 1 ? ['Total'] : []),
            filas.map(function (f) {
                var tot = f.valores.reduce(function (a, b) { return a + b; }, 0);
                return [f.nombre].concat(f.valores.map(function (x) { return num(x); })).concat(todas.length > 1 ? [num(tot)] : []);
            }));
        if (!filas.length) return vacio(contenedor, cfg.vacioTitulo || 'Sin datos', cfg.vacioTexto, 'chart-bar');
        if (sinCambios(contenedor, [filas.map(function (f) { return [f.nombre, f.clave, f.valores]; }), todas.map(function (s) { return [s.nombre, s.color]; }), cfg.seleccion == null ? null : String(cfg.seleccion)])) return;
        var v = vista(contenedor);
        var elegible = typeof cfg.alElegir === 'function';

        function dibujar() {
            var activas = todas.map(function (s) { return !v.ocultas.has(s.nombre); });
            if (!activas.some(Boolean)) { v.ocultas.clear(); activas = todas.map(function () { return true; }); }
            var totalDe = function (f) { return f.valores.reduce(function (a, b, i) { return a + (activas[i] ? b : 0); }, 0); };
            contenedor.innerHTML = '';
            if (todas.length > 1) {
                contenedor.appendChild(leyenda(todas, false, cfg.interactiva ? {
                    ocultas: v.ocultas,
                    alAlternar: function (nombre) { alternarSerie(v, todas, nombre); dibujar(); }
                } : null));
            }
            var max = 0;
            filas.forEach(function (f) { var t = totalDe(f); if (t > max) max = t; });
            var lista = document.createElement('div');
            lista.className = 'barras' + (cfg.seleccion != null ? ' con-seleccion' : '');
            lista.style.cssText = 'display:grid;grid-template-columns:minmax(110px,38%) minmax(0,1fr);gap:10px 12px;align-items:center';
            var tip = tooltip(contenedor);

            filas.forEach(function (f) {
                var tot = totalDe(f);
                var elegida = cfg.seleccion != null && String(f.clave) === String(cfg.seleccion);
                var nombre = document.createElement(f.enlace ? 'a' : 'div');
                if (f.enlace) { nombre.href = f.enlace; nombre.style.textDecoration = 'none'; }
                nombre.textContent = f.nombre;
                nombre.title = f.nombre;
                nombre.className = 'barras__nombre' + (elegida ? ' is-elegida' : '');
                nombre.style.cssText += ';font-size:12.5px;line-height:1.3;color:var(--n700);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical';
                var pista = document.createElement('div');
                pista.className = 'barras__pista' + (elegida ? ' is-elegida' : '');
                pista.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0';
                var barra = document.createElement('div');
                barra.className = 'marca';
                barra.tabIndex = 0;
                var resumen = f.nombre + ': ' + todas.map(function (s, i) { return activas[i] ? s.nombre + ' ' + f.valores[i] : null; }).filter(Boolean).join(', ');
                if (elegible) {
                    barra.setAttribute('role', 'button');
                    barra.setAttribute('aria-pressed', elegida ? 'true' : 'false');
                    barra.setAttribute('aria-label', resumen + '. ' + (elegida ? 'Quitar filtro' : 'Filtrar por ' + f.nombre));
                    pista.style.cursor = 'pointer';
                } else {
                    barra.setAttribute('role', 'img');
                    barra.setAttribute('aria-label', resumen);
                }
                barra.style.cssText += ';display:flex;gap:2px;height:16px;width:' + (max ? (tot / max) * 100 : 0) + '%;min-width:' + (tot ? '4px' : '0') + ';border-radius:0 4px 4px 0;overflow:hidden;outline:none';
                f.valores.forEach(function (x, i) {
                    if (!x || !activas[i]) return;
                    var s = document.createElement('div');
                    s.style.cssText = 'height:100%;background:' + todas[i].color + ';flex:' + x + ' 0 0';
                    barra.appendChild(s);
                });
                var val = document.createElement('span');
                val.textContent = num(tot);
                val.style.cssText = 'font:600 12px var(--fx);color:var(--n800);font-variant-numeric:tabular-nums;flex:none';
                pista.appendChild(barra);
                pista.appendChild(val);
                lista.appendChild(nombre);
                lista.appendChild(pista);

                function mostrar(ev) {
                    contenedor.classList.add('is-hover');
                    barra.classList.add('is-activa');
                    var rc = contenedor.getBoundingClientRect();
                    var rb = barra.getBoundingClientRect();
                    var px = ev && ev.clientX ? ev.clientX - rc.left : rb.right - rc.left;
                    var filasTip = todas.map(function (s, i) { return activas[i] ? { nombre: s.nombre, valor: num(f.valores[i]), color: s.color } : null; }).filter(Boolean);
                    if (filasTip.length > 1) filasTip.push({ nombre: 'Total', valor: num(tot), color: 'transparent', separador: true });
                    tip.mostrar(f.nombre, filasTip, px, rb.top - rc.top, elegible ? (elegida ? 'Clic para quitar el filtro' : cfg.pista || 'Clic para filtrar') : null);
                }
                function ocultar() { contenedor.classList.remove('is-hover'); barra.classList.remove('is-activa'); tip.ocultar(); }
                pista.addEventListener('pointermove', mostrar);
                pista.addEventListener('pointerleave', ocultar);
                barra.addEventListener('focus', function () { mostrar(null); });
                barra.addEventListener('blur', ocultar);
                if (elegible) {
                    var elegir = function () { cfg.alElegir(f); };
                    pista.addEventListener('click', elegir);
                    if (!f.enlace) { nombre.style.cursor = 'pointer'; nombre.addEventListener('click', elegir); }
                    barra.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(); } });
                }
            });
            contenedor.appendChild(lista);
            avisarVista(contenedor);
        }
        contenedor._redibujar = dibujar;
        dibujar();
    }

    // ---------------------------------------------------------- segmentada
    // cfg: { partes: [{ nombre, valor, color }], total }
    function segmentada(contenedor, cfg) {
        var partes = (cfg.partes || []);
        var total = partes.reduce(function (a, p) { return a + p.valor; }, 0);
        var pct = function (v) { return total ? Math.round((v / total) * 1000) / 10 : 0; };
        tabla(cfg.tabla, [cfg.tituloCategoria || 'Estatus', 'Reportes', '%'], partes.map(function (p) { return [p.nombre, num(p.valor), pct(p.valor) + ' %']; }));
        if (!total) return vacio(contenedor, cfg.vacioTitulo || 'Sin reportes', cfg.vacioTexto, 'pie');
        contenedor.innerHTML = '';
        var barra = document.createElement('div');
        barra.className = 'segmentada';
        barra.setAttribute('role', 'img');
        barra.setAttribute('aria-label', partes.filter(function (p) { return p.valor; }).map(function (p) { return p.nombre + ' ' + p.valor + ' (' + pct(p.valor) + ' %)'; }).join(', '));
        var tip = tooltip(contenedor);
        partes.forEach(function (p) {
            if (!p.valor) return;
            var s = document.createElement('div');
            s.style.setProperty('--c', p.color);
            s.style.flex = p.valor + ' 0 0';
            s.tabIndex = 0;
            s.setAttribute('aria-label', p.nombre + ': ' + p.valor + ' (' + pct(p.valor) + ' %)');
            barra.appendChild(s);
            function mostrar(ev) {
                var rc = contenedor.getBoundingClientRect(); var rs = s.getBoundingClientRect();
                tip.mostrar(p.nombre, [{ nombre: 'reportes · ' + pct(p.valor) + ' %', valor: num(p.valor), color: p.color }], ev && ev.clientX ? ev.clientX - rc.left : rs.left - rc.left + rs.width / 2, rs.top - rc.top);
            }
            s.addEventListener('pointermove', mostrar);
            s.addEventListener('pointerleave', tip.ocultar);
            s.addEventListener('focus', function () { mostrar(null); });
            s.addEventListener('blur', tip.ocultar);
        });
        contenedor.appendChild(barra);
        // Texto dentro del bloque solo si cabe; color según el fondo
        requestAnimationFrame(function () {
            barra.querySelectorAll('div').forEach(function (s, i) {
                var p = partes.filter(function (x) { return x.valor; })[i];
                var etiqueta = pct(p.valor) + ' %';
                var bg = getComputedStyle(s).backgroundColor.match(/\d+/g) || [0, 0, 0];
                var hex = '#' + bg.slice(0, 3).map(function (n) { return ('0' + Number(n).toString(16)).slice(-2); }).join('');
                s.style.setProperty('--tc', window.SMS ? SMS.textoSobre(hex) : '#fff');
                if (s.clientWidth > etiqueta.length * 7 + 18) s.textContent = etiqueta;
            });
        });
        var ul = document.createElement('ul');
        ul.className = 'lista-dist';
        partes.forEach(function (p) {
            var li = document.createElement('li');
            li.innerHTML = '<i></i><span></span><b></b><small></small>';
            li.querySelector('i').style.setProperty('--c', p.color);
            li.querySelector('span').textContent = p.nombre;
            li.querySelector('b').textContent = num(p.valor);
            li.querySelector('small').textContent = pct(p.valor) + ' %';
            ul.appendChild(li);
        });
        contenedor.appendChild(ul);
    }

    // -------------------------------------------------------------- matriz
    // cfg: { matriz: { probabilidad, severidad, niveles, celdas }, conteos: [{p,s,n}], seleccion, alElegir }
    function matriz(contenedor, cfg) {
        var mz = cfg.matriz;
        var conteo = {};
        (cfg.conteos || []).forEach(function (c) { conteo[c.p + '-' + c.s] = c.n; });
        var niveles = {};
        mz.niveles.forEach(function (n) { niveles[n.clave] = n; });
        var sev = mz.severidad.slice().sort(function (a, b) { return b.valor - a.valor; });
        var prob = mz.probabilidad.slice().sort(function (a, b) { return b.valor - a.valor; });
        var interactiva = typeof cfg.alElegir === 'function';

        var g = document.createElement('div');
        g.className = 'matriz';
        g.setAttribute('role', interactiva ? 'group' : 'img');
        g.setAttribute('aria-label', cfg.descripcion || 'Matriz de riesgo: probabilidad por severidad');
        var esq = document.createElement('div');
        esq.className = 'esq';
        esq.innerHTML = 'Probabilidad<br>↓ · Severidad →';
        g.appendChild(esq);
        sev.forEach(function (s) {
            var d = document.createElement('div');
            d.className = 'eje-x';
            d.innerHTML = '<b></b><span></span>';
            d.querySelector('b').textContent = s.codigo;
            d.querySelector('span').textContent = s.nombre;
            d.title = s.descripcion || s.nombre;
            g.appendChild(d);
        });
        var filasTabla = [];
        prob.forEach(function (p) {
            var y = document.createElement('div');
            y.className = 'eje-y';
            y.innerHTML = '<b></b><span></span>';
            y.querySelector('b').textContent = p.valor;
            y.querySelector('span').textContent = p.nombre;
            y.title = p.descripcion || p.nombre;
            g.appendChild(y);
            sev.forEach(function (s) {
                var clave = p.valor + '-' + s.valor;
                var nv = niveles[mz.celdas[clave]] || { color: '#8895A0', nombre: '—' };
                var n = conteo[clave] || 0;
                var c = document.createElement(interactiva ? 'button' : 'div');
                if (interactiva) { c.type = 'button'; c.setAttribute('aria-pressed', cfg.seleccion === clave ? 'true' : 'false'); }
                c.className = 'celda' + (!interactiva && !n ? ' is-vacia' : '');
                c.style.setProperty('--c', nv.color);
                c.style.setProperty('--tc', window.SMS ? SMS.textoSobre(nv.color) : '#fff');
                var cod = p.valor + s.codigo;
                c.title = cod + ' · ' + p.nombre + ' / ' + s.nombre + ' · ' + nv.nombre + (interactiva ? '' : ' · ' + n + ' reporte(s)');
                c.setAttribute('aria-label', c.title);
                c.innerHTML = '<span class="cod"></span>' + (interactiva ? '' : '<span class="cnt"></span>');
                c.querySelector('.cod').textContent = cod;
                if (!interactiva) c.querySelector('.cnt').textContent = n ? n : '';
                if (interactiva) c.addEventListener('click', function () {
                    g.querySelectorAll('.celda').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
                    c.setAttribute('aria-pressed', 'true');
                    cfg.alElegir({ probabilidad: p.valor, severidad: s.valor, codigo: cod, nivel: nv });
                });
                g.appendChild(c);
                if (n) filasTabla.push([cod + ' · ' + nv.nombre, num(n)]);
            });
        });
        contenedor.innerHTML = '';
        contenedor.appendChild(g);
        var ley = document.createElement('div');
        ley.className = 'matriz-leyenda';
        mz.niveles.forEach(function (n) {
            var sp = document.createElement('span');
            sp.innerHTML = '<i></i><span></span>';
            sp.querySelector('i').style.setProperty('--c', n.color);
            sp.querySelector('span').textContent = n.nombre + (n.prioridad ? ' — ' + n.prioridad : '');
            ley.appendChild(sp);
        });
        contenedor.appendChild(ley);
        tabla(cfg.tabla, ['Celda y nivel', 'Reportes'], filasTabla);
    }

    /** Botones "Ver tabla" → alternan la tabla de la gráfica */
    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-tabla]');
        if (!b) return;
        var t = document.getElementById(b.getAttribute('data-tabla'));
        if (!t) return;
        t.hidden = !t.hidden;
        b.setAttribute('aria-expanded', t.hidden ? 'false' : 'true');
        b.querySelector('.lbl').textContent = t.hidden ? 'Ver tabla' : 'Ocultar tabla';
    });

    // ---------------------------------------------------------------- spi
    // Columnas mensuales de un indicador con líneas de referencia (meta y alerta).
    // cfg: { etiquetas, valores (null = sin datos), formatoX, formatoV, meta, alerta, color, descripcion, alto, tabla, nombre }
    function spi(contenedor, cfg) {
        var et = cfg.etiquetas || [], vals = cfg.valores || [];
        var n = et.length;
        var fv = cfg.formatoV || function (v) { return num(v, 1); };
        if (cfg.tabla) tabla(cfg.tabla, ['Mes', cfg.nombre || 'Valor'], et.map(function (e, i) { return [(cfg.formatoX || String)(e), vals[i] == null ? 'Sin datos' : fv(vals[i])]; }));
        if (!n || !vals.some(function (v) { return v != null; })) return vacio(contenedor, 'Sin datos en el periodo', 'El indicador se calculará cuando haya registros.', 'chart-bar');

        function dibujar() {
            contenedor.innerHTML = '';
            var W = Math.max(240, contenedor.clientWidth);
            var H = cfg.alto || 120;
            var m = { t: 12, r: 6, b: 20, l: 6 };
            var iw = W - m.l - m.r, ih = H - m.t - m.b;
            var refs = [cfg.meta, cfg.alerta].filter(function (x) { return x != null; });
            var maxV = Math.max.apply(null, vals.filter(function (v) { return v != null; }).concat(refs).concat([0]));
            var maxY = escala(maxV || 1, false).max;
            var y = function (v) { return m.t + ih - (v / maxY) * ih; };
            var slot = iw / n;
            var bw = Math.max(4, Math.min(18, slot * 0.6));
            var cx = function (i) { return m.l + slot * i + slot / 2; };
            var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': cfg.descripcion || '' });
            var grupos = [];
            vals.forEach(function (v, i) {
                var g = el('g', { class: 'marca' }, svg);
                grupos.push(g);
                if (v == null) {
                    el('line', { x1: cx(i) - bw / 2, x2: cx(i) + bw / 2, y1: m.t + ih - 1, y2: m.t + ih - 1, stroke: 'var(--n300)', 'stroke-width': 2, 'stroke-dasharray': '2 2' }, g);
                    return;
                }
                var y0 = y(v), h = Math.max(1, m.t + ih - y0), x0 = cx(i) - bw / 2, r = Math.min(3, h, bw / 2), yb = y0 + h;
                el('path', { d: 'M' + x0 + ',' + yb + 'V' + (y0 + r) + 'Q' + x0 + ',' + y0 + ' ' + (x0 + r) + ',' + y0 + 'H' + (x0 + bw - r) + 'Q' + (x0 + bw) + ',' + y0 + ' ' + (x0 + bw) + ',' + (y0 + r) + 'V' + yb + 'Z', fill: cfg.color || 'var(--s1)' }, g);
            });
            if (cfg.meta != null) el('line', { class: 'ref-meta', x1: m.l, x2: W - m.r, y1: y(cfg.meta), y2: y(cfg.meta) }, svg);
            if (cfg.alerta != null) el('line', { class: 'ref-alerta', x1: m.l, x2: W - m.r, y1: y(cfg.alerta), y2: y(cfg.alerta) }, svg);
            el('line', { class: 'base', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }, svg);
            [0, n - 1].forEach(function (i, k) {
                if (k === 1 && n === 1) return;
                var t = el('text', { class: 'etq', x: cx(i), y: H - 4, 'text-anchor': n === 1 ? 'middle' : (k === 0 ? 'start' : 'end') }, svg);
                if (n > 1) t.setAttribute('x', k === 0 ? m.l : W - m.r);
                t.textContent = (cfg.formatoX || String)(et[i]);
            });
            var hit = el('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih, tabindex: 0, 'aria-label': (cfg.descripcion || 'Indicador') + '. Usa las flechas para recorrer los meses.' }, svg);
            contenedor.appendChild(svg);
            var tip = tooltip(contenedor), actual = -1;
            function marcar(i) {
                actual = i;
                contenedor.classList.add('is-hover');
                grupos.forEach(function (g, j) { g.classList.toggle('is-activa', j === i); });
                var filas = [{ nombre: cfg.nombre || 'Valor', valor: vals[i] == null ? 'Sin datos' : fv(vals[i]), color: cfg.color || 'var(--s1)' }];
                if (cfg.meta != null) filas.push({ nombre: 'Meta', valor: fv(cfg.meta), color: 'transparent' });
                if (cfg.alerta != null) filas.push({ nombre: 'Alerta', valor: fv(cfg.alerta), color: 'transparent' });
                var e = contenedor.clientWidth / W;
                tip.mostrar((cfg.formatoX || String)(et[i]), filas, cx(i) * e, y(vals[i] || 0) * e);
            }
            function limpiar() { contenedor.classList.remove('is-hover'); grupos.forEach(function (g) { g.classList.remove('is-activa'); }); tip.ocultar(); }
            hit.addEventListener('pointermove', function (ev) {
                var rc = svg.getBoundingClientRect();
                marcar(Math.max(0, Math.min(n - 1, Math.floor((((ev.clientX - rc.left) / rc.width) * W - m.l) / slot))));
            });
            hit.addEventListener('pointerleave', limpiar);
            hit.addEventListener('focus', function () { marcar(actual < 0 ? n - 1 : actual); });
            hit.addEventListener('blur', limpiar);
            hit.addEventListener('keydown', function (ev) {
                if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
                ev.preventDefault();
                marcar(Math.max(0, Math.min(n - 1, (actual < 0 ? n - 1 : actual) + (ev.key === 'ArrowRight' ? 1 : -1))));
            });
        }
        dibujar();
        alRedimensionar(contenedor, dibujar);
    }

    // ---------------------------------------------------------------- dona
    // Parte-del-todo en anillo (≤ 6 partes) con la lista de valores al lado: la
    // lista da las cifras exactas, el anillo solo la proporción a simple vista.
    // cfg: { partes: [{ clave, nombre, valor, color, detalle? }], centro ('reportes'),
    //        alElegir(parte), seleccion (clave elegida), pista, tabla, tituloCategoria, vacioTitulo, vacioTexto }
    function dona(contenedor, cfg) {
        var partes = cfg.partes || [];
        var total = partes.reduce(function (a, p) { return a + p.valor; }, 0);
        var pct = function (x) { return total ? Math.round((x / total) * 1000) / 10 : 0; };
        tabla(cfg.tabla, [cfg.tituloCategoria || 'Estatus', 'Reportes', '%'], partes.map(function (p) {
            return [p.nombre + (p.detalle ? ' (' + p.detalle + ')' : ''), num(p.valor), num(pct(p.valor), 1) + ' %'];
        }));
        if (!total) return vacio(contenedor, cfg.vacioTitulo || 'Sin reportes', cfg.vacioTexto, 'pie');
        if (sinCambios(contenedor, [partes.map(function (p) { return [p.clave, p.nombre, p.valor, p.color, p.detalle]; }), cfg.seleccion == null ? null : String(cfg.seleccion)])) return;
        var elegible = typeof cfg.alElegir === 'function';

        function dibujar(animar) {
            contenedor.innerHTML = '';
            var caja = document.createElement('div');
            caja.className = 'dona' + (cfg.seleccion != null ? ' con-seleccion' : '');
            var S = 200, c = S / 2, R = 92, r = 64;
            var svg = el('svg', { viewBox: '0 0 ' + S + ' ' + S, role: 'img', class: 'dona__anillo',
                'aria-label': partes.filter(function (p) { return p.valor; }).map(function (p) { return p.nombre + ' ' + p.valor + ' (' + num(pct(p.valor), 1) + ' %)'; }).join(', ') });
            var tip = tooltip(contenedor);
            var sectores = {}, filasLista = {};
            var a0 = -Math.PI / 2;
            var conValor = partes.filter(function (p) { return p.valor > 0; });
            var punto = function (rad, a) { return (c + rad * Math.cos(a)).toFixed(2) + ',' + (c + rad * Math.sin(a)).toFixed(2); };
            conValor.forEach(function (p) {
                var marca;
                if (conValor.length === 1) {
                    marca = el('circle', { class: 'sector', cx: c, cy: c, r: (R + r) / 2, fill: 'none', stroke: p.color, 'stroke-width': R - r }, svg);
                } else {
                    var a1 = a0 + (p.valor / total) * Math.PI * 2;
                    var grande = a1 - a0 > Math.PI ? 1 : 0;
                    marca = el('path', {
                        class: 'sector',
                        d: 'M' + punto(R, a0) + 'A' + R + ',' + R + ' 0 ' + grande + ' 1 ' + punto(R, a1) +
                           'L' + punto(r, a1) + 'A' + r + ',' + r + ' 0 ' + grande + ' 0 ' + punto(r, a0) + 'Z',
                        fill: p.color, stroke: 'var(--sf)', 'stroke-width': 2, 'stroke-linejoin': 'round'
                    }, svg);
                    a0 = a1;
                }
                if (cfg.seleccion != null && String(cfg.seleccion) !== String(p.clave)) marca.classList.add('is-atenuada');
                sectores[p.clave] = marca;
                marca.addEventListener('pointermove', function (ev) { resaltar(p, ev); });
                marca.addEventListener('pointerleave', apagar);
                if (elegible) { marca.style.cursor = 'pointer'; marca.addEventListener('click', function () { cfg.alElegir(p); }); }
            });
            var tt = el('text', { class: 'dona__total', x: c, y: c + 4, 'text-anchor': 'middle' }, svg);
            tt.textContent = num(total);
            var tl = el('text', { class: 'dona__lbl', x: c, y: c + 24, 'text-anchor': 'middle' }, svg);
            tl.textContent = cfg.centro || 'reportes';
            caja.appendChild(svg);
            animarEntrada(svg, animar);

            var ul = document.createElement('ul');
            ul.className = 'dona__lista';
            partes.forEach(function (p) {
                var li = document.createElement('li');
                var fila = document.createElement(elegible ? 'button' : 'div');
                fila.className = 'dona__fila';
                var elegida = cfg.seleccion != null && String(cfg.seleccion) === String(p.clave);
                if (elegible) {
                    fila.type = 'button';
                    fila.setAttribute('aria-pressed', elegida ? 'true' : 'false');
                    fila.setAttribute('data-tip', elegida ? 'Quitar el filtro' : 'Filtrar: ' + p.nombre);
                    fila.addEventListener('click', function () { cfg.alElegir(p); });
                }
                fila.innerHTML = '<i></i><span class="n"><span></span><small></small></span><b></b><small class="pct"></small>';
                fila.querySelector('i').style.setProperty('--c', p.color);
                fila.querySelector('.n > span').textContent = p.nombre;
                fila.querySelector('.n > small').textContent = p.detalle || '';
                fila.querySelector('b').textContent = num(p.valor);
                fila.querySelector('.pct').textContent = num(pct(p.valor), 1) + ' %';
                fila.addEventListener('pointerenter', function () { resaltar(p, null, true); });
                fila.addEventListener('pointerleave', apagar);
                fila.addEventListener('focus', function () { resaltar(p, null, true); });
                fila.addEventListener('blur', apagar);
                filasLista[p.clave] = fila;
                li.appendChild(fila);
                ul.appendChild(li);
            });
            caja.appendChild(ul);
            contenedor.appendChild(caja);

            function resaltar(p, ev, sinTip) {
                caja.classList.add('is-hover');
                Object.keys(sectores).forEach(function (k) { sectores[k].classList.toggle('is-activa', String(k) === String(p.clave)); });
                Object.keys(filasLista).forEach(function (k) { filasLista[k].classList.toggle('is-activa', String(k) === String(p.clave)); });
                if (sinTip || !ev) return;
                var rc = contenedor.getBoundingClientRect();
                var filas = [{ nombre: 'reportes · ' + num(pct(p.valor), 1) + ' %', valor: num(p.valor), color: p.color }];
                if (p.detalle) filas.push({ nombre: p.detalle, valor: '', color: 'transparent', separador: true });
                var elegida = cfg.seleccion != null && String(cfg.seleccion) === String(p.clave);
                tip.mostrar(p.nombre, filas, ev.clientX - rc.left, ev.clientY - rc.top, elegible ? (elegida ? 'Clic para quitar el filtro' : cfg.pista || 'Clic para filtrar') : null);
            }
            function apagar() {
                caja.classList.remove('is-hover');
                Object.keys(sectores).forEach(function (k) { sectores[k].classList.remove('is-activa'); });
                Object.keys(filasLista).forEach(function (k) { filasLista[k].classList.remove('is-activa'); });
                tip.ocultar();
            }
        }
        contenedor._redibujar = function () { dibujar(false); };
        dibujar(true);
    }

    /** Quita el zoom y vuelve a mostrar todas las series */
    function restablecer(contenedor) {
        var v = vista(contenedor);
        v.ocultas.clear();
        v.zoom = null;
        if (contenedor._redibujar) contenedor._redibujar();
        avisarVista(contenedor);
    }

    // ------------------------------------------------------- exportar PNG
    // Copia la tarjeta (título, subtítulo, leyenda y gráfica) con sus estilos ya
    // calculados, incrusta las fuentes y los iconos, la envuelve en un SVG
    // <foreignObject> y la rasteriza a 2× en un canvas. No usa recursos externos.
    var recursosPNG = null;
    function aDataURL(blob) {
        return new Promise(function (ok, mal) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = mal; r.readAsDataURL(blob); });
    }
    function cargarRecursosPNG() {
        if (recursosPNG) return recursosPNG;
        var fuente = function (familia, url) {
            return fetch(url).then(function (r) { return r.ok ? r.blob() : null; })
                .then(function (b) { return b ? aDataURL(b) : null; })
                .then(function (d) { return d ? '@font-face{font-family:"' + familia + '";font-style:normal;font-weight:100 900;src:url(' + d + ') format("woff2");}' : ''; })
                .catch(function () { return ''; });
        };
        recursosPNG = Promise.all([
            fuente('Inter', '/fonts/inter-latin-wght.woff2'),
            fuente('Montserrat', '/fonts/montserrat-latin-wght.woff2'),
            fetch('/img/icons.svg').then(function (r) { return r.text(); })
                .then(function (t) { return new DOMParser().parseFromString(t, 'image/svg+xml'); })
                .catch(function () { return null; })
        ]).then(function (r) { return { css: r[0] + r[1], iconos: r[2] }; });
        return recursosPNG;
    }
    // Propiedades que definen el aspecto (copiarlas todas haría la imagen enorme)
    var PROPS_HTML = ('display position top right bottom left z-index box-sizing width height min-width min-height max-width max-height ' +
        'margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left ' +
        'border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style ' +
        'border-top-color border-right-color border-bottom-color border-left-color border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius ' +
        'background-color background-image color opacity visibility overflow-x overflow-y box-shadow ' +
        'font-family font-size font-weight font-style font-variant-numeric line-height letter-spacing text-transform text-align text-overflow text-decoration-line ' +
        'white-space word-break overflow-wrap vertical-align list-style-type -webkit-line-clamp -webkit-box-orient ' +
        'flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self align-content justify-content justify-items order row-gap column-gap ' +
        'grid-template-columns grid-template-rows grid-column-start grid-column-end grid-row-start grid-row-end grid-auto-flow ' +
        'fill fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-linecap stroke-linejoin text-anchor').split(' ');
    var PROPS_SVG = ('display opacity visibility fill fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin ' +
        'font-family font-size font-weight font-variant-numeric letter-spacing text-anchor color').split(' ');
    function clonarConEstilos(orig) {
        if (orig.nodeType === 3) return document.createTextNode(orig.nodeValue);
        if (orig.nodeType !== 1) return null;
        var cs = getComputedStyle(orig);
        if (cs.display === 'none') return null;
        var c = orig.cloneNode(false);
        var interno = orig instanceof SVGElement && orig.tagName.toLowerCase() !== 'svg';
        var props = interno ? PROPS_SVG : PROPS_HTML;
        var txt = '';
        for (var i = 0; i < props.length; i++) {
            var val = cs.getPropertyValue(props[i]);
            if (val !== '') txt += props[i] + ':' + val + ';';
        }
        c.setAttribute('style', txt);
        for (var n = orig.firstChild; n; n = n.nextSibling) {
            var k = clonarConEstilos(n);
            if (k) c.appendChild(k);
        }
        return c;
    }
    // <use href="/img/icons.svg#i-x"> no se resuelve dentro de una imagen: se copia el símbolo
    function incrustarIconos(raiz, iconos) {
        raiz.querySelectorAll('use').forEach(function (u) {
            var ref = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').split('#')[1];
            var sim = iconos && ref ? iconos.getElementById(ref) : null;
            var svg = u.parentNode;
            if (!sim) { u.remove(); return; }
            svg.setAttribute('viewBox', sim.getAttribute('viewBox') || '0 0 24 24');
            var g = document.createElementNS(NS, 'g');
            ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'].forEach(function (a) {
                if (sim.getAttribute(a)) g.setAttribute('style', (g.getAttribute('style') || '') + a + ':' + sim.getAttribute(a) + ';');
            });
            Array.prototype.forEach.call(sim.childNodes, function (h) { g.appendChild(document.importNode(h, true)); });
            svg.replaceChild(g, u);
        });
    }
    /**
     * Descarga la tarjeta como PNG.
     * opciones: { nombre: 'archivo.png', pie: 'texto de contexto (periodo, filtros…)', escala: 2 }
     * @returns {Promise<Blob>}
     */
    function exportarPNG(tarjeta, opciones) {
        opciones = opciones || {};
        var escalaPx = opciones.escala || 2;
        return cargarRecursosPNG().then(function (rec) {
            var ancho = Math.ceil(tarjeta.getBoundingClientRect().width);
            var clon = clonarConEstilos(tarjeta);
            clon.querySelectorAll('.viz-acciones, .btn-tabla, .viz-tip, .viz-tabla').forEach(function (x) { x.remove(); });
            incrustarIconos(clon, rec.iconos);
            var csT = getComputedStyle(tarjeta);
            clon.style.width = ancho + 'px';
            clon.style.height = 'auto';
            clon.style.margin = '0';
            clon.style.boxShadow = 'none';
            clon.style.borderRadius = '0';
            clon.style.backgroundColor = csT.backgroundColor;
            if (opciones.pie) {
                var pie = document.createElement('div');
                pie.textContent = opciones.pie;
                pie.setAttribute('style', 'padding:10px 20px 14px;border-top:1px solid ' + csT.borderTopColor + ';font:400 11.5px/1.45 Inter,"Segoe UI",Arial,sans-serif;color:' +
                    getComputedStyle(document.body).getPropertyValue('--n500') + ';');
                clon.appendChild(pie);
            }
            var st = document.createElement('style');
            st.textContent = rec.css;
            clon.insertBefore(st, clon.firstChild);
            // Medir el alto real fuera de la vista
            var host = document.createElement('div');
            host.setAttribute('style', 'position:fixed;left:-100000px;top:0;width:' + ancho + 'px;pointer-events:none;');
            host.appendChild(clon);
            document.body.appendChild(host);
            var alto = Math.ceil(clon.getBoundingClientRect().height);
            document.body.removeChild(host);

            var xhtml = new XMLSerializer().serializeToString(clon);
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + ancho * escalaPx + '" height="' + alto * escalaPx + '" viewBox="0 0 ' + ancho + ' ' + alto + '">' +
                '<foreignObject x="0" y="0" width="' + ancho + '" height="' + alto + '">' + xhtml + '</foreignObject></svg>';
            return new Promise(function (ok, mal) {
                var img = new Image();
                img.onload = function () {
                    var cv = document.createElement('canvas');
                    cv.width = ancho * escalaPx;
                    cv.height = alto * escalaPx;
                    var ctx = cv.getContext('2d');
                    ctx.fillStyle = csT.backgroundColor;
                    ctx.fillRect(0, 0, cv.width, cv.height);
                    ctx.drawImage(img, 0, 0, cv.width, cv.height);
                    cv.toBlob(function (b) { if (b) ok(b); else mal(new Error('No se pudo generar la imagen')); }, 'image/png');
                };
                img.onerror = function () { mal(new Error('No se pudo generar la imagen')); };
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            });
        }).then(function (blob) {
            if (opciones.descargar !== false) {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = opciones.nombre || 'grafica.png';
                document.body.appendChild(a);
                a.click();
                setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            }
            return blob;
        });
    }

    window.SMSGraficas = {
        lineas: lineas, columnas: columnas, barras: barras, segmentada: segmentada, matriz: matriz, vacio: vacio, spi: spi, tabla: tabla,
        dona: dona, restablecer: restablecer, exportarPNG: exportarPNG
    };
})();
