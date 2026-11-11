/* ============================================================================
   Matriz de riesgo operacional 5 × 5
   ----------------------------------------------------------------------------
   Los valores por defecto son los criterios del numeral 5.3 del Manual SMS del
   AIFA (Revisión 02, noviembre 2025), publicados en la Agenda SMS 2026:
   probabilidad y gravedad (5.3) y tolerabilidad del riesgo (5.3.3.1).
   La matriz es configurable y queda "pendiente de validación" hasta que un
   administrador la confirme en el sistema; solo entonces se registran
   evaluaciones de riesgo.
   ========================================================================= */
'use strict';

const { sinAcentos } = require('./lugares');

const CLAVE_CONFIG = 'sms_matriz_riesgo';

const MATRIZ_REFERENCIA = Object.freeze({
    version: 'manual-sms-aifa-rev02',
    validada: false,
    nota: 'Criterios del numeral 5.3 del Manual SMS del AIFA (Revisión 02, noviembre 2025). Un administrador debe confirmarlos en el sistema para habilitar las evaluaciones de riesgo.',
    // Fila: probabilidad (5 = más probable) · Manual SMS, numeral 5.3
    probabilidad: [
        { valor: 5, nombre: 'Frecuente', descripcion: 'Es probable que suceda muchas veces (ha ocurrido frecuentemente).' },
        { valor: 4, nombre: 'Ocasional', descripcion: 'Es probable que suceda algunas veces (ha ocurrido con poca frecuencia).' },
        { valor: 3, nombre: 'Remoto', descripcion: 'Es poco probable que ocurra, pero no imposible (rara vez ha ocurrido).' },
        { valor: 2, nombre: 'Improbable', descripcion: 'Es muy poco probable que ocurra (no se sabe que haya ocurrido).' },
        { valor: 1, nombre: 'Sumamente improbable', descripcion: 'Es casi inconcebible que el suceso ocurra.' }
    ],
    // Columna: gravedad (5 = más grave). "codigo" es la letra que se muestra · Manual SMS, numeral 5.3
    severidad: [
        { valor: 5, codigo: 'A', nombre: 'Catastrófico', descripcion: 'Aeronave o equipo destruidos. Varias muertes.' },
        { valor: 4, codigo: 'B', nombre: 'Peligroso', descripcion: 'Gran reducción de los márgenes de Seguridad Operacional. Estrés físico o una carga de trabajo tal que ya no se pueda confiar en que el personal de operaciones realice sus tareas con precisión o por completo. Lesiones graves. Daños importantes al equipo.' },
        { valor: 3, codigo: 'C', nombre: 'Importante', descripcion: 'Reducción importante de los márgenes de Seguridad Operacional, reducción en la capacidad del personal de operaciones para tolerar condiciones de operación adversas, como resultado de un aumento en la carga de trabajo o como resultado de condiciones que afecten su eficiencia. Incidente grave. Lesiones a las personas.' },
        { valor: 2, codigo: 'D', nombre: 'Leve', descripcion: 'Molestias. Limitaciones operacionales. Uso de procedimientos de emergencia. Incidente leve.' },
        { valor: 1, codigo: 'E', nombre: 'Insignificante', descripcion: 'Pocas consecuencias.' }
    ],
    // Tolerabilidad del riesgo · Manual SMS, numeral 5.3.3.1
    niveles: [
        { clave: 'alto', nombre: 'Intolerable', prioridad: 'Medidas inmediatas para mitigar o suspender la actividad', color: '#CF324C', plazo_dias: null, es_alto: true },
        { clave: 'medio', nombre: 'Tolerable', prioridad: 'Tolerable con mitigación; puede requerir decisión de gestión', color: '#E0A030', plazo_dias: null, es_alto: false },
        { clave: 'bajo', nombre: 'Aceptable', prioridad: 'Aceptable tal cual; no requiere mitigación posterior', color: '#078C72', plazo_dias: null, es_alto: false }
    ],
    // Clasificación de cada celda "probabilidad-severidad" (numeral 5.3.3.1):
    // Intolerable 5A, 5B, 5C, 4A, 4B, 3A · Tolerable 5D, 5E, 4C, 4D, 4E, 3B, 3C, 3D, 2A, 2B, 2C, 1A
    // Aceptable 3E, 2D, 2E, 1B, 1C, 1D, 1E
    celdas: {
        '5-5': 'alto', '5-4': 'alto', '5-3': 'alto', '5-2': 'medio', '5-1': 'medio',
        '4-5': 'alto', '4-4': 'alto', '4-3': 'medio', '4-2': 'medio', '4-1': 'medio',
        '3-5': 'alto', '3-4': 'medio', '3-3': 'medio', '3-2': 'medio', '3-1': 'bajo',
        '2-5': 'medio', '2-4': 'medio', '2-3': 'medio', '2-2': 'bajo', '2-1': 'bajo',
        '1-5': 'medio', '1-4': 'bajo', '1-3': 'bajo', '1-2': 'bajo', '1-1': 'bajo'
    },
    alertas: { dias_aviso_vencimiento: 7 },
    // Guía de gravedad por tipo de consecuencia: los mismos textos de la tabla de
    // gravedad del numeral 5.3, agrupados según lo que se afecta. Vacío = el manual
    // no lo describe para ese nivel.
    consecuencias: [
        { clave: 'personas', nombre: 'Personas', niveles: {
            1: 'Pocas consecuencias.',
            2: '',
            3: 'Lesiones a las personas.',
            4: 'Lesiones graves.',
            5: 'Varias muertes.' } },
        { clave: 'aeronave_equipo', nombre: 'Aeronave y equipo', niveles: {
            1: 'Pocas consecuencias.',
            2: '',
            3: '',
            4: 'Daños importantes al equipo.',
            5: 'Aeronave o equipo destruidos.' } },
        { clave: 'operacion', nombre: 'Operación y márgenes de seguridad', niveles: {
            1: 'Pocas consecuencias.',
            2: 'Molestias. Limitaciones operacionales. Uso de procedimientos de emergencia. Incidente leve.',
            3: 'Reducción importante de los márgenes de Seguridad Operacional, reducción en la capacidad del personal de operaciones para tolerar condiciones de operación adversas, como resultado de un aumento en la carga de trabajo o como resultado de condiciones que afecten su eficiencia. Incidente grave.',
            4: 'Gran reducción de los márgenes de Seguridad Operacional. Estrés físico o una carga de trabajo tal que ya no se pueda confiar en que el personal de operaciones realice sus tareas con precisión o por completo.',
            5: '' } }
    ]
});

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const CLAVE_RE = /^[a-z0-9_]{1,40}$/;

