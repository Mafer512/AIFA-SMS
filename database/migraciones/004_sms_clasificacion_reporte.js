/* ============================================================================
   Migración 004 · Clasificación del reporte y datos operacionales
   - reportes: tipo de reporte (condición insegura, acto inseguro, casi
     accidente, incidente, accidente, buena práctica), opinión de quien reporta
     (frecuencia y gravedad 1 a 5), sugerencia de prevención y datos
     operacionales opcionales (parte involucrada, vuelo, matrícula, posición y
     equipo de apoyo en tierra).
   - partes_involucradas: catálogo administrable de aerolíneas, prestadores de
     servicios y demás partes. Se siembra una lista inicial SOLO si está vacío;
     la Gerencia la revisa y ajusta en /admin/partes.
   - Matriz de riesgo: si la guardada no tiene descripciones de severidad por
     tipo de consecuencia y NO está validada, se le agregan las de referencia
     (siguen pendientes de validación). Una matriz validada no se toca.

   NO DESTRUCTIVA: solo agrega columnas, índices y una tabla nueva. Los
   reportes existentes quedan "sin clasificar". Se puede ejecutar más de una vez.
   Aplicar con:  npm run migrar
   ========================================================================= */
'use strict';

const riesgo = require('../../lib/sms/riesgo');

async function columnaExiste(conn, tabla, columna) {
    const [f] = await conn.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [tabla, columna]);
    return f.length > 0;
}

async function indiceExiste(conn, tabla, indice) {
    const [f] = await conn.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [tabla, indice]);
    return f.length > 0;
}

async function llaveExiste(conn, tabla, llave) {
    const [f] = await conn.query(
        `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`, [tabla, llave]);
    return f.length > 0;
}

// Lista inicial (editable). Nombres comerciales de uso común; la Gerencia
// confirma cuáles operan en el AIFA, agrega las que falten y desactiva las demás.
const PARTES_INICIALES = [
    ['AIFA (áreas y personal propios)', 'Operador del aeropuerto'],
    ['Aeroméxico', 'Aerolínea'],
    ['Viva Aerobus', 'Aerolínea'],
    ['Volaris', 'Aerolínea'],
    ['Mexicana de Aviación', 'Aerolínea'],
    ['Arajet', 'Aerolínea'],
    ['United Airlines', 'Aerolínea'],
    ['TAG Airlines', 'Aerolínea'],
    ['Air France', 'Aerolínea'],
    ['Emirates', 'Aerolínea'],
    ['Cathay Pacific', 'Aerolínea'],
    ['China Southern Airlines', 'Aerolínea'],
    ['Lufthansa Cargo', 'Aerolínea'],
    ['Air Canada Cargo', 'Aerolínea'],
    ['Atlas Air', 'Aerolínea'],
    ['Kalitta Air', 'Aerolínea'],
    ['National Airlines', 'Aerolínea'],
    ['Silk Way West Airlines', 'Aerolínea'],
    ['Amerijet', 'Aerolínea'],
    ['Cargolux', 'Aerolínea'],
    ['LATAM Cargo', 'Aerolínea'],
    ['FedEx', 'Aerolínea'],
    ['UPS', 'Aerolínea'],
    ['DHL', 'Aerolínea'],
    ['PrimeFlight México', 'Prestador de servicios'],
    ['Menzies', 'Prestador de servicios'],
    ['Swissport', 'Prestador de servicios'],
    ['Talma', 'Prestador de servicios'],
    ['AAACESA', 'Prestador de servicios'],
    ['ASA (combustibles)', 'Prestador de servicios']
];

module.exports = async function migracion004(conn) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS partes_involucradas (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            nombre          VARCHAR(120) NOT NULL,
            tipo            VARCHAR(40) NOT NULL,
            activo          TINYINT(1) NOT NULL DEFAULT 1,
            orden           INT NOT NULL DEFAULT 100,
            creado_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_parte_nombre (nombre)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Aerolíneas, prestadores de servicios y otras partes involucradas en los reportes'`);

    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM partes_involucradas');
    if (Number(n) === 0) {
        await conn.query('INSERT INTO partes_involucradas (nombre, tipo, orden) VALUES ?',
            [PARTES_INICIALES.map(([nombre, tipo], i) => [nombre, tipo, i === 0 ? 10 : 100])]);
    }

    const columnas = [
        ['tipo_reporte', "VARCHAR(30) NULL COMMENT 'condicion_insegura, acto_inseguro, casi_accidente, incidente, accidente, buena_practica' AFTER tipo_problema_otro"],
        ['percepcion_probabilidad', "TINYINT UNSIGNED NULL COMMENT 'Opinión de quien reporta: frecuencia 1 a 5' AFTER descripcion"],
        ['percepcion_severidad', "TINYINT UNSIGNED NULL COMMENT 'Opinión de quien reporta: gravedad 1 a 5' AFTER percepcion_probabilidad"],
        ['sugerencia_prevencion', "TEXT NULL COMMENT 'Qué propone quien reporta para prevenirlo' AFTER percepcion_severidad"],
        ['id_parte_involucrada', 'INT NULL AFTER sugerencia_prevencion'],
        ['parte_involucrada_otra', "VARCHAR(150) NULL COMMENT 'Parte que no está en el catálogo' AFTER id_parte_involucrada"],
        ['vuelo', 'VARCHAR(10) NULL AFTER parte_involucrada_otra'],
        ['matricula', 'VARCHAR(12) NULL AFTER vuelo'],
        ['posicion', 'VARCHAR(20) NULL AFTER matricula'],
        ['gse_tipo', "VARCHAR(80) NULL COMMENT 'Equipo de apoyo en tierra involucrado' AFTER posicion"],
        ['gse_numero', "VARCHAR(30) NULL COMMENT 'Número económico del equipo' AFTER gse_tipo"]
    ];
    for (const [columna, definicion] of columnas) {
        if (!(await columnaExiste(conn, 'reportes', columna))) {
            await conn.query(`ALTER TABLE reportes ADD COLUMN ${columna} ${definicion}`);
        }
    }
    if (!(await indiceExiste(conn, 'reportes', 'idx_tipo_reporte'))) {
        await conn.query('ALTER TABLE reportes ADD KEY idx_tipo_reporte (tipo_reporte)');
    }
    if (!(await llaveExiste(conn, 'reportes', 'fk_reportes_parte'))) {
        await conn.query(`ALTER TABLE reportes ADD CONSTRAINT fk_reportes_parte
            FOREIGN KEY (id_parte_involucrada) REFERENCES partes_involucradas (id) ON DELETE SET NULL`);
    }

    // Descripciones de severidad por tipo de consecuencia (solo matriz sin validar)
    const [cfg] = await conn.query('SELECT valor FROM configuracion_sistema WHERE clave = ? LIMIT 1', [riesgo.CLAVE_CONFIG]);
    if (cfg.length && cfg[0].valor) {
        let guardada = null;
        try { guardada = typeof cfg[0].valor === 'string' ? JSON.parse(cfg[0].valor) : cfg[0].valor; } catch (e) { guardada = null; }
        if (guardada && !guardada.validada && !(Array.isArray(guardada.consecuencias) && guardada.consecuencias.length)) {
            await riesgo.guardarMatriz(conn, { ...guardada, consecuencias: riesgo.copia(riesgo.MATRIZ_REFERENCIA.consecuencias) });
        }
    }
};
