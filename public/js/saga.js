/* S.A.G.A. · utilidades de interfaz compartidas
   - SAGA.icono(nombre, clase): devuelve el SVG de un icono del sprite.
   - SAGA.toast(mensaje, tipo, opciones): aviso flotante con estilo de alerta.
     tipo: 'success' | 'error' | 'warning' | 'info'
   - SAGA.tema: modo claro / oscuro (botones con la clase .sg-theme).       */
(function () {
    'use strict';

    var SPRITE = '/img/icons.svg';

    function icono(nombre, clase) {
        return '<svg class="ic' + (clase ? ' ' + clase : '') + '" aria-hidden="true" focusable="false">' +
            '<use href="' + SPRITE + '#i-' + nombre + '"/></svg>';
    }

    var TIPOS = {
        success: { cls: 'ok',   icono: 'ok',   duracion: 4500 },
        error:   { cls: 'crit', icono: 'crit', duracion: 7000 },
        warning: { cls: 'warn', icono: 'warn', duracion: 6000 },
        info:    { cls: 'info', icono: 'info', duracion: 4500 }
    };

    function contenedor() {
        var host = document.querySelector('.sg-toasts');
        if (!host) {
            host = document.createElement('div');
            host.className = 'sg-toasts';
            host.setAttribute('role', 'status');
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        return host;
    }

    function toast(mensaje, tipo, opciones) {
        var cfg = TIPOS[tipo] || TIPOS.info;
        opciones = opciones || {};

        var aviso = document.createElement('div');
        aviso.className = 'sg-alert sg-toast ' + cfg.cls;
        aviso.innerHTML = icono(cfg.icono) +
            '<div class="bd"><div class="t"></div></div>' +
            '<button type="button" class="x" aria-label="Cerrar aviso">' + icono('x', 'ic-16') + '</button>';

        var cuerpo = aviso.querySelector('.bd');
        if (opciones.titulo) {
            aviso.querySelector('.t').textContent = opciones.titulo;
            var m = document.createElement('div');
            m.className = 'm';
            m.textContent = mensaje;
            cuerpo.appendChild(m);
        } else {
            aviso.querySelector('.t').textContent = mensaje;
        }

        function cerrar() {
            aviso.classList.remove('is-in');
            setTimeout(function () { aviso.remove(); }, 220);
        }
        aviso.querySelector('.x').addEventListener('click', cerrar);

        contenedor().appendChild(aviso);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { aviso.classList.add('is-in'); });
        });
        setTimeout(cerrar, opciones.duracion || cfg.duracion);
        return aviso;
    }

    /* ---------------------------------------------------------------
       Tema claro / oscuro
       Se aplica en cuanto carga este script (está en <head>), así la
       página no parpadea en blanco. La elección se guarda por navegador
       y se sincroniza entre pestañas abiertas.
       --------------------------------------------------------------- */
    var CLAVE_TEMA = 'saga-tema';
    var raiz = document.documentElement;

    function leerTema() {
        try { return localStorage.getItem(CLAVE_TEMA) === 'dark' ? 'dark' : 'light'; }
        catch (e) { return 'light'; }
    }

    function temaActual() {
        return raiz.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function pintarBotones() {
        var oscuro = temaActual() === 'dark';
        var botones = document.querySelectorAll('.sg-theme');
        for (var i = 0; i < botones.length; i++) {
            botones[i].setAttribute('aria-pressed', oscuro ? 'true' : 'false');
            botones[i].title = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
        }
    }

    function aplicarTema(tema, animar) {
        tema = tema === 'dark' ? 'dark' : 'light';
        if (animar) {
            raiz.classList.add('sg-tema-anim');
            clearTimeout(aplicarTema._t);
            aplicarTema._t = setTimeout(function () { raiz.classList.remove('sg-tema-anim'); }, 320);
        }
        raiz.setAttribute('data-theme', tema);
        pintarBotones();
    }

    function cambiarTema(tema) {
        aplicarTema(tema, true);
        try { localStorage.setItem(CLAVE_TEMA, temaActual()); } catch (e) { /* sin almacenamiento */ }
    }

    aplicarTema(leerTema(), false);

    document.addEventListener('click', function (e) {
        var boton = e.target.closest && e.target.closest('.sg-theme');
        if (!boton) return;
        cambiarTema(temaActual() === 'dark' ? 'light' : 'dark');
    });

    document.addEventListener('DOMContentLoaded', pintarBotones);

    window.addEventListener('storage', function (e) {
        if (e.key === CLAVE_TEMA) aplicarTema(e.newValue, true);
    });

    window.SAGA = {
        icono: icono,
        toast: toast,
        tema: {
            actual: temaActual,
            cambiar: cambiarTema,
            alternar: function () { cambiarTema(temaActual() === 'dark' ? 'light' : 'dark'); }
        }
    };
})();
