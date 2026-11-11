/* ============================================================================
   Migración 005 · Matriz de riesgo con los criterios del Manual SMS del AIFA
   - Cambia la matriz guardada por la del numeral 5.3 del Manual SMS
     (Revisión 02, noviembre 2025): nombres y descripciones de probabilidad y
     gravedad, niveles Intolerable / Tolerable / Aceptable y la guía de
     gravedad por tipo de consecuencia tomada de la misma tabla.
   - SOLO si la matriz guardada NO está validada y sigue exactamente igual a la
     referencia anterior (OACI, Doc 9859, sin ediciones). Si alguien ya la
     modificó o validó, no se toca: se avisa en la consola.
   - Conserva los días de aviso de vencimiento configurados.
   NO DESTRUCTIVA para reportes ni evaluaciones. Se puede ejecutar más de una vez.
   ========================================================================= */
'use strict';

const crypto = require('crypto');
const riesgo = require('../../lib/sms/riesgo');

// Huellas de la referencia anterior (criterios y guía por consecuencia de la migración 004)
const HUELLA_CRITERIOS_ANTERIOR = '2e12b0d929b3e396c3135dedf8f78209ad65079ea0006a9b2211988c59b15610';
const HUELLA_CONSECUENCIAS_ANTERIOR = '54cf542f21b23e71ae23c494f30cbd09be6e67159c7ccaf2e37bcac47a921c95';

const huella = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

module.exports = async function migracion005(conn) {
    const [filas] = await conn.query('SELECT valor FROM configuracion_sistema WHERE clave = ? LIMIT 1', [riesgo.CLAVE_CONFIG]);
    if (!filas.length || !filas[0].valor) return; // sin matriz guardada: migrar.js siembra la nueva referencia

    let guardada;
    try {
        guardada = riesgo.validarMatriz(typeof filas[0].valor === 'string' ? JSON.parse(filas[0].valor) : filas[0].valor);
    } catch (e) {
        console.log('  (005) La matriz guardada no es válida; no se modifica: ' + e.message);
        return;
    }
    if (guardada.validada) {
        console.log('  (005) La matriz guardada está validada; no se modifica.');
        return;
    }
    if (huella([guardada.probabilidad, guardada.severidad, guardada.niveles, guardada.celdas]) !== HUELLA_CRITERIOS_ANTERIOR) {
        console.log('  (005) La matriz guardada tiene cambios propios; no se modifica. Puedes cargar los criterios del manual desde /admin/matriz-riesgo.');
        return;
    }

    const ref = riesgo.copia(riesgo.MATRIZ_REFERENCIA);
    const consecuenciasSinCambios = !guardada.consecuencias.length || huella(guardada.consecuencias) === HUELLA_CONSECUENCIAS_ANTERIOR;
    await riesgo.guardarMatriz(conn, {
        ...ref,
        alertas: guardada.alertas,
        consecuencias: consecuenciasSinCambios ? ref.consecuencias : guardada.consecuencias
    });
};