function copia(obj) { return JSON.parse(JSON.stringify(obj)); }

function texto(valor, max, campo) {
    const t = String(valor == null ? '' : valor).trim();
    if (!t) throw new Error(`El campo "${campo}" es obligatorio`);
    if (t.length > max) throw new Error(`El campo "${campo}" admite máximo ${max} caracteres`);
    return t;
}

/** Valida y normaliza una configuración de matriz. Lanza Error con un mensaje claro. */
function validarMatriz(entrada) {
    if (!entrada || typeof entrada !== 'object') throw new Error('Configuración de matriz inválida');

    const ejes = {};
    for (const eje of ['probabilidad', 'severidad']) {
        const lista = entrada[eje];
        if (!Array.isArray(lista) || lista.length !== 5) throw new Error(`La ${eje} debe tener exactamente 5 niveles`);
        const valores = lista.map(n => Number(n && n.valor)).sort();
        if (valores.join() !== '1,2,3,4,5') throw new Error(`Los valores de ${eje} deben ser 1, 2, 3, 4 y 5`);
        ejes[eje] = lista
            .map(n => ({
                valor: Number(n.valor),
                ...(eje === 'severidad' ? { codigo: texto(n.codigo, 3, 'código de severidad') } : {}),
                nombre: texto(n.nombre, 60, `nombre de ${eje}`),
                descripcion: String(n.descripcion || '').trim().slice(0, 500)
            }))
            .sort((a, b) => b.valor - a.valor);
    }

    const niveles = entrada.niveles;
    if (!Array.isArray(niveles) || niveles.length < 2 || niveles.length > 6) {
        throw new Error('Define entre 2 y 6 niveles de riesgo');
    }
    const claves = new Set();
    const nivelesOk = niveles.map(n => {
        const clave = String(n.clave || '').trim();
        if (!CLAVE_RE.test(clave)) throw new Error('Cada nivel necesita una clave en minúsculas (a-z, 0-9, _)');
        if (claves.has(clave)) throw new Error(`La clave de nivel "${clave}" está repetida`);
        claves.add(clave);
        if (!COLOR_RE.test(String(n.color || ''))) throw new Error(`El color del nivel "${clave}" debe tener el formato #RRGGBB`);
        let plazo = n.plazo_dias;
        if (plazo === '' || plazo === undefined) plazo = null;
        if (plazo !== null) {
            plazo = Number(plazo);
            if (!Number.isInteger(plazo) || plazo < 1 || plazo > 365) throw new Error(`El plazo del nivel "${clave}" debe ser de 1 a 365 días o quedar vacío`);
        }
        return {
            clave,
            nombre: texto(n.nombre, 60, 'nombre del nivel'),
            prioridad: texto(n.prioridad, 60, 'prioridad del nivel'),
            color: String(n.color).toUpperCase(),
            plazo_dias: plazo,
            es_alto: Boolean(n.es_alto)
        };
    });

    const celdas = {};
    for (let p = 1; p <= 5; p++) {
        for (let s = 1; s <= 5; s++) {
            const k = `${p}-${s}`;
            const nivel = entrada.celdas && entrada.celdas[k];
            if (!claves.has(nivel)) throw new Error(`La celda ${p}${codigoSeveridad(ejes.severidad, s)} no tiene un nivel válido`);
            celdas[k] = nivel;
        }
    }

    const dias = Number(entrada.alertas && entrada.alertas.dias_aviso_vencimiento);
    if (!Number.isInteger(dias) || dias < 1 || dias > 60) throw new Error('Los días de aviso de vencimiento deben estar entre 1 y 60');

    const consecuencias = validarConsecuencias(entrada.consecuencias);

    const v = entrada.validacion && typeof entrada.validacion === 'object' ? entrada.validacion : null;
    return {
        version: String(entrada.version || 'personalizada').slice(0, 40),
        validada: Boolean(entrada.validada),
        // Quién y cuándo la validó (lo fija el servidor) y el documento de aprobación
        validacion: entrada.validada && v ? {
            por: v.por ? String(v.por).slice(0, 200) : null,
            fecha: v.fecha ? String(v.fecha).slice(0, 40) : null,
            referencia: v.referencia ? String(v.referencia).trim().slice(0, 300) : null
        } : null,
        nota: String(entrada.nota || '').trim().slice(0, 500),
        probabilidad: ejes.probabilidad,
        severidad: ejes.severidad,
        niveles: nivelesOk,
        celdas,
        alertas: { dias_aviso_vencimiento: dias },
        consecuencias
    };
}

