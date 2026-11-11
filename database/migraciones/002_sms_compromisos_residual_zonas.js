/* ============================================================================
   Migración 002 · Módulo SMS
   - reporte_compromiso: responsable y fecha compromiso de atención de cada
     reporte (con historial; el vigente es el más reciente).
   - reporte_evaluacion_riesgo: tipo de evaluación (inicial / residual) y
     medidas de mitigación.
   - zonas_aeropuerto y reporte_zona: módulo opcional de ubicación por zonas
     autorizadas.

   NO DESTRUCTIVA: solo crea tablas nuevas y agrega columnas/índices si no
   existen. No modifica ni elimina datos. Se puede ejecutar más de una vez.
   Aplicar con:  npm run migrar
   ========================================================================= */
'use strict';

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

module.exports = async function migracion002(conn) {
    // Compromiso de atención del reporte (responsable + fecha)
    await conn.query(`
        CREATE TABLE IF NOT EXISTS reporte_compromiso (
            id                           INT AUTO_INCREMENT PRIMARY KEY,
            id_reporte                   INT NOT NULL,
            id_departamento_responsable  INT NULL,
            responsable_nombre           VARCHAR(200) NULL COMMENT 'Persona responsable (texto libre)',
            fecha_compromiso             DATE NOT NULL,
            motivo                       TEXT NULL COMMENT 'Obligatorio al reprogramar',
            creado_por                   INT NULL,
            creado_por_nombre            VARCHAR(200) NULL,
            creado_en                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_rc_reporte (id_reporte, creado_en),
            KEY idx_rc_depto (id_departamento_responsable),
            CONSTRAINT fk_rc_reporte FOREIGN KEY (id_reporte) REFERENCES reportes (id) ON DELETE CASCADE,
            CONSTRAINT fk_rc_depto FOREIGN KEY (id_departamento_responsable) REFERENCES departamentos (id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // Riesgo inicial / residual y medidas de mitigación
    if (!(await columnaExiste(conn, 'reporte_evaluacion_riesgo', 'tipo'))) {
        await conn.query(`ALTER TABLE reporte_evaluacion_riesgo
            ADD COLUMN tipo ENUM('inicial','residual') NOT NULL DEFAULT 'inicial'
            COMMENT 'inicial: peligro identificado · residual: tras las medidas de mitigación' AFTER id_reporte`);
    }
    if (!(await columnaExiste(conn, 'reporte_evaluacion_riesgo', 'medidas_mitigacion'))) {
        await conn.query(`ALTER TABLE reporte_evaluacion_riesgo
            ADD COLUMN medidas_mitigacion TEXT NULL COMMENT 'Medidas aplicadas (obligatorio en la evaluación residual)' AFTER justificacion`);
    }
    if (!(await indiceExiste(conn, 'reporte_evaluacion_riesgo', 'idx_rer_tipo'))) {
        await conn.query('ALTER TABLE reporte_evaluacion_riesgo ADD KEY idx_rer_tipo (id_reporte, tipo, fecha)');
    }

    // Zonas autorizadas del aeropuerto (catálogo administrado; sin datos precargados)
    await conn.query(`
        CREATE TABLE IF NOT EXISTS zonas_aeropuerto (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            codigo          VARCHAR(30) NOT NULL,
            nombre          VARCHAR(120) NOT NULL,
            tipo            VARCHAR(40) NULL,
            descripcion     VARCHAR(300) NULL,
            activo          TINYINT(1) NOT NULL DEFAULT 1,
            orden           INT NOT NULL DEFAULT 100,
            creado_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_zona_codigo (codigo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // Zona asignada a cada reporte (una por reporte)
    await conn.query(`
        CREATE TABLE IF NOT EXISTS reporte_zona (
            id_reporte           INT NOT NULL PRIMARY KEY,
            id_zona              INT NOT NULL,
            nota                 VARCHAR(300) NULL,
            asignado_por         INT NULL,
            asignado_por_nombre  VARCHAR(200) NULL,
            asignado_en          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_rz_zona (id_zona),
            CONSTRAINT fk_rz_reporte FOREIGN KEY (id_reporte) REFERENCES reportes (id) ON DELETE CASCADE,
            CONSTRAINT fk_rz_zona FOREIGN KEY (id_zona) REFERENCES zonas_aeropuerto (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
};
