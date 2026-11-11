/* ============================================================================
   Acciones correctivas y preventivas: reglas de cambio de estado
   ----------------------------------------------------------------------------
   pendiente ──► en_proceso ──► completada ──► verificada (efectiva, final)
       │             │              │
       │             │              └──► en_proceso (verificación: NO efectiva)
       └─────────────┴──────────────┴──► cancelada (final, requiere motivo)

   - "completada" significa que el responsable terminó; queda POR VERIFICAR.
   - Solo supervisión (supervisor/admin) verifica la efectividad o cancela.
   - Un reporte no puede marcarse como Resuelto (D) mientras tenga acciones
     pendientes, en proceso o sin verificar. Nunca se cierra automáticamente.
   ========================================================================= */
'use strict';

const ESTADOS = {
    pendiente:  { nombre: 'Pendiente', abierta: true },
    en_proceso: { nombre: 'En proceso', abierta: true },
    completada: { nombre: 'Por verificar', abierta: false },
    verificada: { nombre: 'Verificada', abierta: false },
    cancelada:  { nombre: 'Cancelada', abierta: false }
};

const TIPOS = { correctiva: 'Correctiva', preventiva: 'Preventiva' };

// destino => capacidad necesaria
const TRANSICIONES = {
    pendiente:  { en_proceso: 'actualizar_accion', completada: 'actualizar_accion', cancelada: 'cancelar_accion' },
    en_proceso: { completada: 'actualizar_accion', cancelada: 'cancelar_accion' },
    completada: { verificada: 'verificar_accion', en_proceso: 'verificar_accion', cancelada: 'cancelar_accion' },
    verificada: {},
    cancelada:  {}
};

/** Estados que bloquean el cierre del reporte como Resuelto. */
const ESTADOS_QUE_BLOQUEAN_CIERRE = ['pendiente', 'en_proceso', 'completada'];

function transicionPermitida(actual, nuevo) {
    return Boolean(TRANSICIONES[actual] && TRANSICIONES[actual][nuevo]);
}

/**
 * Valida una transición y devuelve la capacidad requerida.
 * Lanza un Error con un mensaje en español si no procede.
 */
function validarTransicion(actual, nuevo, { comentario } = {}) {
    if (!ESTADOS[nuevo]) throw new Error('Estado de acción no válido');
    if (actual === nuevo) throw new Error('La acción ya está en ese estado');
    if (!transicionPermitida(actual, nuevo)) {
        throw new Error(`No se puede pasar de "${ESTADOS[actual] ? ESTADOS[actual].nombre : actual}" a "${ESTADOS[nuevo].nombre}"`);
    }
    if (nuevo === 'cancelada' && !String(comentario || '').trim()) {
        throw new Error('Indica el motivo de la cancelación');
    }
    if (actual === 'completada' && nuevo === 'en_proceso' && !String(comentario || '').trim()) {
        throw new Error('Explica por qué la acción no fue efectiva');
    }
    return TRANSICIONES[actual][nuevo];
}

/** Revisa si un reporte puede cerrarse como Resuelto según sus acciones. */
/** ¿Se puede cerrar el reporte? nombre = estatus de cierre (Resuelto, Duplicado o No requiere atención). */
function evaluarCierre(acciones, nombre = 'Resuelto') {
    const pendientes = (acciones || []).filter(a => ESTADOS_QUE_BLOQUEAN_CIERRE.includes(a.estado));
    return {
        puede_cerrar: pendientes.length === 0,
        pendientes: pendientes.length,
        mensaje: pendientes.length
            ? `No se puede marcar como ${nombre}: ${pendientes.length === 1 ? 'hay 1 acción correctiva' : `hay ${pendientes.length} acciones correctivas`} sin concluir o sin verificar su efectividad.`
            : ''
    };
}

/** Normaliza una fecha YYYY-MM-DD; devuelve null si es inválida. */
function fechaISO(valor) {
    const t = String(valor || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
    const d = new Date(t + 'T00:00:00Z');
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) return null;
    return t;
}

function hoyISO(ahora = new Date()) {
    // Fecha local del servidor (el AIFA opera en hora del centro de México)
    const z = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
}

/** Valida los datos de una acción nueva. */
function validarNuevaAccion(datos, hoy = hoyISO()) {
    const errores = [];
    const tipo = TIPOS[datos.tipo] ? datos.tipo : null;
    if (!tipo) errores.push('Elige si la acción es correctiva o preventiva');
    const descripcion = String(datos.descripcion || '').trim();
    if (descripcion.length < 5) errores.push('Describe la acción (mínimo 5 caracteres)');
    if (descripcion.length > 2000) errores.push('La descripción admite máximo 2000 caracteres');
    const idDepto = datos.id_departamento_responsable ? Number(datos.id_departamento_responsable) : null;
    if (idDepto !== null && (!Number.isInteger(idDepto) || idDepto < 1)) errores.push('Área responsable no válida');
    const responsable = String(datos.responsable_nombre || '').trim();
    if (responsable.length > 200) errores.push('El nombre del responsable admite máximo 200 caracteres');
    if (!idDepto && !responsable) errores.push('Indica el área o la persona responsable');
    const asignacion = datos.fecha_asignacion ? fechaISO(datos.fecha_asignacion) : hoy;
    if (!asignacion) errores.push('Fecha de asignación no válida');
    const compromiso = fechaISO(datos.fecha_compromiso);
    if (!compromiso) errores.push('Indica una fecha compromiso válida');
    if (asignacion && compromiso && compromiso < asignacion) errores.push('La fecha compromiso no puede ser anterior a la de asignación');
    const observaciones = String(datos.observaciones || '').trim();
    if (observaciones.length > 2000) errores.push('Las observaciones admiten máximo 2000 caracteres');
    if (errores.length) {
        const e = new Error(errores[0]);
        e.errores = errores;
        throw e;
    }
    return {
        tipo,
        descripcion,
        id_departamento_responsable: idDepto,
        responsable_nombre: responsable || null,
        fecha_asignacion: asignacion,
        fecha_compromiso: compromiso,
        observaciones: observaciones || null
    };
}

/** Clasifica una fecha compromiso: vencido | proximo | en_tiempo | null */
function estadoVencimiento(fecha, hoy = hoyISO(), diasAviso = 7) {
    const f = fecha instanceof Date ? hoyISO(fecha) : fechaISO(fecha);
    if (!f) return null;
    if (f < hoy) return 'vencido';
    const limite = new Date(hoy + 'T00:00:00Z');
    limite.setUTCDate(limite.getUTCDate() + diasAviso);
    return f <= limite.toISOString().slice(0, 10) ? 'proximo' : 'en_tiempo';
}

module.exports = {
    ESTADOS,
    TIPOS,
    TRANSICIONES,
    ESTADOS_QUE_BLOQUEAN_CIERRE,
    transicionPermitida,
    validarTransicion,
    evaluarCierre,
    validarNuevaAccion,
    estadoVencimiento,
    fechaISO,
    hoyISO
};
