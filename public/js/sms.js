/* S.A.G.A. · Utilidades del módulo SMS para el navegador
   - SMS.api(url, opciones)    fetch JSON con el token de sesión (si existe)
   - SMS.sesion()              usuario en sesión o null (valida el token en el servidor)
   - SMS.fecha / fechaHora / relativa / diaLocal
   - SMS.estado / riesgo / vencimiento      etiquetas visuales (HTML seguro)
   - SMS.semaforo / etapas / duracion       semáforo de plazos, etapas de atención
   - [data-tip]                             globo de ayuda accesible (cursor y teclado)
   - SMS.descargar(url, nombre) descarga un archivo enviando el token
   - Campana de notificaciones en la barra superior (solo con sesión)          */
(function () {
    'use strict';

    var CLAVE_TOKEN = 'rsm_token';
    var ZONA = 'America/Mexico_City';
    var ESTADOS = { A: 'Generado', B: 'Enterado', C: 'En atención', D: 'Resuelto', E: 'Duplicado', F: 'No requiere atención' };
    var DOT_ESTADO = { A: 'var(--amb)', B: 'var(--az)', C: 'var(--az)', D: 'var(--v600)', E: 'var(--n400)', F: 'var(--n300)' };

    function token() {
        try { return localStorage.getItem(CLAVE_TOKEN); } catch (e) { return null; }
    }

    function esc(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function ic(nombre, clase) {
        return '<svg class="ic' + (clase ? ' ' + clase : '') + '" aria-hidden="true" focusable="false"><use href="/img/icons.svg#i-' + nombre + '"/></svg>';
    }

    async function api(url, opciones) {
        opciones = opciones || {};
        var cab = Object.assign({ Accept: 'application/json' }, opciones.headers || {});
        var t = token();
        if (t) cab.Authorization = 'Bearer ' + t;
        var cfg = { method: opciones.method || 'GET', headers: cab };
        if (opciones.json !== undefined) {
            cab['Content-Type'] = 'application/json';
            cfg.body = JSON.stringify(opciones.json);
        } else if (opciones.body) {
            cfg.body = opciones.body;
        }
        if (opciones.signal) cfg.signal = opciones.signal;
        var r = await fetch(url, cfg);
        var datos = null;
        try { datos = await r.json(); } catch (e) { /* sin cuerpo JSON */ }
        if (!r.ok || !datos || datos.success === false) {
            var err = new Error((datos && datos.error) || (r.status === 0 ? 'Sin conexión con el servidor' : 'Error ' + r.status));
            err.status = r.status;
            err.datos = datos;
            throw err;
        }
        return datos;
    }

    var promesaSesion = null;
    function sesion(forzar) {
        if (!token()) return Promise.resolve(null);
        if (!promesaSesion || forzar) {
            promesaSesion = api('/api/auth/sesion')
                .then(function (d) { return Object.assign({}, d.usuario, { capacidades: d.capacidades || [] }); })
                .catch(function () { return null; });
        }
        return promesaSesion;
    }

    // ------------------------------------------------------------- fechas
    var fmtCorta = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: ZONA });
    var fmtHora = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
    var fmtDia = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONA });
    var fmtMes = new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' });

    function aFecha(v) {
        if (!v) return null;
        if (v instanceof Date) return v;
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T12:00:00-06:00');
        var d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    function limpiarPunto(t) { return t.replace(/\./g, ''); }
    function fecha(v) { var d = aFecha(v); return d ? limpiarPunto(fmtCorta.format(d)) : '—'; }
    function fechaHora(v) { var d = aFecha(v); return d ? limpiarPunto(fmtHora.format(d)).replace(',', ' ·') : '—'; }
    function diaLocal(v) { var d = aFecha(v || new Date()); return d ? fmtDia.format(d) : null; }
    function mes(yyyyMm) {
        var p = String(yyyyMm).split('-');
        return limpiarPunto(fmtMes.format(new Date(Date.UTC(+p[0], +p[1] - 1, 15))));
    }
    function diasEntre(a, b) {
        return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
    }

    // Periodos rápidos compartidos por la vista general y el análisis (día de México)
    function sumarDias(iso, n) {
        var d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }
    function rangoPeriodo(clave, hoy) {
        hoy = hoy || diaLocal();
        var fin;
        switch (clave) {
            case 'hoy': return { desde: hoy, hasta: hoy };
            case 'ayer': fin = sumarDias(hoy, -1); return { desde: fin, hasta: fin };
            case 'mes': return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
            case 'mes_anterior': fin = sumarDias(hoy.slice(0, 8) + '01', -1); return { desde: fin.slice(0, 8) + '01', hasta: fin };
            case 'anio': return { desde: hoy.slice(0, 4) + '-01-01', hasta: hoy };
            default: return +clave > 0 ? { desde: sumarDias(hoy, -(+clave - 1)), hasta: hoy } : null;
        }
    }
    /** Clave del periodo rápido que coincide con el rango (o null) */
    function periodoActivo(desde, hasta, claves) {
        if (!desde || !hasta) return null;
        for (var i = 0; i < claves.length; i++) {
            var r = rangoPeriodo(claves[i]);
            if (r && r.desde === desde && r.hasta === hasta) return claves[i];
        }
        return null;
    }
    function relativa(v) {
        var d = aFecha(v);
        if (!d) return '';
        var s = Math.round((Date.now() - d.getTime()) / 1000);
        if (s < 60) return 'hace un momento';
        if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
        if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
        if (s < 86400 * 7) { var n = Math.round(s / 86400); return 'hace ' + n + (n === 1 ? ' día' : ' días'); }
        return fecha(d);
    }
    function numero(n, dec) {
        if (n == null || isNaN(n)) return '—';
        return Number(n).toLocaleString('es-MX', { maximumFractionDigits: dec == null ? 0 : dec, minimumFractionDigits: 0 });
    }

    // ------------------------------------------------------- etiquetas
    function estado(e, conCodigo) {
        if (!e) return '<span class="nd">—</span>';
        return '<span class="estado-badge estado-' + esc(e) + '">' + (conCodigo ? esc(e) + ' · ' : '') + esc(ESTADOS[e] || e) + '</span>';
    }

    function textoSobre(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
        if (!m) return '#fff';
        var n = parseInt(m[1], 16);
        var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (x) {
            x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        var L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        return (1.05 / (L + 0.05)) >= 3.6 ? '#fff' : '#141A1F';
    }

    function nivel(niveles, clave) {
        return (niveles || []).find(function (n) { return n.clave === clave; }) || null;
    }

    function riesgo(r, niveles, opciones) {
        opciones = opciones || {};
        if (!r) return '<span class="riesgo-nd">' + (opciones.textoVacio || 'Sin evaluar') + '</span>';
        var n = nivel(niveles, r.nivel);
        var color = n ? n.color : '#8895A0';
        var nombre = n ? n.nombre : (r.nombre || r.nivel_nombre || r.nivel);
        var corto = String(nombre).split('·')[0].trim();
        return '<span class="riesgo-pill" style="--c:' + esc(color) + '" title="' + esc(nombre + (r.prioridad ? ' · ' + r.prioridad : '')) + '">' +
            '<span class="idx">' + esc(r.indice) + '</span>' + esc(opciones.completo ? nombre : corto) + '</span>';
    }

    function vencimiento(fechaV, diasAviso, opciones) {
        opciones = opciones || {};
        if (!fechaV) return '<span class="riesgo-nd">' + (opciones.textoVacio || 'Sin fecha compromiso') + '</span>';
        var hoy = diaLocal();
        var f = diaLocal(fechaV);
        var d = diasEntre(hoy, f);
        var cls, icono, texto;
        if (d < 0) { cls = 'vencido'; icono = 'crit'; texto = 'Vencido · ' + Math.abs(d) + (Math.abs(d) === 1 ? ' día' : ' días'); }
        else if (d <= (diasAviso || 7)) { cls = 'proximo'; icono = 'hourglass'; texto = d === 0 ? 'Vence hoy' : 'Vence en ' + d + (d === 1 ? ' día' : ' días'); }
        else { cls = 'en_tiempo'; icono = 'clock'; texto = 'En tiempo'; }
        return '<span class="venc venc--' + cls + '">' + ic(icono) + '<span>' + texto + '<small>' + fecha(fechaV) + '</small></span></span>';
    }


    // ------------------------------------------------ semáforo de plazos
    // Estado calculado en el servidor (o aquí, con los mismos criterios).
    var SEMAFORO = {
        vencido:          { t: 'Vencido', luz: 3, ic: 'crit' },
        proximo:          { t: 'Próximo a vencer', luz: 2, ic: 'hourglass' },
        en_tiempo:        { t: 'En tiempo', luz: 1, ic: 'clock' },
        sin_plazo:        { t: 'Sin plazo', luz: 0, ic: 'minus' },
        cerrado_en_plazo: { t: 'Cerrado en plazo', luz: 1, ic: 'ok' },
        cerrado_fuera:    { t: 'Cerrado fuera de plazo', luz: 3, ic: 'warn' },
        cerrado:          { t: 'Cerrado sin plazo', luz: 0, ic: 'ok' }
    };
    function estadoSemaforo(r, diasAviso) {
        var cerrado = ['D', 'E', 'F'].indexOf(r.estado) >= 0;
        if (cerrado) {
            if (r.cerrado_en_plazo === true) return 'cerrado_en_plazo';
            if (r.cerrado_en_plazo === false) return 'cerrado_fuera';
            return 'cerrado';
        }
        if (!r.fecha_vencimiento) return 'sin_plazo';
        var d = diasEntre(diaLocal(), diaLocal(r.fecha_vencimiento));
        if (d < 0) return 'vencido';
        return d <= (diasAviso || 7) ? 'proximo' : 'en_tiempo';
    }
    /** Semáforo con las tres luces, texto y detalle (nunca solo color). */
    function semaforo(r, diasAviso, opciones) {
        opciones = opciones || {};
        var clave = opciones.estado || estadoSemaforo(r, diasAviso);
        var s = SEMAFORO[clave] || SEMAFORO.sin_plazo;
        var det = '';
        if (clave === 'vencido' || clave === 'proximo' || clave === 'en_tiempo') {
            var d = diasEntre(diaLocal(), diaLocal(r.fecha_vencimiento));
            det = clave === 'vencido' ? 'hace ' + Math.abs(d) + (Math.abs(d) === 1 ? ' día' : ' días') + ' · ' + fecha(r.fecha_vencimiento)
                : (d === 0 ? 'vence hoy' : 'en ' + d + (d === 1 ? ' día' : ' días')) + ' · ' + fecha(r.fecha_vencimiento);
        } else if (clave === 'cerrado_en_plazo' || clave === 'cerrado_fuera') {
            det = 'plazo ' + fecha(r.plazo_reporte) + (r.fecha_cierre ? ' · cierre ' + fecha(r.fecha_cierre) : '');
        } else if (clave === 'sin_plazo') {
            det = opciones.textoSinPlazo || 'sin fecha compromiso';
        }
        var luces = '<span class="semaforo__luces" aria-hidden="true"><i' + (s.luz === 3 ? ' class="on"' : '') + '></i><i' + (s.luz === 2 ? ' class="on"' : '') + '></i><i' + (s.luz === 1 ? ' class="on"' : '') + '></i></span>';
        return '<span class="semaforo semaforo--' + clave + '">' + luces +
            '<span class="semaforo__t">' + s.t + (det && !opciones.sinDetalle ? '<small>' + esc(det) + '</small>' : '') + '</span></span>';
    }

    // ------------------------------------------------------------ duración
    /** Minutos → "25 min", "7.4 h", "3.2 días". */
    function duracion(minutos) {
        if (minutos == null || isNaN(minutos)) return '—';
        var m = Number(minutos);
        if (m < 60) return Math.round(m) + ' min';
        if (m < 1440) return numero(m / 60, 1) + ' h';
        var d = m / 1440;
        return numero(d, 1) + (Math.round(d * 10) === 10 ? ' día' : ' días');
    }
    function duracionDias(dias) { return dias == null ? '—' : duracion(Number(dias) * 1440); }

    // ---------------------------------------------- etapas de atención
    function etapas(lista, opciones) {
        opciones = opciones || {};
        if (!lista || !lista.length) return '';
        var nombreEstado = { completa: 'completada', actual: 'etapa actual', pendiente: 'pendiente', omitida: 'sin registro' };
        return '<ol class="etapas' + (opciones.compacto ? ' etapas--compacto' : '') + '" aria-label="Etapas de atención">' + lista.map(function (e, i) {
            var cuando = e.fecha ? fechaHora(e.fecha) : (e.estado === 'omitida' ? 'Sin registro de esta etapa' : 'Pendiente');
            var desde = i > 0 && e.minutos_desde_reporte != null ? '+' + duracion(e.minutos_desde_reporte) : '';
            return '<li class="etapa etapa--' + e.estado + (i === 3 ? ' etapa--cierre etapa--' + esc(e.clave) : '') + '">' +
                '<span class="etapa__punto" aria-hidden="true">' + (e.estado === 'completa' ? ic('check') : e.estado === 'omitida' ? ic('minus') : '') + '</span>' +
                '<span class="etapa__txt"><b>' + esc(e.nombre) + '</b><span class="sr-only"> (' + nombreEstado[e.estado] + ')</span>' +
                '<small>' + cuando + '</small>' +
                (!opciones.compacto && desde ? '<small class="etapa__dur" data-tip="Tiempo transcurrido desde que se generó el reporte">' + desde + '</small>' : '') +
                (!opciones.compacto && e.area ? '<small class="etapa__area">' + esc(e.area) + '</small>' : '') +
                '</span></li>';
        }).join('') + '</ol>';
    }

    // ------------------------------------------------------------ tooltips
    // Cualquier elemento con data-tip muestra un globo al pasar el cursor o
    // al recibir el foco con teclado. El texto se enlaza con aria-describedby.
    var globo = null, duenoGlobo = null, timerGlobo = null;
    function crearGlobo() {
        globo = document.createElement('div');
        globo.className = 'sg-tip';
        globo.id = 'sg-tip';
        globo.setAttribute('role', 'tooltip');
        globo.hidden = true;
        document.body.appendChild(globo);
    }
    function mostrarGlobo(el) {
        var texto = el.getAttribute('data-tip');
        if (!texto) return;
        if (!globo) crearGlobo();
        duenoGlobo = el;
        globo.textContent = texto;
        globo.hidden = false;
        globo.classList.remove('is-on');
        var r = el.getBoundingClientRect();
        var g = globo.getBoundingClientRect();
        var arriba = r.top - g.height - 8 > 8;
        var x = Math.max(8, Math.min(window.innerWidth - g.width - 8, r.left + r.width / 2 - g.width / 2));
        var y = arriba ? r.top - g.height - 8 : r.bottom + 8;
        globo.style.left = (x + window.scrollX) + 'px';
        globo.style.top = (y + window.scrollY) + 'px';
        globo.classList.toggle('abajo', !arriba);
        var prev = el.getAttribute('aria-describedby') || '';
        if (prev.split(' ').indexOf('sg-tip') < 0) el.setAttribute('aria-describedby', (prev + ' sg-tip').trim());
        requestAnimationFrame(function () { if (globo) globo.classList.add('is-on'); });
    }
    function ocultarGlobo() {
        clearTimeout(timerGlobo);
        if (!globo || !duenoGlobo) return;
        var prev = (duenoGlobo.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== 'sg-tip'; }).join(' ');
        if (prev) duenoGlobo.setAttribute('aria-describedby', prev); else duenoGlobo.removeAttribute('aria-describedby');
        globo.hidden = true;
        globo.classList.remove('is-on');
        duenoGlobo = null;
    }
    document.addEventListener('mouseover', function (e) {
        var el = e.target.closest && e.target.closest('[data-tip]');
        if (el === duenoGlobo) return;
        ocultarGlobo();
        if (el) timerGlobo = setTimeout(function () { mostrarGlobo(el); }, 350);
    });
    document.addEventListener('focusin', function (e) {
        var el = e.target.closest && e.target.closest('[data-tip]');
        ocultarGlobo();
        if (el && el.matches(':focus-visible')) mostrarGlobo(el);
    });
    document.addEventListener('focusout', ocultarGlobo);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') ocultarGlobo(); });
    window.addEventListener('scroll', ocultarGlobo, { passive: true });

    // Alto real de la barra superior (para encabezados de tabla fijos)
    function medirBarra() {
        var b = document.querySelector('.sg-appbar');
        if (b) document.documentElement.style.setProperty('--appbar-h', (getComputedStyle(b).position === 'sticky' ? b.offsetHeight : 0) + 'px');
    }
    window.addEventListener('resize', medirBarra);
    document.addEventListener('DOMContentLoaded', medirBarra);

    // ---------------------------------------- datos de quien reportó (con sesión)
    // Agrega a la ficha (<dl>) nombre, teléfono, gerencia y cargo, que las páginas
    // públicas no traen. r = respuesta de /api/sms/reportes/:folio/reportante.
    function pintarReportante(dl, r) {
        var filas = [['Reportante', r.nombre], ['Teléfono', r.telefono], ['Gerencia', r.area], ['Cargo', r.cargo]].filter(function (x) { return x[1]; });
        if (!filas.length) filas = [['Reportante', null]];
        filas.forEach(function (x) {
            var valor = !x[1] ? '<span class="nd">Reporte anónimo</span>'
                : x[0] === 'Teléfono' ? '<a href="tel:' + esc(String(x[1]).replace(/[^\d+]/g, '')) + '">' + esc(x[1]) + '</a>'
                : esc(x[1]);
            dl.insertAdjacentHTML('beforeend', '<div><dt title="Visible solo con sesión">' + esc(x[0]) + '</dt><dd>' + valor + '</dd></div>');
        });
    }

    // --------------------------------------------- eliminar un reporte (admin)
    // Diálogo de confirmación: muestra lo que se respalda, pide el motivo y
    // escribir el folio. Resuelve true si se eliminó.
    function confirmarEliminacion(folio) {
        return new Promise(function (resolver) {
            var anterior = document.activeElement;
            var fondo = document.createElement('div');
            fondo.className = 'sg-backdrop show';
            fondo.innerHTML =
                '<div class="sg-dialog" role="dialog" aria-modal="true" aria-labelledby="elimT">' +
                '<div class="sg-dialog__head"><div><span class="sg-eyebrow" style="color:var(--r600)">Eliminar reporte</span>' +
                '<h2 class="sg-dialog__title" id="elimT">¿Eliminar el reporte ' + esc(folio) + '?</h2></div>' +
                '<button type="button" class="btn btn-ghost btn-icon" data-cerrar aria-label="Cerrar">' + ic('x') + '</button></div>' +
                '<div class="sg-dialog__body"><form novalidate>' +
                '<div class="elim-resumen" aria-live="polite"><span class="skel skel--media"></span><span class="skel"></span></div>' +
                '<div class="sg-banner warn" style="margin:14px 0">' + ic('warn') + '<span>Dejará de aparecer en listados, indicadores, análisis y paneles de área. ' +
                'Se guarda una copia completa y un administrador puede restaurarlo desde <a href="/admin/eliminados">Reportes eliminados</a>. El folio no se vuelve a asignar.</span></div>' +
                '<div class="sg-field"><label for="elimMotivo">Motivo de la eliminación <span class="req">*</span></label>' +
                '<textarea id="elimMotivo" maxlength="1000" required style="min-height:80px" placeholder="Ej. Reporte de prueba capturado por error"></textarea></div>' +
                '<div class="sg-field" style="margin-top:12px"><label for="elimFolio">Para confirmar, escribe el folio <strong class="mono">' + esc(folio) + '</strong></label>' +
                '<input id="elimFolio" autocomplete="off" spellcheck="false" autocapitalize="characters"></div>' +
                '<div class="sg-banner crit" role="alert" hidden style="margin-top:12px">' + ic('crit') + '<span></span></div>' +
                '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;flex-wrap:wrap">' +
                '<button type="button" class="btn btn-secondary" data-cerrar>Cancelar</button>' +
                '<button type="submit" class="btn btn-danger" disabled>' + ic('trash') + '<span>Eliminar reporte</span></button></div>' +
                '</form></div></div>';
            document.body.appendChild(fondo);
            document.body.style.overflow = 'hidden';
            var form = fondo.querySelector('form');
            var motivo = fondo.querySelector('#elimMotivo');
            var confirmacion = fondo.querySelector('#elimFolio');
            var ok = form.querySelector('[type=submit]');
            var error = form.querySelector('.sg-banner.crit');
            var cerrado = false;

            function cerrar(valor) {
                if (cerrado) return;
                cerrado = true;
                fondo.remove();
                document.body.style.overflow = '';
                if (anterior && anterior.focus && document.body.contains(anterior)) anterior.focus();
                resolver(valor);
            }
            function validar() {
                ok.disabled = !(motivo.value.trim().length >= 10 && confirmacion.value.trim().toUpperCase() === String(folio).toUpperCase());
            }
            motivo.addEventListener('input', validar);
            confirmacion.addEventListener('input', validar);
            fondo.addEventListener('click', function (e) { if (e.target === fondo || e.target.closest('[data-cerrar]')) cerrar(false); });
            fondo.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { e.preventDefault(); cerrar(false); return; }
                if (e.key !== 'Tab') return;
                var f = fondo.querySelectorAll('button:not([disabled]), textarea, input, a[href]');
                var a = f[0], z = f[f.length - 1];
                if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
                else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
            });
            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                if (ok.disabled) return;
                error.hidden = true;
                ok.disabled = true;
                var etiqueta = ok.innerHTML;
                ok.innerHTML = '<span class="sg-spinner sg-spinner--sm"></span><span>Eliminando…</span>';
                try {
                    await api('/api/sms/reportes/' + encodeURIComponent(folio), { method: 'DELETE', json: { motivo: motivo.value.trim(), confirmacion: confirmacion.value.trim() } });
                    if (window.SAGA) SAGA.toast('Reporte ' + folio + ' eliminado. Se guardó una copia para restaurarlo.', 'success');
                    cerrar(true);
                } catch (ex) {
                    error.querySelector('span').textContent = ex.message;
                    error.hidden = false;
                    ok.innerHTML = etiqueta;
                    validar();
                }
            });
            setTimeout(function () { motivo.focus(); }, 30);

            api('/api/sms/reportes/' + encodeURIComponent(folio) + '/eliminacion').then(function (d) {
                var partes = Object.keys(d.resumen).map(function (k) { return '<li>' + esc(d.resumen[k].nombre) + ': <b>' + numero(d.resumen[k].n) + '</b></li>'; });
                fondo.querySelector('.elim-resumen').innerHTML =
                    '<p style="font-size:14px;color:var(--n800)"><strong>' + esc(d.tipo_problema) + '</strong></p>' +
                    '<p class="sg-help" style="margin-top:2px">' + fecha(d.fecha) + ' · ' + esc(ESTADOS[d.estado] || d.estado) + '</p>' +
                    '<p style="font-size:13px;color:var(--n700);margin-top:10px">' + (partes.length ? 'También se eliminará lo asociado (queda en la copia):' : 'No tiene seguimientos, evidencias ni acciones asociadas.') + '</p>' +
                    (partes.length ? '<ul style="margin:6px 0 0 18px;font-size:13px;color:var(--n700)">' + partes.join('') + '</ul>' : '');
            }).catch(function (ex) {
                fondo.querySelector('.elim-resumen').innerHTML = '';
                error.querySelector('span').textContent = ex.message;
                error.hidden = false;
                motivo.disabled = true; confirmacion.disabled = true;
            });
        });
    }


    // ---------------------------------------------------- diálogo genérico
    // cfg: { titulo, eyebrow, html, boton, icono, peligro, ancho, sinPie, alAbrir(form), enviar(form) }
    // Resuelve con lo que devuelva enviar() (o true), o null si se cancela.
    function dialogo(cfg) {
        return new Promise(function (resolver) {
            var anterior = document.activeElement;
            var fondo = document.createElement('div');
            fondo.className = 'sg-backdrop show';
            fondo.innerHTML =
                '<div class="sg-dialog" role="dialog" aria-modal="true" aria-labelledby="dlgGenT"' + (cfg.ancho ? ' style="max-width:720px"' : '') + '>' +
                '<div class="sg-dialog__head"><div>' + (cfg.eyebrow ? '<span class="sg-eyebrow">' + esc(cfg.eyebrow) + '</span>' : '') +
                '<h2 class="sg-dialog__title" id="dlgGenT"></h2></div>' +
                '<button type="button" class="btn btn-ghost btn-icon" data-cerrar aria-label="Cerrar">' + ic('x') + '</button></div>' +
                '<div class="sg-dialog__body"><form novalidate>' + cfg.html +
                '<div class="sg-banner crit" role="alert" hidden style="margin-top:14px">' + ic('crit') + '<span></span></div>' +
                (cfg.sinPie ? '' : '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;flex-wrap:wrap">' +
                    (cfg.soloAceptar ? '' : '<button type="button" class="btn btn-secondary" data-cerrar>Cancelar</button>') +
                    '<button type="submit" class="btn ' + (cfg.peligro ? 'btn-danger' : 'btn-primary') + '">' + (cfg.icono ? ic(cfg.icono) : '') + '<span></span></button></div>') +
                '</form></div></div>';
            fondo.querySelector('#dlgGenT').textContent = cfg.titulo;
            var ok = fondo.querySelector('[type=submit]');
            if (ok) ok.querySelector('span').textContent = cfg.boton || 'Guardar';
            document.body.appendChild(fondo);
            document.body.style.overflow = 'hidden';
            var form = fondo.querySelector('form');
            var error = form.querySelector('.sg-banner.crit');
            var cerrado = false;
            function cerrar(valor) {
                if (cerrado) return;
                cerrado = true;
                fondo.remove();
                document.body.style.overflow = '';
                if (anterior && anterior.focus && document.body.contains(anterior)) anterior.focus();
                resolver(valor);
            }
            fondo.addEventListener('click', function (e) { if (e.target === fondo || e.target.closest('[data-cerrar]')) cerrar(null); });
            fondo.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { e.preventDefault(); cerrar(null); return; }
                if (e.key !== 'Tab') return;
                var f = fondo.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), a[href]');
                var a = f[0], z = f[f.length - 1];
                if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
                else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
            });
            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                if (!cfg.enviar) { cerrar(true); return; }
                error.hidden = true;
                var etiqueta = ok ? ok.innerHTML : '';
                if (ok) { ok.disabled = true; ok.innerHTML = '<span class="sg-spinner sg-spinner--sm"></span><span>Guardando…</span>'; }
                try {
                    var r = await cfg.enviar(form);
                    cerrar(r === undefined ? true : r);
                } catch (ex) {
                    error.querySelector('span').textContent = ex.message;
                    error.hidden = false;
                    if (ok) { ok.disabled = false; ok.innerHTML = etiqueta; }
                }
            });
            if (cfg.alAbrir) cfg.alAbrir(form, cerrar);
            setTimeout(function () {
                var primero = form.querySelector('input:not([type=hidden]):not([disabled]):not([type=radio]), select, textarea, button');
                (primero || fondo.querySelector('[data-cerrar]')).focus();
            }, 30);
        });
    }

    async function descargar(url, nombre) {
        var cab = {};
        var t = token();
        if (t) cab.Authorization = 'Bearer ' + t;
        var r = await fetch(url, { headers: cab });
        if (!r.ok) {
            var msg = 'No se pudo generar el archivo';
            try { msg = (await r.json()).error || msg; } catch (e) { /* binario */ }
            throw new Error(msg);
        }
        var blob = await r.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    // ----------------------------------------------- menús desplegables
    // <div class="menu"><button aria-haspopup="true" aria-expanded="false" data-menu>…</button><div class="menu__panel" hidden>…</div></div>
    function cerrarMenus(excepto) {
        document.querySelectorAll('.menu [data-menu][aria-expanded="true"]').forEach(function (b) {
            if (b === excepto) return;
            b.setAttribute('aria-expanded', 'false');
            var p = b.parentNode.querySelector('.menu__panel');
            if (p) p.hidden = true;
        });
    }
    document.addEventListener('click', function (e) {
        var boton = e.target.closest && e.target.closest('[data-menu]');
        if (boton) {
            var abierto = boton.getAttribute('aria-expanded') === 'true';
            cerrarMenus(boton);
            boton.setAttribute('aria-expanded', abierto ? 'false' : 'true');
            var panel = boton.parentNode.querySelector('.menu__panel');
            if (panel) {
                panel.hidden = abierto;
                if (!abierto) {
                    var primero = panel.querySelector('button, a, input, select');
                    if (primero) setTimeout(function () { primero.focus(); }, 0);
                }
            }
            return;
        }
        if (!(e.target.closest && e.target.closest('.menu__panel'))) cerrarMenus();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var abierto = document.querySelector('.menu [data-menu][aria-expanded="true"]');
        if (abierto) { cerrarMenus(); abierto.focus(); }
    });


    // ------------------------------------------------ menú de la sesión
    // Sustituye "Acceso" por el nombre de quien está en sesión, con sus atajos
    // y "Cerrar sesión". Si la sesión venció, se queda "Acceso".
    var NOMBRE_ROL = { viewer: 'Consulta', editor: 'Editor de área', supervisor: 'Supervisión SMS', admin: 'Administrador' };

    function cerrarSesion() {
        try {
            localStorage.removeItem(CLAVE_TOKEN);
            localStorage.removeItem('rsm_usuario');
        } catch (e) { /* sin acceso a localStorage */ }
        window.location.href = '/login';
    }

    function montarUsuario(u) {
        var nav = document.querySelector('.sg-appbar__nav');
        if (!nav || nav.querySelector('.sg-usuario-menu')) return;
        var nombre = String(u.nombre || u.username || 'Mi cuenta').trim();
        var partes = nombre.split(/\s+/).filter(Boolean);
        var iniciales = partes.slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase();
        var esAdmin = u.rol === 'admin';
        var panel = esAdmin || !u.departamento_codigo
            ? { href: '/admin/reportes-rapidos', texto: 'Administración', icono: 'settings' }
            : { href: '/admin/panel/' + encodeURIComponent(u.departamento_codigo), texto: 'Panel de mi área', icono: 'building' };
        var item = function (href, icono, texto) { return '<a class="menu__item" href="' + href + '">' + ic(icono) + '<span>' + esc(texto) + '</span></a>'; };

        var cont = document.createElement('div');
        cont.className = 'menu sg-usuario-menu';
        cont.innerHTML =
            '<button type="button" class="btn btn-secondary sg-usuario-btn" data-menu aria-haspopup="true" aria-expanded="false" aria-label="Tu cuenta: ' + esc(nombre) + '">' +
            '<span class="sg-avatar" aria-hidden="true">' + esc(iniciales || '·') + '</span><span class="lbl">' + esc(partes[0] || nombre) + '</span>' + ic('chevron-down', 'ic-16 sg-usuario-chev') + '</button>' +
            '<div class="menu__panel" hidden>' +
            '<div class="sg-usuario-cab"><b>' + esc(nombre) + '</b><small>' + esc(NOMBRE_ROL[u.rol] || u.rol) + (u.departamento ? ' · ' + esc(u.departamento) : '') + '</small></div>' +
            item(panel.href, panel.icono, panel.texto) +
            item('/notificaciones', 'bell', 'Notificaciones') +
            item('/mi-cuenta', 'user', 'Mi cuenta') +
            (esAdmin ? item('/admin/usuarios', 'users', 'Usuarios y permisos') : '') +
            '<div class="menu__sep"></div>' +
            '<button type="button" class="menu__item" data-cerrar-sesion>' + ic('logout') + '<span>Cerrar sesión</span></button>' +
            '</div>';

        var acceso = nav.querySelector('a[href^="/login"]');
        if (acceso) acceso.parentNode.replaceChild(cont, acceso);
        else nav.insertBefore(cont, nav.querySelector('.sg-btn-manual'));
        // Los paneles que ya tenían su propio botón "Salir" usan ahora este menú
        nav.querySelectorAll('#btnSalir, #btnSalirPanel').forEach(function (b) { b.hidden = true; });
        cont.querySelector('[data-cerrar-sesion]').addEventListener('click', cerrarSesion);
    }

    // --------------------------------------------------- notificaciones
    var ICONO_TIPO = {
        nuevo_reporte: 'file-plus', asignacion: 'users', actualizacion: 'refresh', accion_asignada: 'checklist',
        validacion_pendiente: 'user-check', accion_reabierta: 'warn', riesgo_evaluado: 'shield', compromiso: 'calendar'
    };

    function montarCampana(usuario) {
        var nav = document.querySelector('.sg-appbar__nav');
        if (!nav || nav.querySelector('.sg-campana')) return;
        var cont = document.createElement('div');
        cont.className = 'sg-campana';
        cont.innerHTML =
            '<button type="button" class="btn btn-secondary btn-icon sg-campana__btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Notificaciones">' +
            ic('bell') + '<span class="sg-campana__num" hidden></span></button>' +
            '<div class="sg-notif" role="dialog" aria-label="Notificaciones" hidden>' +
            '<div class="sg-notif__head"><b>Notificaciones</b><button type="button" class="btn btn-ghost btn-sm" data-leer-todo>Marcar como leídas</button></div>' +
            '<div class="sg-notif__body" aria-live="polite"><div class="sg-notif__vacio"><span class="sg-spinner sg-spinner--sm"></span></div></div>' +
            '<div class="sg-notif__pies"><a class="sg-notif__pie" href="/mi-cuenta">' + ic('user') + 'Mi cuenta</a>' +
            '<a class="sg-notif__pie" href="/notificaciones">Ver todas' + ic('chevron-right') + '</a></div></div>';
        var tema = nav.querySelector('.sg-theme');
        if (tema && tema.nextSibling) nav.insertBefore(cont, tema.nextSibling); else nav.appendChild(cont);

        var btn = cont.querySelector('.sg-campana__btn');
        var num = cont.querySelector('.sg-campana__num');
        var panel = cont.querySelector('.sg-notif');
        var cuerpo = cont.querySelector('.sg-notif__body');
        var datos = null;

        function pintarNumero() {
            if (!datos) return;
            var a = datos.alertas || {};
            var total = (datos.sin_leer || 0) + (a.vencidos || []).length + (a.por_validar || []).length;
            if (window.SMS && SMS.alActualizarNotificaciones) SMS.alActualizarNotificaciones(datos);
            num.hidden = total === 0;
            num.textContent = total > 99 ? '99+' : String(total);
            btn.setAttribute('aria-label', 'Notificaciones' + (total ? ' (' + total + ' pendientes)' : ''));
        }

        function item(href, clase, icono, titulo, detalle, idNotif) {
            return '<a class="sg-notif__item ' + clase + '" href="' + esc(href) + '"' + (idNotif ? ' data-id="' + idNotif + '"' : '') + '>' +
                ic(icono) + '<span><b>' + esc(titulo) + '</b><small>' + esc(detalle) + '</small></span></a>';
        }

        function pintarPanel() {
            if (!datos) return;
            var a = datos.alertas || {};
            var html = '';
            var alertas = '';
            (a.vencidos || []).forEach(function (r) {
                alertas += item('/reportes/' + encodeURIComponent(r.folio), 'crit', 'crit', r.folio + ' · vencido', 'Fecha compromiso: ' + fecha(r.fecha_vencimiento));
            });
            (a.proximos || []).forEach(function (r) {
                alertas += item('/reportes/' + encodeURIComponent(r.folio), 'warn', 'hourglass', r.folio + ' · próximo a vencer', 'Fecha compromiso: ' + fecha(r.fecha_vencimiento));
            });
            (a.por_validar || []).forEach(function (r) {
                alertas += item('/reportes/' + encodeURIComponent(r.folio) + '#acciones', '', 'user-check', r.folio + ' · acción por verificar', String(r.descripcion || '').slice(0, 90));
            });
            if (a.por_evaluar_total) {
                alertas += item('/reportes/general?estado=abiertos&riesgo=pendiente_evaluar', 'warn', 'shield',
                    a.por_evaluar_total + (a.por_evaluar_total === 1 ? ' reporte abierto pendiente' : ' reportes abiertos pendientes') + ' de evaluar',
                    a.matriz_validada ? 'Evalúa su riesgo inicial con la matriz validada' : 'La matriz de riesgo aún no está validada');
            }
            if (alertas) html += '<div class="sg-notif__sec">Requiere atención</div>' + alertas;
            var ev = '';
            (datos.eventos || []).forEach(function (n) {
                ev += item(n.folio ? '/reportes/' + encodeURIComponent(n.folio) : '#', n.leida ? '' : 'is-nueva', ICONO_TIPO[n.tipo] || 'bell',
                    n.titulo, (n.mensaje ? String(n.mensaje).slice(0, 90) + ' · ' : '') + relativa(n.creado_en), n.id);
            });
            if (ev) html += '<div class="sg-notif__sec">Actividad reciente</div>' + ev;
            cuerpo.innerHTML = html || '<div class="sg-notif__vacio">' + ic('inbox', 'ic-24') + '<br>No tienes notificaciones.</div>';
        }

        async function cargar() {
            try {
                datos = await api('/api/sms/notificaciones');
                pintarNumero();
                if (!panel.hidden) pintarPanel();
            } catch (e) {
                if (e.status === 401) { cont.remove(); clearInterval(intervalo); }
            }
        }

        function abrir(si) {
            panel.hidden = !si;
            btn.setAttribute('aria-expanded', si ? 'true' : 'false');
            if (si) { pintarPanel(); cargar(); }
        }
        btn.addEventListener('click', function () { abrir(panel.hidden); });
        document.addEventListener('click', function (e) { if (!panel.hidden && !cont.contains(e.target)) abrir(false); });
        cont.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { abrir(false); btn.focus(); } });
        cont.querySelectorAll('.sg-notif__pie').forEach(function (a) { a.addEventListener('click', function () { abrir(false); }); });
        cuerpo.addEventListener('click', function (e) {
            var a = e.target.closest('.sg-notif__item[data-id]');
            if (a) api('/api/sms/notificaciones/leidas', { method: 'POST', json: { ids: [Number(a.dataset.id)] } }).catch(function () {});
        });
        cont.querySelector('[data-leer-todo]').addEventListener('click', async function () {
            try {
                await api('/api/sms/notificaciones/leidas', { method: 'POST', json: {} });
                await cargar();
                pintarPanel();
            } catch (e) { if (window.SAGA) SAGA.toast(e.message, 'error'); }
        });

        cargar();
        var intervalo = setInterval(function () { if (!document.hidden) cargar(); }, 60000);
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!token()) return;
        sesion().then(function (u) { if (u) { montarUsuario(u); montarCampana(u); } });
    });

    window.SMS = {
        ESTADOS: ESTADOS,
        DOT_ESTADO: DOT_ESTADO,
        token: token,
        api: api,
        sesion: sesion,
        esc: esc,
        ic: ic,
        fecha: fecha,
        fechaHora: fechaHora,
        diaLocal: diaLocal,
        diasEntre: diasEntre,
        sumarDias: sumarDias,
        rangoPeriodo: rangoPeriodo,
        periodoActivo: periodoActivo,
        mes: mes,
        relativa: relativa,
        numero: numero,
        estado: estado,
        riesgo: riesgo,
        nivel: nivel,
        textoSobre: textoSobre,
        vencimiento: vencimiento,
        semaforo: semaforo,
        estadoSemaforo: estadoSemaforo,
        SEMAFORO: SEMAFORO,
        duracion: duracion,
        duracionDias: duracionDias,
        etapas: etapas,
        medirBarra: medirBarra,
        descargar: descargar,
        confirmarEliminacion: confirmarEliminacion,
        pintarReportante: pintarReportante,
        dialogo: dialogo,
        cerrarMenus: cerrarMenus,
        cerrarSesion: cerrarSesion
    };
})();