/**
 * Guía de severidad por tipo de consecuencia (opcional): hasta 12 tipos, cada
 * uno con una descripción para los valores de severidad 1 a 5.
 */
function validarConsecuencias(lista) {
    if (lista === undefined || lista === null) return [];
    if (!Array.isArray(lista)) throw new Error('Las consecuencias deben ser una lista');
    if (lista.length > 12) throw new Error('Define como máximo 12 tipos de consecuencia');
    const claves = new Set();
    return lista.map((c, i) => {
        const nombre = texto(c && c.nombre, 60, 'tipo de consecuencia');
        let clave = String((c && c.clave) || '').trim();
        if (!clave) {
            clave = sinAcentos(nombre.toLowerCase())
                .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `consecuencia_${i + 1}`;
        }
        if (!CLAVE_RE.test(clave)) throw new Error(`La clave del tipo de consecuencia "${nombre}" no es válida`);
        if (claves.has(clave)) throw new Error(`El tipo de consecuencia "${nombre}" está repetido`);
        claves.add(clave);
        const niveles = {};
        for (let s = 1; s <= 5; s++) {
            const d = String((c.niveles && c.niveles[s]) || '').trim();
            if (d.length > 500) throw new Error(`"${nombre}", severidad ${s}: máximo 500 caracteres`);
            niveles[s] = d;
        }
        return { clave, nombre, niveles };
    });
}

function codigoSeveridad(severidad, valor) {
    const s = (severidad || []).find(x => x.valor === valor);
    return s ? s.codigo : String(valor);
}

/** Clasifica una combinación probabilidad/severidad con la matriz dada. */
function clasificar(matriz, probabilidad, severidad) {
    const p = Number(probabilidad);
    const s = Number(severidad);
    if (!Number.isInteger(p) || p < 1 || p > 5) throw new Error('La probabilidad debe ser un valor de 1 a 5');
    if (!Number.isInteger(s) || s < 1 || s > 5) throw new Error('La severidad debe ser un valor de 1 a 5');
    const clave = matriz.celdas[`${p}-${s}`];
    const nivel = matriz.niveles.find(n => n.clave === clave);
    if (!nivel) throw new Error('La matriz configurada no clasifica esta combinación');
    return {
        probabilidad: p,
        severidad: s,
        indice: `${p}${codigoSeveridad(matriz.severidad, s)}`,
        nivel: nivel.clave,
        nivel_nombre: nivel.nombre,
        prioridad: nivel.prioridad,
        color: nivel.color,
        plazo_dias: nivel.plazo_dias,
        es_alto: nivel.es_alto
    };
}

/** Lee la matriz guardada; si no existe o es inválida, devuelve la de referencia. */
async function obtenerMatriz(db) {
    try {
        const [filas] = await db.query('SELECT valor FROM configuracion_sistema WHERE clave = ? LIMIT 1', [CLAVE_CONFIG]);
        if (filas.length && filas[0].valor) {
            const guardada = typeof filas[0].valor === 'string' ? JSON.parse(filas[0].valor) : filas[0].valor;
            return validarMatriz(guardada);
        }
    } catch (e) {
        console.error('Matriz de riesgo guardada inválida; se usa la de referencia:', e.message);
    }
    return copia(MATRIZ_REFERENCIA);
}

async function guardarMatriz(db, matriz) {
    const valida = validarMatriz(matriz);
    await db.query(
        `INSERT INTO configuracion_sistema (clave, valor, tipo, descripcion, editable, categoria)
         VALUES (?, ?, 'json', 'Matriz de riesgo operacional 5x5 (SMS)', 1, 'sms')
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [CLAVE_CONFIG, JSON.stringify(valida)]
    );
    return valida;
}

module.exports = {
    CLAVE_CONFIG,
    MATRIZ_REFERENCIA,
    validarMatriz,
    clasificar,
    codigoSeveridad,
    obtenerMatriz,
    guardarMatriz,
    copia
};
