/* S.A.G.A. · Armado del PDF de la vista general (jsPDF + AutoTable)
   No usa el DOM: corre dentro de un Web Worker (public/js/sms-pdf-worker.js)
   para no congelar la página con miles de filas, o en la página como respaldo.
   Recibe datos ya consultados (mismos endpoints que la vista general) y las
   gráficas ya convertidas a PNG; devuelve el PDF como ArrayBuffer.

   Estructura del documento:
     encabezado institucional (logotipo, S.A.G.A., título, fecha, periodo, filtros)
     1. Resumen ejecutivo (puntos clave + tarjetas de indicadores con variación)
     2. Gráficas elegidas (cada una entera en su página, nunca partida)
     3. Tablas de resultados (comparación, estatus, áreas, categorías, riesgo)
     4. Listado de reportes (encabezado repetido, filas sin partir)
     5. Observaciones y notas metodológicas (solo si hay algo pertinente)
     Encabezado y pie en todas las páginas, con "Página X de Y".            */
(function (raiz) {
    'use strict';

    var X = raiz.SMSExportacion;
    var PT = 0.3528;   // mm por punto tipográfico

    // Paleta (tokens claros de saga.css)
    var COL = {
        v700: [5, 102, 83], v600: [7, 140, 114], v100: [225, 244, 240], v50: [240, 249, 248],
        n900: [20, 26, 31], n800: [29, 37, 42], n700: [43, 52, 59], n600: [74, 85, 94], n500: [103, 116, 126],
        n400: [136, 149, 160], n300: [177, 186, 193], n200: [212, 217, 220], n100: [229, 232, 235], n50: [243, 245, 246],
        r700: [169, 40, 61], r600: [207, 50, 76], amb: [224, 160, 48], ambT: [135, 86, 31], az: [45, 107, 179], blanco: [255, 255, 255],
        fila: [248, 250, 249]
    };
    var TONO = { brand: COL.v700, warn: COL.amb, info: COL.az, ok: COL.v600, neutro: COL.n500, crit: COL.r600 };
    var VAR = { bueno: COL.v700, malo: COL.r700, neutro: COL.n600, igual: COL.n500, nd: COL.n400 };
    // Mismos 4 grupos de color que las gráficas y tarjetas
    var COLOR_ESTADO = { A: [224, 160, 48], B: [45, 107, 179], C: [45, 107, 179], D: [7, 140, 114], E: [74, 85, 94], F: [74, 85, 94] };
    var COLOR_SEMAFORO = {
        'Vencido': COL.r600, 'Próximo a vencer': COL.amb, 'En tiempo': COL.v600, 'Sin plazo': COL.n300,
        'Cerrado en plazo': COL.v600, 'Cerrado fuera de plazo': COL.r600, 'Cerrado sin plazo': COL.n300
    };
    var MAX_TEXTO = 700;   // caracteres por celda de texto largo en el listado

    // Helvetica estándar usa WinAnsi: se sustituye lo que no puede dibujar
    var FUERA_WINANSI = /[^\t\n\r\x20-\x7E\xA0-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g;
    function T(s) {
        return String(s == null ? '' : s).normalize('NFC')
            .replace(/−/g, '–').replace(/[‐‑]/g, '-')
            .replace(/[     ]/g, ' ').replace(/[​-‍﻿]/g, '')
            .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/×/g, '×')
            .replace(FUERA_WINANSI, '');
    }
    function hexRGB(h) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
        if (!m) return COL.n400;
        var n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function construir(d, avisar) {
        avisar = avisar || function () {};
        var jsPDF = (raiz.jspdf && raiz.jspdf.jsPDF) || raiz.jsPDF;
        var autoTable = raiz.autoTable || (raiz.jspdf_autotable && raiz.jspdf_autotable.autoTable);
        if (!jsPDF || !autoTable) throw new Error('No se cargaron las bibliotecas del PDF');

        var op = d.opciones, ind = d.indicadores, comp = d.comparacion || null, ana = d.analisis || null, meta = d.meta;
        var nc = X.nombresComparacion(comp);
        var defs = op.indicadores.map(function (k) { return X.INDICADOR[k]; });
        var cols = op.contenido.detalle ? op.columnas.map(function (k) { return X.COLUMNA[k]; }).filter(function (c) { return !c.soloExcel; }) : [];

        // ----------------------------------------------------- orientación
        var ANCHO_V = X.ANCHO_UTIL_VERTICAL, ANCHO_H = 297 - 28;
        var requerido = X.anchoListado(op);
        var horizontal = X.orientacionPdf(op) === 'horizontal';
        var doc = new jsPDF({ orientation: horizontal ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
        var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
        var M = { izq: 14, der: 14, sup: 23, inf: 17 };
        var U = { x: M.izq, ancho: W - M.izq - M.der, fin: H - M.inf };
        var y = M.sup;

        doc.setProperties({
            title: T(op.titulo), subject: 'Seguridad operacional · SMS', creator: 'S.A.G.A. · AIFA',
            author: T(meta.usuario ? meta.usuario.nombre : 'S.A.G.A. · AIFA'),
            keywords: 'SMS, hallazgos, seguridad operacional, AIFA'
        });
        try { doc.setLanguage('es-MX'); } catch (e) { /* opcional */ }
        doc.setLineHeightFactor(1.3);

        // ------------------------------------------------- utilidades de trazo
        function fuente(estilo, tam, color) {
            doc.setFont('helvetica', estilo || 'normal');
            doc.setFontSize(tam);
            doc.setTextColor.apply(doc, color || COL.n800);
        }
        function nuevaPagina() { doc.addPage(); y = M.sup; }
        function espacio(h) { if (y + h > U.fin) { nuevaPagina(); return true; } return false; }
        function texto(t, x, yy, o) { doc.text(T(t), x, yy, Object.assign({ baseline: 'top' }, o || {})); }
        function lineas(t, ancho, tam) {
            doc.setFontSize(tam);
            return doc.splitTextToSize(T(t), ancho);
        }
        function alto(tam, n) { return (n || 1) * tam * PT * 1.3; }
        function parrafo(t, o) {
            o = o || {};
            var tam = o.tam || 9, sang = o.sangria || 0;
            fuente(o.estilo, tam, o.color);
            var ls = lineas(t, (o.ancho || U.ancho) - sang, tam);
            var lh = alto(tam);
            if (o.juntas) espacio(lh * ls.length);
            ls.forEach(function (l, i) {
                if (espacio(lh)) fuente(o.estilo, tam, o.color);
                if (i === 0 && o.marca) o.marca(U.x, y, lh);
                texto(l, U.x + sang, y);
                y += lh;
            });
            y += o.despues == null ? 1.2 : o.despues;
        }
        var numSeccion = 0;
        // minimo: alto que debe caber junto con el título (evita títulos huérfanos al pie)
        function seccion(titulo, intro, minimo) {
            espacio(Math.max(24, minimo || 0));
            numSeccion++;
            y += 3;
            doc.setFillColor.apply(doc, COL.v600);
            doc.rect(U.x, y + 0.6, 1.1, 5, 'F');
            fuente('bold', 13, COL.n900);
            texto(numSeccion + '. ' + titulo, U.x + 3.5, y);
            y += 8.2;
            if (intro) parrafo(intro, { tam: 8.5, color: COL.n500, despues: 2.5 });
        }
        function subtitulo(t, nota, minimo) {
            espacio(minimo || 22);
            fuente('bold', 10, COL.n900);
            texto(t, U.x, y);
            y += 5.6;
            if (nota) parrafo(nota, { tam: 7.8, color: COL.n500, despues: 1.6 });
        }

        // ----------------------------------------------------------- portada
        var logo = d.imagenes && d.imagenes.logo, estela = d.imagenes && d.imagenes.estela;
        function barraEstela(yy, alto, x, ancho) {
            if (estela) doc.addImage(estela.datos, 'PNG', x == null ? U.x : x, yy, ancho == null ? U.ancho : ancho, alto, 'estela', 'FAST');
            else { doc.setFillColor.apply(doc, COL.v600); doc.rect(x == null ? U.x : x, yy, ancho == null ? U.ancho : ancho, alto, 'F'); }
        }
        (function portada() {
            var top = 11, hLogo = 8.6;
            var xs = U.x;
            if (logo) {
                var wLogo = hLogo * logo.w / logo.h;
                doc.addImage(logo.datos, 'PNG', U.x, top, wLogo, hLogo, 'logo', 'FAST');
                xs = U.x + wLogo + 4.5;
                doc.setDrawColor.apply(doc, COL.n200);
                doc.setLineWidth(0.3);
                doc.line(xs, top + 0.6, xs, top + hLogo - 0.6);
                xs += 4.5;
            }
            fuente('bold', 12.5, COL.n900);
            texto('S.A.G.A.', xs, top + 1.4, { charSpace: 0.35 });
            var wSaga = doc.getTextWidth('S.A.G.A.') + 0.35 * 7;
            barraEstela(top + 6.6, 0.55, xs, wSaga);
            fuente('normal', 7.5, COL.n600);
            texto('Seguridad operacional · SMS', U.x + U.ancho, top + 0.8, { align: 'right' });
            fuente('normal', 7, COL.n500);
            texto('Documento de uso interno', U.x + U.ancho, top + 4.6, { align: 'right' });
            y = top + hLogo + 4;
            barraEstela(y, 0.9);
            y += 6;
            fuente('bold', 18, COL.n900);
            var tl = lineas(op.titulo, U.ancho, 18);
            doc.text(tl, U.x, y, { baseline: 'top' });
            y += alto(18, tl.length) + 0.6;
            fuente('normal', 8.5, COL.n600);
            texto('Generado el ' + X.fechaHora(meta.generado) + (meta.usuario ? ' · por ' + meta.usuario.nombre + (meta.usuario.departamento ? ' (' + meta.usuario.departamento + ')' : '') : ''), U.x, y);
            y += 6;

            // Datos de la consulta
            var otros = (meta.filtrosActivos || []).filter(function (f) { return f.clave !== 'rango' && f.clave !== 'fecha'; });
            var filasMeta = [
                ['Periodo consultado', meta.periodoTexto],
                nc ? ['Comparado con', nc.rangoAnterior + ' · ' + nc.nota] : null,
                ['Filtros aplicados', otros.length ? otros.map(function (f) { return f.etiqueta + ': ' + f.valor; }).join(' · ') : 'Ninguno además del periodo (todos los reportes)'],
                ['Reportes incluidos', X.numero(ind.total) + (op.contenido.detalle ? ' · listado de ' + X.numero((d.filas || []).length) + (meta.ordenTexto ? ', ordenado por ' + meta.ordenTexto : '') : '')]
            ].filter(Boolean);
            var anchoEtq = 34, pad = 3.2, anchoVal = U.ancho - anchoEtq - pad * 2;
            var bloques = filasMeta.map(function (f) { return { etq: f[0], ls: lineas(f[1], anchoVal, 8.5) }; });
            var hCaja = pad * 2 + bloques.reduce(function (s, b) { return s + alto(8.5, b.ls.length) + 1.4; }, 0) - 1.4;
            doc.setFillColor.apply(doc, COL.n50);
            doc.setDrawColor.apply(doc, COL.n100);
            doc.setLineWidth(0.25);
            doc.roundedRect(U.x, y, U.ancho, hCaja, 1.6, 1.6, 'FD');
            var yy = y + pad;
            bloques.forEach(function (b) {
                fuente('bold', 7, COL.n600);
                texto(b.etq.toUpperCase(), U.x + pad, yy + 0.5, { charSpace: 0.2 });
                fuente('normal', 8.5, COL.n900);
                doc.text(b.ls, U.x + pad + anchoEtq, yy, { baseline: 'top' });
                yy += alto(8.5, b.ls.length) + 1.4;
            });
            y += hCaja + 4;
        })();

        // ------------------------------------------------- 1. Resumen ejecutivo
        avisar({ texto: 'Resumen ejecutivo', avance: 0.05 });
        seccion('Resumen ejecutivo', null);
        X.resumenEjecutivo(ind, comp).forEach(function (p) {
            parrafo(p, {
                tam: 9, color: COL.n800, sangria: 4, despues: 1.2,
                marca: function (x, yy) { doc.setFillColor.apply(doc, COL.v600); doc.circle(x + 1.2, yy + 1.75, 0.65, 'F'); }
            });
        });
        if (defs.length) {
            y += 2;
            var porFila = horizontal ? 4 : 3, gap = 3.2;
            var wTar = (U.ancho - gap * (porFila - 1)) / porFila, hTar = 23.5;
            if (nc) {
                fuente('normal', 7.5, COL.n500);
                espacio(6);
                texto('Variación: ' + (comp.automatico ? 'últimos ' + comp.dias + ' días frente a los ' + comp.dias + ' previos' : 'frente al ' + nc.rangoAnterior) + '. Verde: mejora · rojo: empeora · gris: sin juicio de valor.', U.x, y);
                y += 5;
            }
            for (var i = 0; i < defs.length; i += porFila) {
                espacio(hTar + gap);
                defs.slice(i, i + porFila).forEach(function (def, j) {
                    tarjeta(def, U.x + j * (wTar + gap), y, wTar, hTar);
                });
                y += hTar + gap;
            }
            var co = ind.coherencia || {};
            if (ind.total) {
                parrafo('Cuadre: ' + X.numero(ind.total) + ' = ' + X.plural(ind.nuevos, 'nuevo', 'nuevos') + ' + ' + X.numero(ind.en_atencion) + ' en atención + ' +
                    X.plural(ind.resueltos, 'resuelto', 'resueltos') + ' + ' + X.plural(ind.duplicados, 'duplicado', 'duplicados') + ' + ' + X.numero(ind.no_requiere) + ' no requiere(n) atención. ' +
                    (co.total_igual_abiertos_mas_cerrados && co.cerrados_igual_suma_de_cierres && co.abiertos_igual_nuevos_mas_atencion ? 'Las cifras cuadran.' : 'Las cifras no cuadran: revisa la calidad de datos.'),
                { tam: 7.5, color: COL.n500 });
            }
        }
        function tarjeta(def, x, yy, w, h) {
            var v = def.v(ind);
            doc.setDrawColor.apply(doc, COL.n100);
            doc.setFillColor.apply(doc, COL.blanco);
            doc.setLineWidth(0.3);
            doc.roundedRect(x, yy, w, h, 1.8, 1.8, 'FD');
            doc.setFillColor.apply(doc, TONO[def.tono] || COL.n500);
            doc.rect(x + 0.15, yy + 3, 0.9, h - 6, 'F');
            var xi = x + 4, wi = w - 7;
            fuente('bold', 6.6, COL.n600);
            texto(lineas(def.t.toUpperCase(), wi, 6.6)[0], xi, yy + 3, { charSpace: 0.15 });
            if (v == null) { fuente('normal', 11, COL.n400); texto('Sin datos', xi, yy + 8); }
            else { fuente('bold', 15.5, COL.n900); texto(X.cifraTexto(def, v), xi, yy + 7.2); }
            if (nc && v != null) {
                var va = X.variacion(def, comp);
                var c = VAR[va.tono] || COL.n400;
                var yv = yy + 15.2;
                var xt = xi;
                if (va.estado === 'cambio') {
                    doc.setFillColor.apply(doc, c);
                    if (va.sube) doc.triangle(xi, yv + 2.3, xi + 2.4, yv + 2.3, xi + 1.2, yv + 0.2, 'F');
                    else doc.triangle(xi, yv + 0.3, xi + 2.4, yv + 0.3, xi + 1.2, yv + 2.4, 'F');
                    xt += 3.4;
                } else if (va.estado === 'igual') {
                    doc.setFillColor.apply(doc, c);
                    doc.rect(xi, yv + 1.1, 2.2, 0.45, 'F');
                    xt += 3.4;
                }
                fuente(va.estado === 'cambio' ? 'bold' : 'normal', 7.4, c);
                var vt = va.texto + (va.textoDif && va.rel != null ? '  (' + va.textoDif + ')' : '');
                texto(vt, xt, yv);
                if (comp.automatico && va.estado !== 'nd') {
                    var wv = doc.getTextWidth(T(vt));
                    fuente('normal', 6.4, COL.n500);
                    texto('últ. ' + comp.dias + ' días', xt + wv + 1.5, yv + 0.35);
                }
            }
            fuente('normal', 6.4, COL.n500);
            texto(lineas(def.det(ind), wi, 6.4)[0] || '', xi, yy + h - 4.6);
        }

        // ------------------------------------------------------- 2. Gráficas
        var graficas = d.graficas || [];
        if (graficas.length) {
            avisar({ texto: 'Gráficas', avance: 0.15 });
            // Medidas de una gráfica dentro de una columna de ancho dado
            var medir = function (g, anchoCol) {
                var w = Math.min(anchoCol, g.anchoPx * U.ancho / g.anchoRef), h = w * g.img.h / g.img.w;
                var lsSub = g.sub ? lineas(g.sub, anchoCol, 7.8) : [];
                var lsNota = g.nota ? lineas(g.nota, anchoCol, 7.6) : [];
                var cabeza = 5.6 + (lsSub.length ? alto(7.8, lsSub.length) + 1.6 : 0);
                var pie = lsNota.length ? alto(7.6, lsNota.length) + 2 : 0;
                var disponible = (U.fin - M.sup) - cabeza - pie - 8;
                if (h > disponible) { w = w * disponible / h; h = disponible; }
                return { g: g, w: w, h: h, lsSub: lsSub, lsNota: lsNota, cabeza: cabeza, pie: pie, total: cabeza + h + pie };
            };
            var dibujar = function (m, x, y0) {
                var yy = y0;
                fuente('bold', 10, COL.n900);
                texto(m.g.titulo, x, yy);
                yy += 5.6;
                if (m.lsSub.length) { fuente('normal', 7.8, COL.n500); doc.text(m.lsSub, x, yy, { baseline: 'top' }); yy += alto(7.8, m.lsSub.length) + 1.6; }
                doc.addImage(m.g.img.datos, 'PNG', x, yy, m.w, m.h, 'graf-' + m.g.k, 'FAST');
                yy += m.h + 1.5;
                if (m.lsNota.length) { fuente('italic', 7.6, COL.n600); doc.text(m.lsNota, x, yy, { baseline: 'top' }); yy += alto(7.6, m.lsNota.length) + 2; }
                return yy;
            };
            var GAP = 8;
            var g0 = graficas[0], g1 = graficas[1];
            var primera = !g0.img ? 20 : (g0.mitad && g1 && g1.mitad && g1.img
                ? Math.max(medir(g0, (U.ancho - GAP) / 2).total, medir(g1, (U.ancho - GAP) / 2).total)
                : medir(g0, g0.mitad ? (U.ancho - GAP) / 2 : U.ancho).total);
            seccion('Gráficas', 'Mismos filtros y periodo del documento. ' + (graficas.length === 1 ? 'Se incluye la gráfica elegida.' : 'Se incluyen las ' + graficas.length + ' gráficas elegidas.'), primera + 26);
            for (var gi = 0; gi < graficas.length; gi++) {
                var g = graficas[gi];
                if (!g.img) {
                    // Sin datos para esta gráfica: se dice en texto (no se dibuja un lienzo vacío)
                    espacio(20);
                    y += 2;
                    fuente('bold', 10, COL.n900);
                    texto(g.titulo, U.x, y);
                    y += 5.6;
                    parrafo(g.vacio || 'Sin datos para esta gráfica con los filtros del documento.', { tam: 8.2, estilo: 'italic', color: COL.n500, despues: 5 });
                    continue;
                }
                var sig = graficas[gi + 1];
                if (g.mitad && sig && sig.mitad && sig.img) {
                    // En horizontal, dos gráficas compactas lado a lado (ninguna se parte)
                    var anchoCol = (U.ancho - GAP) / 2;
                    var a = medir(g, anchoCol), b = medir(sig, anchoCol);
                    espacio(Math.max(a.total, b.total) + 8);
                    y += 2;
                    var fa = dibujar(a, U.x, y), fb = dibujar(b, U.x + anchoCol + GAP, y);
                    y = Math.max(fa, fb) + 4;
                    gi++;
                    continue;
                }
                var m = medir(g, g.mitad ? (U.ancho - GAP) / 2 : U.ancho);
                espacio(m.total + 8);
                y += 2;
                y = dibujar(m, U.x, y) + 4;
            }
        }

        // ------------------------------------------------- tablas (AutoTable)
        var BASE_TABLA = {
            theme: 'plain',
            styles: { font: 'helvetica', fontSize: 8, textColor: COL.n800, cellPadding: { top: 1.6, right: 2.2, bottom: 1.6, left: 2.2 },
                lineColor: COL.n100, lineWidth: { bottom: 0.2 }, overflow: 'linebreak', valign: 'top' },
            headStyles: { fillColor: COL.v700, textColor: COL.blanco, fontStyle: 'bold', fontSize: 7.4, valign: 'middle', lineWidth: 0 },
            footStyles: { fillColor: COL.v50, textColor: COL.n900, fontStyle: 'bold', lineWidth: { top: 0.3 }, lineColor: COL.v600 },
            alternateRowStyles: { fillColor: COL.fila },
            margin: { left: M.izq, right: M.der, top: M.sup, bottom: M.inf },
            rowPageBreak: 'avoid', showHead: 'everyPage', showFoot: 'lastPage', tableWidth: 'auto'
        };
        function tabla(opciones) {
            var cfg = Object.assign({}, BASE_TABLA, opciones, { startY: y });
            cfg.styles = Object.assign({}, BASE_TABLA.styles, opciones.styles || {});
            cfg.headStyles = Object.assign({}, BASE_TABLA.headStyles, opciones.headStyles || {});
            autoTable(doc, cfg);
            y = doc.lastAutoTable.finalY + 6;
        }
        var DER = { halign: 'right' };
        function pct(n, t) { return t ? X.numero(n / t * 100, 1) + ' %' : '—'; }
        function textoVar(def, va) { return va.estado === 'cambio' && va.rel != null ? va.texto + ' (' + va.textoDif + ')' : va.texto; }

        var hayTablas = (op.contenido.comparativo && comp && defs.length) || (op.contenido.tablas && ana);
        if (hayTablas) {
            avisar({ texto: 'Tablas de resultados', avance: 0.3 });
            seccion('Tablas de resultados', null, 62);
            if (op.contenido.comparativo && comp && defs.length) {
                subtitulo('Comparación con el periodo anterior', nc.nota + ' Mismos filtros; el estatus es el vigente hoy.');
                tabla({
                    head: [['Indicador', nc.actual + '\n' + nc.rangoActual, nc.anterior + '\n' + nc.rangoAnterior, 'Variación', 'Lectura'].map(T)],
                    body: defs.map(function (def) {
                        var va = X.variacion(def, comp);
                        return [def.t, X.cifraTexto(def, va.act), X.cifraTexto(def, va.ant), textoVar(def, va), va.lectura].map(T);
                    }),
                    columnStyles: { 0: { fontStyle: 'bold', textColor: COL.n900 }, 1: DER, 2: DER, 3: DER },
                    didParseCell: function (c) {
                        if (c.section === 'head' && c.column.index >= 1 && c.column.index <= 3) c.cell.styles.halign = 'right';
                        if (c.section === 'body' && (c.column.index === 3 || c.column.index === 4)) {
                            var va = X.variacion(defs[c.row.index], comp);
                            c.cell.styles.textColor = VAR[va.tono] || COL.n400;
                            if (va.estado === 'cambio' && va.tono !== 'neutro') c.cell.styles.fontStyle = 'bold';
                        }
                    }
                });
            }
            if (op.contenido.tablas && ana) {
                var totalEst = ana.por_estatus.reduce(function (s, e) { return s + e.n; }, 0);
                subtitulo('Distribución por estatus', 'Estatus vigente de cada reporte; cada reporte cuenta una vez.');
                tabla({
                    head: [['Estatus', 'Reportes', '% del total']],
                    body: ana.por_estatus.map(function (e) { return [T(e.estado + ' · ' + X.ESTADOS[e.estado]), X.numero(e.n), pct(e.n, totalEst)]; }),
                    foot: [['Total', X.numero(totalEst), totalEst ? '100 %' : '—']],
                    tableWidth: Math.min(U.ancho, 150),
                    columnStyles: { 0: { cellWidth: 'auto' }, 1: Object.assign({ cellWidth: 28 }, DER), 2: Object.assign({ cellWidth: 28 }, DER) },
                    didParseCell: ganchos([1, 2], 0, function (i) { return COLOR_ESTADO[ana.por_estatus[i].estado]; }), didDrawCell: dibujarPunto
                });
                if (ana.por_area.length) {
                    subtitulo('Reportes por área', 'Áreas notificadas o responsables (las 15 con más reportes). Un reporte con varias áreas cuenta en cada una.');
                    tabla({
                        head: [['Área', 'Abiertos', 'Cerrados', 'Total', '% cerrado']],
                        body: ana.por_area.map(function (a) { return [T(a.nombre + (a.activo ? '' : ' (inactiva)')), X.numero(a.abiertos), X.numero(a.cerrados), X.numero(a.total), pct(a.cerrados, a.total)]; }),
                        tableWidth: Math.min(U.ancho, 210),
                        columnStyles: { 1: Object.assign({ cellWidth: 22 }, DER), 2: Object.assign({ cellWidth: 22 }, DER), 3: Object.assign({ cellWidth: 22 }, DER), 4: Object.assign({ cellWidth: 24 }, DER) },
                        didParseCell: alinearEncabezado([1, 2, 3, 4])
                    });
                }
                if (ana.categorias.length) {
                    subtitulo('Categorías más frecuentes', 'Las 10 categorías con más reportes.');
                    tabla({
                        head: [['Categoría', 'Reportes', 'Cerrados', '% cerrado']],
                        body: ana.categorias.map(function (c) { return [T(c.categoria), X.numero(c.n), X.numero(c.cerrados), pct(c.cerrados, c.n)]; }),
                        tableWidth: Math.min(U.ancho, 190),
                        columnStyles: { 1: Object.assign({ cellWidth: 22 }, DER), 2: Object.assign({ cellWidth: 22 }, DER), 3: Object.assign({ cellWidth: 24 }, DER) },
                        didParseCell: alinearEncabezado([1, 2, 3])
                    });
                }
                var niveles = ana.riesgo.niveles.map(function (n) { return { nombre: n.nombre, n: n.n, color: hexRGB(n.color) }; })
                    .concat([{ nombre: 'Sin evaluar', n: ana.riesgo.sin_evaluar, color: COL.n300 }]);
                var totalNiv = niveles.reduce(function (s, n) { return s + n.n; }, 0);
                subtitulo('Nivel de riesgo vigente', d.matriz && d.matriz.validada ? 'Según la matriz de riesgo validada.' : 'La matriz tiene los criterios del Manual SMS (numeral 5.3), pendientes de confirmar en el sistema.');
                tabla({
                    head: [['Nivel', 'Reportes', '% del total']],
                    body: niveles.map(function (n) { return [T(n.nombre), X.numero(n.n), pct(n.n, totalNiv)]; }),
                    foot: [['Total', X.numero(totalNiv), totalNiv ? '100 %' : '—']],
                    tableWidth: Math.min(U.ancho, 150),
                    columnStyles: { 1: Object.assign({ cellWidth: 28 }, DER), 2: Object.assign({ cellWidth: 28 }, DER) },
                    didParseCell: ganchos([1, 2], 0, function (i) { return niveles[i].color; }), didDrawCell: dibujarPunto
                });
            }
        }
        function alinearEncabezado(indices) {
            return function (c) { if ((c.section === 'head' || c.section === 'foot') && indices.indexOf(c.column.index) >= 0) c.cell.styles.halign = 'right'; };
        }
        // Encabezado alineado a la derecha en columnas numéricas y punto de color antes
        // del texto (identidad del estatus o nivel; el texto siempre acompaña al color)
        function ganchos(derecha, columnaPunto, colorDe) {
            var alinear = alinearEncabezado(derecha);
            return function (c) {
                alinear(c);
                if (c.section !== 'body' || c.column.index !== columnaPunto) return;
                c.cell.styles.cellPadding = { top: 1.6, right: 2.2, bottom: 1.6, left: 5.4 };
                c.cell._punto = colorDe(c.row.index);
            };
        }
        function dibujarPunto(c) {
            var color = c.cell._punto;
            if (!color) return;
            doc.setFillColor.apply(doc, color);
            doc.circle(c.cell.x + 2.6, c.cell.y + c.cell.padding('top') + 1.45, 0.95, 'F');
        }

        // ------------------------------------------------ 4. Listado de reportes
        var filas = d.filas || [];
        var recortadas = 0;
        if (op.contenido.detalle) {
            avisar({ texto: 'Listado de reportes', avance: 0.4 });
            seccion('Listado de reportes', filas.length
                ? X.plural(filas.length, 'reporte', 'reportes') + (meta.ordenTexto ? ', ordenados por ' + meta.ordenTexto : '') + '. ' +
                  (d.truncado ? 'Se incluyen los primeros ' + X.numero(d.truncado.exportados) + ' de ' + X.numero(d.truncado.total) + '. ' : '') +
                  'Los textos de más de ' + MAX_TEXTO + ' caracteres se recortan; el texto completo está en la exportación a Excel.'
                : 'No hay reportes que cumplan los filtros.', filas.length ? 50 : 24);
            if (filas.length) {
                var ctx = { hoy: meta.hoy, diasAviso: meta.diasAviso, personales: {} };
                var colorNivel = {};
                ((d.matriz && d.matriz.niveles) || []).forEach(function (n) { colorNivel[n.clave] = hexRGB(n.color); });
                var tam = cols.length > 9 || requerido > (horizontal ? ANCHO_H : ANCHO_V) ? 7 : 7.6;
                // Anchos: fijos según el catálogo; los textos largos toman el resto
                var fijos = cols.filter(function (c) { return c.mm; });
                var largos = cols.filter(function (c) { return !c.mm; }).length;
                var sumaFijos = fijos.reduce(function (s, c) { return s + c.mm; }, 0);
                var minimoLargo = 46;
                var escala = sumaFijos ? Math.min(1, (U.ancho - largos * minimoLargo) / sumaFijos) : 1;
                var columnStyles = {};
                cols.forEach(function (c, i) {
                    var e = c.mm ? { cellWidth: Math.max(12, c.mm * escala) } : { cellWidth: 'auto', minCellWidth: minimoLargo };
                    if (c.tipo === 'entero' || c.tipo === 'decimal') e.halign = 'right';
                    if (c.k === 'folio') { e.fontStyle = 'bold'; e.textColor = COL.n900; }
                    columnStyles[i] = e;
                });
                var cuerpo = filas.map(function (f) {
                    return cols.map(function (c) {
                        var v = c.v(f, ctx);
                        if (c.tipo === 'fecha') return X.fecha(v);
                        if (c.tipo === 'fechahora') return v ? X.fecha(v) + '\n' + X.hora(v) : '—';
                        if (c.tipo === 'entero') return v == null ? '' : X.numero(v);
                        if (c.tipo === 'decimal') return v == null ? '' : X.numero(v, 1);
                        var s = T(v);
                        if (c.tipo === 'largo' && s.length > MAX_TEXTO) { recortadas++; s = s.slice(0, MAX_TEXTO).replace(/\s+\S*$/, '') + '…'; }
                        return s;
                    });
                });
                var claves = cols.map(function (c) { return c.k; });
                var iEstado = claves.indexOf('estado'), iSem = claves.indexOf('situacion'), iRiesgo = claves.indexOf('riesgo');
                var conPunto = [iEstado, iSem, iRiesgo].filter(function (i) { return i >= 0; });
                var total = filas.length, ultimoAviso = 0;
                tabla({
                    head: [cols.map(function (c) { return T(c.t); })],
                    body: cuerpo,
                    styles: { fontSize: tam, cellPadding: { top: 1.4, right: 1.8, bottom: 1.4, left: 1.8 } },
                    headStyles: { fontSize: tam - 0.4 },
                    columnStyles: columnStyles,
                    horizontalPageBreak: requerido > U.ancho + 40,
                    horizontalPageBreakRepeat: 0,
                    didParseCell: function (c) {
                        if (c.section === 'head' && (cols[c.column.index].tipo === 'entero' || cols[c.column.index].tipo === 'decimal')) c.cell.styles.halign = 'right';
                        if (c.section === 'body' && conPunto.indexOf(c.column.index) >= 0) c.cell.styles.cellPadding = { top: 1.4, right: 1.8, bottom: 1.4, left: 4.6 };
                    },
                    willDrawCell: function (c) {
                        if (c.section !== 'body') return;
                        var f = filas[c.row.index];
                        if (c.column.index === iEstado) c.cell._punto = COLOR_ESTADO[f.estado];
                        else if (c.column.index === iSem) c.cell._punto = COLOR_SEMAFORO[cuerpo[c.row.index][iSem]] || COL.n300;
                        else if (c.column.index === iRiesgo) c.cell._punto = f.riesgo ? (colorNivel[f.riesgo.nivel] || COL.n400) : COL.n300;
                    },
                    didDrawCell: function (c) {
                        dibujarPunto(c);
                        if (c.section === 'body' && c.column.index === 0 && c.row.index - ultimoAviso >= 150) {
                            ultimoAviso = c.row.index;
                            avisar({ texto: 'Listado: fila ' + X.numero(c.row.index) + ' de ' + X.numero(total), avance: 0.4 + 0.5 * c.row.index / total });
                        }
                    }
                });
            }
        }

        // --------------------------------------------- 5. Observaciones y notas
        var obs = op.contenido.observaciones ? X.observaciones(ind, {
            matrizValidada: d.matriz ? d.matriz.validada : undefined,
            cerradosSinFecha: ana ? ana.cerrados_sin_fecha : 0,
            truncado: d.truncado,
            recortadas: recortadas
        }) : [];
        avisar({ texto: 'Observaciones', avance: 0.92 });
        if (obs.length || op.notas) {
            seccion('Observaciones', null, 34);
            var MARCA = { alerta: COL.r600, aviso: COL.amb, info: COL.n400 };
            var NOMBRE = { alerta: 'Alerta', aviso: 'Atención', info: 'Nota' };
            obs.forEach(function (o) {
                fuente('bold', 7.2, MARCA[o.tipo]);
                var etq = NOMBRE[o.tipo].toUpperCase();
                parrafo(o.texto, {
                    tam: 8.8, color: COL.n800, sangria: 19, despues: 1.6,
                    marca: function (x, yy) {
                        doc.setFillColor.apply(doc, MARCA[o.tipo]);
                        doc.roundedRect(x, yy + 0.1, 16, 3.9, 0.8, 0.8, 'F');
                        fuente('bold', 6.4, o.tipo === 'info' ? COL.blanco : COL.blanco);
                        texto(etq, x + 8, yy + 0.75, { align: 'center', charSpace: 0.2 });
                        fuente('normal', 8.8, COL.n800);
                    }
                });
            });
            if (op.notas) {
                y += 2;
                subtitulo('Notas de quien elabora el documento', null, 16);
                var ls = lineas(op.notas, U.ancho - 8, 8.8);
                var lh = alto(8.8);
                // Recuadro por página si la nota es larga
                var i0 = 0;
                while (i0 < ls.length) {
                    espacio(lh * 2 + 6);
                    var caben = Math.max(1, Math.floor((U.fin - y - 6) / lh));
                    var parte = ls.slice(i0, i0 + caben);
                    var hCaja = parte.length * lh + 5;
                    doc.setFillColor.apply(doc, COL.n50);
                    doc.setDrawColor.apply(doc, COL.n100);
                    doc.setLineWidth(0.25);
                    doc.roundedRect(U.x, y, U.ancho, hCaja, 1.4, 1.4, 'FD');
                    doc.setFillColor.apply(doc, COL.v600);
                    doc.rect(U.x, y + 1.2, 0.8, hCaja - 2.4, 'F');
                    fuente('normal', 8.8, COL.n900);
                    doc.text(parte, U.x + 4.5, y + 2.6, { baseline: 'top' });
                    y += hCaja + 3;
                    i0 += parte.length;
                }
            }
        }
        // Notas metodológicas (siempre, breves)
        espacio(26);
        y += 3;
        doc.setDrawColor.apply(doc, COL.n100);
        doc.setLineWidth(0.25);
        doc.line(U.x, y, U.x + U.ancho, y);
        y += 3;
        fuente('bold', 7.4, COL.n600);
        texto('NOTAS METODOLÓGICAS', U.x, y, { charSpace: 0.2 });
        y += 4.4;
        X.NOTAS_METODO.forEach(function (n) { parrafo(n, { tam: 7.4, color: COL.n500, despues: 0.4 }); });

        // ------------------------------------- encabezados y pies (todas las páginas)
        avisar({ texto: 'Numerando páginas', avance: 0.96 });
        var total = doc.getNumberOfPages();
        var pieIzq = T('S.A.G.A. · Aeropuerto Internacional Felipe Ángeles · Documento de uso interno');
        var pieCentro = T('Generado el ' + X.fechaHora(meta.generado));
        for (var p = 1; p <= total; p++) {
            doc.setPage(p);
            if (p > 1) {
                var hL = 5.2, xs = U.x;
                if (logo) {
                    var wL = hL * logo.w / logo.h;
                    doc.addImage(logo.datos, 'PNG', U.x, 8.2, wL, hL, 'logo', 'FAST');
                    xs = U.x + wL + 3;
                    doc.setDrawColor.apply(doc, COL.n200);
                    doc.setLineWidth(0.25);
                    doc.line(xs, 8.6, xs, 8.2 + hL - 0.4);
                    xs += 3;
                }
                fuente('bold', 7.6, COL.n800);
                texto('S.A.G.A. · SMS', xs, 9.4);
                fuente('normal', 7.4, COL.n600);
                var tt = lineas(op.titulo, U.ancho * 0.5, 7.4)[0];
                texto(tt + (lineas(op.titulo, U.ancho * 0.5, 7.4).length > 1 ? '…' : ''), U.x + U.ancho, 9.4, { align: 'right' });
                barraEstela(15.6, 0.55);
            }
            doc.setDrawColor.apply(doc, COL.n100);
            doc.setLineWidth(0.25);
            doc.line(U.x, H - 11.2, U.x + U.ancho, H - 11.2);
            fuente('normal', 6.8, COL.n500);
            texto(pieIzq, U.x, H - 9.4);
            if (horizontal) texto(pieCentro, W / 2, H - 9.4, { align: 'center' });
            else texto(pieCentro, U.x, H - 6.4);
            fuente('bold', 7, COL.n700);
            texto('Página ' + p + ' de ' + total, U.x + U.ancho, H - 9.4, { align: 'right' });
        }

        avisar({ texto: 'Guardando el archivo', avance: 0.99 });
        return { buffer: doc.output('arraybuffer'), paginas: total, horizontal: horizontal, recortadas: recortadas };
    }

    raiz.SMSPdf = { construir: construir, texto: T };
})(typeof self !== 'undefined' ? self : this);
