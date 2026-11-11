/* S.A.G.A. · Lista con búsqueda (combobox) sobre un <select> existente
   - Se escribe y la lista muestra solo las opciones que coinciden: primero las
     que EMPIEZAN con lo escrito, luego las que tienen una palabra que empieza
     así y al final las que lo contienen. No distingue acentos ni mayúsculas.
   - El <select> original sigue siendo la fuente del valor: al elegir se le
     asigna el valor y se dispara "change", así que validaciones, borradores y
     demás código que lo usa no cambian. Queda oculto para no repetir el campo.
   - Teclado: flechas para moverse, Enter para elegir, Esc para cerrar.
   Uso:  SAGABuscable.mejorar(select, { vacio: 'Texto de la opción vacía' })
         SAGABuscable.sincronizar(select)   tras asignar select.value por código */
(function (raiz) {
    'use strict';

    var instancias = [];
    var contador = 0;

    /** Sin acentos y en minúsculas, conservando espacios (para comparar letra por letra). */
    function plana(t) {
        return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }
    function normalizar(t) {
        return plana(t).trim().replace(/\s+/g, ' ');
    }
    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /**
     * Texto sin acentos y, por cada letra, su posición en el original (quitar
     * acentos puede cambiar el largo). Se guarda: los textos son los de las opciones.
     */
    var planos = new Map();
    function planoDe(texto) {
        var r = planos.get(texto);
        if (r) return r;
        r = { plano: '', mapa: [] };
        for (var i = 0; i < texto.length; i++) {
            var c = plana(texto[i]);
            for (var j = 0; j < c.length; j++) { r.mapa.push(i); r.plano += c[j]; }
        }
        planos.set(texto, r);
        return r;
    }

    /** Resalta lo escrito dentro del texto (compara sin acentos y muestra el texto original). */
    function resaltar(texto, consulta) {
        var q = normalizar(consulta);
        if (!q) return esc(texto);
        var p = planoDe(texto), plano = p.plano, mapa = p.mapa;
        // Prefiere una coincidencia al inicio de una palabra
        var pos = -1, re = /(^|[^a-z0-9ñ])/g, m;
        while ((m = re.exec(plano)) !== null) {
            var k = m.index + m[1].length;
            if (plano.substr(k, q.length) === q) { pos = k; break; }
            if (re.lastIndex === m.index) re.lastIndex++;
        }
        if (pos < 0) pos = plano.indexOf(q);
        if (pos < 0) return esc(texto);
        var ini = mapa[pos], fin = mapa[pos + q.length - 1] + 1;
        return esc(texto.slice(0, ini)) + '<mark>' + esc(texto.slice(ini, fin)) + '</mark>' + esc(texto.slice(fin));
    }

    function opcionesDe(select) {
        return Array.prototype.filter.call(select.options, function (o) { return o.value !== '' && !o.disabled; }).map(function (o, i) {
            var grupo = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '';
            var norm = normalizar(o.textContent);
            return { valor: o.value, texto: o.textContent.trim(), grupo: grupo, orden: i, norm: norm, palabras: norm.split(/[^a-z0-9ñ]+/) };
        });
    }

    /** Filtra y ordena: empieza con lo escrito → alguna palabra empieza así → lo contiene. */
    function filtrar(lista, consulta) {
        var q = normalizar(consulta);
        if (!q) return lista.slice();
        var palabras = q.split(/\s+/).filter(Boolean);
        return lista.map(function (o) {
            if (!palabras.every(function (p) { return o.norm.indexOf(p) >= 0; })) return null;
            var puntos = o.norm.indexOf(q) === 0 ? 0
                : (o.palabras || o.norm.split(/[^a-z0-9ñ]+/)).some(function (w) { return w.indexOf(palabras[0]) === 0; }) ? 1 : 2;
            return { o: o, puntos: puntos };
        }).filter(Boolean).sort(function (a, b) { return a.puntos - b.puntos || a.o.orden - b.o.orden; })
            .map(function (x) { return x.o; });
    }

    function mejorar(select, opciones) {
        if (!select || select.dataset.buscable) return null;
        opciones = opciones || {};
        select.dataset.buscable = '1';
        var id = 'bus' + (++contador);
        // Texto cuando no hay nada elegido: el indicado o el de la opción vacía vigente
        function vacio() {
            if (opciones.vacio) return opciones.vacio;
            var o = select.options[0];
            return o && o.value === '' ? o.textContent.trim() : 'Escribe para buscar';
        }

        var caja = document.createElement('div');
        caja.className = 'buscable';
        caja.innerHTML =
            '<div class="buscable__campo">' +
            '<input type="text" class="buscable__input" id="' + id + '" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-lista" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="buscable__limpiar" aria-label="Quitar la selección" hidden><svg class="ic" aria-hidden="true"><use href="/img/icons.svg#i-x"/></svg></button>' +
            '<svg class="ic buscable__chev" aria-hidden="true"><use href="/img/icons.svg#i-chevron-down"/></svg>' +
            '</div>' +
            '<ul class="buscable__lista" id="' + id + '-lista" role="listbox" hidden></ul>' +
            '<span class="sr-only" aria-live="polite"></span>';
        select.parentNode.insertBefore(caja, select.nextSibling);
        select.classList.add('buscable__origen');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        // La etiqueta del campo apunta ahora a la caja de búsqueda
        if (select.id) {
            var etiqueta = document.querySelector('label[for="' + select.id + '"]');
            if (etiqueta) etiqueta.setAttribute('for', id);
        }

        var input = caja.querySelector('input');
        var lista = caja.querySelector('ul');
        var limpiar = caja.querySelector('.buscable__limpiar');
        var aviso = caja.querySelector('[aria-live]');
        var visibles = [], activa = -1, abierta = false;
        // Sin MutationObserver no hay aviso de cambios: se leen cada vez
        var guardadas = null;
        function todas() {
            if (!raiz.MutationObserver) return opcionesDe(select);
            return guardadas || (guardadas = opcionesDe(select));
        }

        function textoElegido() {
            var o = select.options[select.selectedIndex];
            return o && o.value !== '' ? o.textContent.trim() : '';
        }
        function sincronizar() {
            input.value = textoElegido();
            input.placeholder = select.value ? '' : vacio();
            limpiar.hidden = !select.value || select.disabled;
            input.disabled = select.disabled;
        }
        function pintar() {
            var q = input.value === textoElegido() ? '' : input.value;
            visibles = filtrar(todas(), q);
            if (activa >= visibles.length) activa = visibles.length - 1;
            if (!visibles.length) {
                lista.innerHTML = '<li class="buscable__vacio" role="presentation">Sin coincidencias para “' + esc(input.value.trim()) + '”</li>';
                input.removeAttribute('aria-activedescendant');
                aviso.textContent = 'Sin coincidencias';
                return;
            }
            var grupoPrevio = null;
            lista.innerHTML = visibles.map(function (o, i) {
                var sep = '';
                if (!q && o.grupo && o.grupo !== grupoPrevio) { sep = '<li class="buscable__grupo" role="presentation">' + esc(o.grupo) + '</li>'; grupoPrevio = o.grupo; }
                return sep + '<li role="option" id="' + id + '-o' + i + '" data-i="' + i + '" class="buscable__op' + (i === activa ? ' is-activa' : '') + '"' +
                    ' aria-selected="' + (o.valor === select.value) + '"><span>' + resaltar(o.texto, q) + '</span>' +
                    (q && o.grupo ? '<small>' + esc(o.grupo) + '</small>' : '') + '</li>';
            }).join('');
            if (activa >= 0) input.setAttribute('aria-activedescendant', id + '-o' + activa);
            else input.removeAttribute('aria-activedescendant');
            aviso.textContent = q ? visibles.length + (visibles.length === 1 ? ' coincidencia' : ' coincidencias') : '';
        }
        function abrir() {
            if (abierta || select.disabled) return;
            abierta = true;
            // Al abrir sin escribir, se marca la opción elegida y se lleva a la vista
            activa = -1;
            todas().forEach(function (o, i) { if (o.valor === select.value) activa = i; });
            pintar();
            lista.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            caja.classList.add('is-abierta');
            mostrarActiva();
        }
        function cerrar() {
            if (!abierta) return;
            abierta = false;
            lista.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            caja.classList.remove('is-abierta');
        }
        function mostrarActiva() {
            var el = lista.querySelector('.is-activa');
            if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        }
        function marcar(i) {
            var previa = lista.querySelector('.is-activa');
            if (previa) previa.classList.remove('is-activa');
            activa = i;
            var el = document.getElementById(id + '-o' + i);
            if (!el) return;
            el.classList.add('is-activa');
            input.setAttribute('aria-activedescendant', el.id);
            mostrarActiva();
        }
        function elegir(o) {
            var cambio = select.value !== o.valor;
            select.value = o.valor;
            sincronizar();
            cerrar();
            if (cambio) select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        function vaciar() {
            var cambio = select.value !== '';
            select.value = '';
            sincronizar();
            if (cambio) select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        input.addEventListener('focus', function () { input.select(); abrir(); });
        input.addEventListener('click', abrir);
        input.addEventListener('input', function () { activa = 0; if (!abierta) abrir(); pintar(); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!abierta) { abrir(); return; }
                if (!visibles.length) return;
                marcar(e.key === 'ArrowDown' ? Math.min(visibles.length - 1, activa + 1) : Math.max(0, activa - 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (abierta && visibles[activa]) elegir(visibles[activa]);
                else if (abierta && visibles.length === 1) elegir(visibles[0]);
            } else if (e.key === 'Escape') {
                if (abierta) { e.preventDefault(); cerrar(); sincronizar(); }
            } else if (e.key === 'Tab') {
                if (abierta && input.value.trim() && input.value !== textoElegido() && visibles[activa]) elegir(visibles[activa]);
                cerrar();
            }
        });
        input.addEventListener('blur', function () {
            setTimeout(function () {
                if (caja.contains(document.activeElement)) return;
                // Texto escrito igual a una opción: se elige; si no, se regresa a lo elegido
                var escrito = normalizar(input.value);
                if (escrito && escrito !== normalizar(textoElegido())) {
                    var exacta = todas().filter(function (o) { return o.norm === escrito; })[0];
                    if (exacta) { elegir(exacta); return; }
                }
                cerrar();
                sincronizar();
            }, 120);
        });
        lista.addEventListener('mousedown', function (e) { e.preventDefault(); });
        lista.addEventListener('click', function (e) {
            var li = e.target.closest('[data-i]');
            if (li) elegir(visibles[Number(li.dataset.i)]);
        });
        limpiar.addEventListener('click', function () { vaciar(); input.focus(); });

        // Cambios hechos por código: opciones nuevas, valor restaurado, formulario reiniciado
        if (raiz.MutationObserver) new MutationObserver(function () { guardadas = null; sincronizar(); if (abierta) pintar(); }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        select.addEventListener('change', sincronizar);
        if (select.form) select.form.addEventListener('reset', function () { setTimeout(sincronizar, 0); });

        var inst = { select: select, sincronizar: sincronizar };
        instancias.push(inst);
        sincronizar();
        return inst;
    }

    function sincronizar(select) {
        instancias.forEach(function (i) { if (!select || i.select === select) i.sincronizar(); });
    }

    raiz.SAGABuscable = { mejorar: mejorar, sincronizar: sincronizar, filtrar: filtrar, normalizar: normalizar, resaltar: resaltar };
    if (typeof module === 'object' && module.exports) module.exports = raiz.SAGABuscable;
})(typeof window !== 'undefined' ? window : globalThis);
