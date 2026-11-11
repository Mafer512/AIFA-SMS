/* ============================================================================
   Clasificación del reporte y datos operacionales
   ----------------------------------------------------------------------------
   - TIPOS_REPORTE: qué se reporta, agrupado como en el numeral 5.2.1 del Manual
     SMS del AIFA: reportes voluntarios (prevenir) y obligatorios (eventos que ya
     causaron alguna afectación). Las definiciones de incidente, accidente y
     peligro (condición insegura) son las de la NOM-064-SCT3-2023.
   - Opinión de quien reporta: frecuencia y gravedad en escala 1 a 5 (la misma
     de la matriz). Es solo referencia; la evaluación oficial la hace la Gerencia.
   - Datos operacionales opcionales: vuelo, matrícula, posición y equipo de
     apoyo (GSE). La tabla partes_involucradas y sus columnas en reportes
     (migración 004) quedan en la base sin uso: se quitó la parte involucrada.
   ========================================================================= */
'use strict';

// Origen de cada definición: NOM-064-SCT3-2023 (condición insegura = definición
// de peligro; incidente; accidente) y numeral 5.2.1 del Manual SMS (acto
// inseguro). Buena práctica y casi accidente no están definidos en el manual.
const TIPOS_REPORTE = Object.freeze([
    { clave: 'condicion_insegura', nombre: 'Condición insegura', grupo: 'voluntario',
      descripcion: 'Condición u objeto que podría provocar un incidente o accidente de aviación o contribuir al mismo.' },
    { clave: 'acto_inseguro', nombre: 'Acto inseguro', grupo: 'voluntario',
      descripcion: 'Acto de una persona que pone en riesgo la Seguridad Operacional.' },
    { clave: 'buena_practica', nombre: 'Buena práctica', grupo: 'voluntario',
      descripcion: 'Reconocimiento a una persona o equipo que actuó de forma segura o evitó un peligro.' },
    { clave: 'casi_accidente', nombre: 'Casi accidente', grupo: 'obligatorio',
      descripcion: 'Suceso que estuvo a punto de convertirse en accidente y se evitó, sin lesiones ni daños.' },
    { clave: 'incidente', nombre: 'Incidente', grupo: 'obligatorio',
      descripcion: 'Todo suceso relacionado con la utilización de una aeronave, que no llegue a ser un accidente que afecte o pueda afectar la Seguridad Operacional.' },
    { clave: 'accidente', nombre: 'Accidente', grupo: 'obligatorio',
      descripcion: 'Todo suceso en el cual se causen lesiones mortales o graves, a personas a bordo de la aeronave, o en tierra, por partes que se hayan desprendido, o bien, se ocasionen daños o roturas estructurales a la aeronave, o por el que la aeronave desaparezca o se encuentre en un lugar inaccesible.' }
]);

// Manual SMS, numeral 5.2.1
const GRUPOS_REPORTE = Object.freeze({
    voluntario: { nombre: 'Reporte voluntario', objetivo: 'Prevenir, identificar y comunicar actos o condiciones inseguras que pongan en riesgo la Seguridad Operacional.' },
    obligatorio: { nombre: 'Reporte obligatorio', objetivo: 'Notificar aquellos eventos que ya causaron alguna afectación a la Seguridad Operacional.' }
});

const GSE_TIPOS = Object.freeze([
    'Tractor de equipaje',
    'Carro o dolly de equipaje',
    'Banda transportadora',
    'Cargador de contenedores (loader)',
    'Escalera de pasajeros',
    'Planta eléctrica (GPU)',
    'Planta neumática (ASU)',
    'Unidad de aire acondicionado',
    'Tractor de remolque (push-back)',
    'Barra de remolque',
    'Camión cisterna de combustible',
    'Dispensador de hidrante',
    'Camión de agua potable',
    'Camión de servicio sanitario',
    'Camión de catering',
    'Plataforma elevadora',
    'Aeropasillo (pasillo telescópico)',
    'Autobús de plataforma',
    'Vehículo de servicio (van o pick-up)',
    'Montacargas',
    'Contenedor o pallet (ULD)',
    'Silla de ruedas o ambulift',
    'Otro'
]);

const CLAVES_TIPO = TIPOS_REPORTE.map(t => t.clave);

function nombreTipo(clave) {
    const t = TIPOS_REPORTE.find(x => x.clave === clave);
    return t ? t.nombre : null;
}

function error(mensaje) {
    return Object.assign(new Error(mensaje), { status: 400 });
}

function textoOpcional(valor, max) {
    const t = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
    return t ? t.slice(0, max) : null;
}

/** Escala 1 a 5 opcional. Vacío → null; cualquier otro valor fuera de rango es error. */
function escala(valor, campo) {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw error(`${campo}: elige un valor de 1 a 5`);
    return n;
}

/** Identificador operacional: mayúsculas, letras, números, espacio, guion y diagonal. */
function codigo(valor, max, campo) {
    const t = textoOpcional(valor, 200);
    if (!t) return null;
    const v = t.toUpperCase();
    if (v.length > max) throw error(`${campo}: máximo ${max} caracteres`);
    if (!/^[A-Z0-9Ñ][A-Z0-9Ñ /-]*$/.test(v)) throw error(`${campo}: solo letras, números, espacio, guion o diagonal`);
    return v;
}

/**
 * Valida y normaliza los campos de clasificación del formulario de reporte.
 * Las claves devueltas son los nombres de las columnas de reportes.
 * @returns {{tipo_reporte, percepcion_probabilidad, percepcion_severidad, sugerencia_prevencion,
 *            vuelo, matricula, posicion, gse_tipo, gse_numero}}
 */
function validarDatosReporte(b = {}) {
    const tipo = String(b.tipo_reporte == null ? '' : b.tipo_reporte).trim();
    if (tipo && !CLAVES_TIPO.includes(tipo)) throw error('Tipo de reporte no válido');

    const gseTipo = textoOpcional(b.gse_tipo, 80);
    if (gseTipo && !GSE_TIPOS.includes(gseTipo)) throw error('Tipo de equipo de apoyo (GSE) no válido');

    const sugerencia = String(b.sugerencia_prevencion == null ? '' : b.sugerencia_prevencion).trim();
    if (sugerencia.length > 1000) throw error('La sugerencia admite máximo 1000 caracteres');

    return {
        tipo_reporte: tipo || null,
        percepcion_probabilidad: escala(b.percepcion_probabilidad, 'Frecuencia'),
        percepcion_severidad: escala(b.percepcion_severidad, 'Gravedad'),
        sugerencia_prevencion: sugerencia || null,
        vuelo: codigo(b.vuelo, 10, 'Vuelo'),
        matricula: codigo(b.matricula, 12, 'Matrícula'),
        posicion: codigo(b.posicion, 20, 'Posición'),
        gse_tipo: gseTipo,
        gse_numero: codigo(b.gse_numero, 30, 'Número económico del GSE')
    };
}

module.exports = {
    TIPOS_REPORTE,
    GRUPOS_REPORTE,
    CLAVES_TIPO,
    GSE_TIPOS,
    nombreTipo,
    validarDatosReporte
};
