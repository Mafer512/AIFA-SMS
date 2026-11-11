/* S.A.G.A. · Web Worker que arma el PDF sin bloquear la página.
   Mensajes:  página → { tipo: 'construir', datos }
              worker → { tipo: 'avance', texto, avance } · { tipo: 'listo', buffer, paginas, horizontal, recortadas }
                       { tipo: 'error', mensaje }                                                         */
/* global importScripts, SMSPdf */
'use strict';
importScripts('/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js', '/js/sms-exportacion.js', '/js/sms-pdf.js');

self.onmessage = function (e) {
    if (!e.data || e.data.tipo !== 'construir') return;
    try {
        var r = SMSPdf.construir(e.data.datos, function (a) { self.postMessage({ tipo: 'avance', texto: a.texto, avance: a.avance }); });
        self.postMessage({ tipo: 'listo', buffer: r.buffer, paginas: r.paginas, horizontal: r.horizontal, recortadas: r.recortadas }, [r.buffer]);
    } catch (err) {
        self.postMessage({ tipo: 'error', mensaje: err && err.message ? err.message : String(err) });
    }
};
