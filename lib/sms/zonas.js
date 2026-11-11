/* ============================================================================
   Módulo opcional: ubicación de hallazgos por zonas autorizadas del aeropuerto.
   - Se habilita desde configuración (sms_zonas.habilitado). Apagado por defecto.
   - El catálogo de zonas lo captura un administrador; no hay zonas precargadas.
   - Las zonas no se eliminan: se desactivan (conservan el historial).
   ========================================================================= */
'use strict';

const CLAVE_CONFIG = 'sms_zonas';
const TIPOS = ['Plataforma', 'Pista', 'Calle de rodaje', 'Edificio terminal', 'Estacionamiento', 'Vialidad', 'Área de servicio', 'Otra'];

async function obtenerConfig(db) {
    try {
        const [f] = await db.query('SELECT valor FROM configuracion_sistema WHERE clave = ? LIMIT 1', [CLAVE_CONFIG]);
        if (f.length && f[0].valor) {
            const v = typeof f[0].valor === 'string' ? JSON.parse(f[0].valor) : f[0].valor;
            return { habilitado: Boolean(v.habilitado) };
        }
    } catch (e) {
        console.error('Configuración de zonas inválida:', e.message);
    }
    return { habilitado: false };
}

async function guardarConfig(db, { habilitado }) {
    const cfg = { habilitado: Boolean(habilitado) };
    await db.query(
        `INSERT INTO configuracion_sistema (clave, valor, tipo, descripcion, editable, categoria)
         VALUES (?, ?, 'json', 'Módulo de ubicación por zonas autorizadas (SMS)', 1, 'sms')
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [CLAVE_CONFIG, JSON.stringify(cfg)]
    );
    return cfg;
}

async function listar(db, { soloActivas = false } = {}) {
    const [filas] = await db.query(
        `SELECT z.id, z.codigo, z.nombre, z.tipo, z.descripcion, z.activo, z.orden,
                (SELECT COUNT(*) FROM reporte_zona rz WHERE rz.id_zona = z.id) AS reportes
         FROM zonas_aeropuerto z
         ${soloActivas ? 'WHERE z.activo = 1' : ''}
         ORDER BY z.activo DESC, z.orden, z.nombre`);
    return filas.map(z => ({ ...z, activo: Boolean(z.activo), reportes: Number(z.reportes) }));
}

/** Valida los datos de una zona. Lanza Error con un mensaje claro. */
function validarZona(b = {}) {
    const codigo = String(b.codigo || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(codigo)) throw new Error('El código admite de 1 a 30 caracteres: letras, números, guion y guion bajo');
    const nombre = String(b.nombre || '').trim();
    if (nombre.length < 2 || nombre.length > 120) throw new Error('El nombre debe tener entre 2 y 120 caracteres');
    const tipo = String(b.tipo || '').trim();
    if (tipo && !TIPOS.includes(tipo)) throw new Error('Tipo de zona no válido');
    const orden = b.orden === undefined || b.orden === '' ? 100 : Number(b.orden);
    if (!Number.isInteger(orden) || orden < 0 || orden > 9999) throw new Error('El orden debe ser un número entero entre 0 y 9999');
    return {
        codigo,
        nombre,
        tipo: tipo || null,
        descripcion: String(b.descripcion || '').trim().slice(0, 300) || null,
        activo: b.activo === undefined ? true : Boolean(b.activo),
        orden
    };
}

module.exports = { CLAVE_CONFIG, TIPOS, obtenerConfig, guardarConfig, listar, validarZona };
