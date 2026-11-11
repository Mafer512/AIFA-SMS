-- ============================================================================
-- Migración 001 · Módulo SMS: evaluación de riesgo, acciones correctivas y
-- notificaciones.
--
-- NO DESTRUCTIVA: solo crea tablas nuevas (IF NOT EXISTS). No modifica ni
-- elimina tablas o columnas existentes. Se puede ejecutar más de una vez.
-- Aplicar con:  node scripts/migrar.js
-- ============================================================================

-- Evaluaciones de riesgo de cada reporte (se conserva el historial;
-- la evaluación vigente es la más reciente).
CREATE TABLE IF NOT EXISTS reporte_evaluacion_riesgo (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    id_reporte            INT NOT NULL,
    probabilidad          TINYINT UNSIGNED NOT NULL COMMENT '1 a 5',
    severidad             TINYINT UNSIGNED NOT NULL COMMENT '1 a 5 (5 = más grave)',
    indice                VARCHAR(10) NOT NULL COMMENT 'Código de celda, p. ej. 4B',
    nivel                 VARCHAR(40) NOT NULL COMMENT 'Clave del nivel según la matriz configurada',
    nivel_nombre          VARCHAR(80) NOT NULL,
    prioridad             VARCHAR(80) NULL,
    plazo_dias            SMALLINT UNSIGNED NULL,
    fecha_limite          DATE NULL COMMENT 'Solo si el nivel tiene plazo configurado',
    justificacion         TEXT NULL,
    version_matriz        VARCHAR(40) NULL,
    evaluado_por          INT NULL,
    evaluado_por_nombre   VARCHAR(200) NULL,
    fecha                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_rer_reporte (id_reporte, fecha),
    KEY idx_rer_nivel (nivel),
    CONSTRAINT fk_rer_reporte FOREIGN KEY (id_reporte) REFERENCES reportes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Acciones correctivas y preventivas
CREATE TABLE IF NOT EXISTS acciones_correctivas (
    id                           INT AUTO_INCREMENT PRIMARY KEY,
    id_reporte                   INT NOT NULL,
    tipo                         ENUM('correctiva','preventiva') NOT NULL DEFAULT 'correctiva',
    descripcion                  TEXT NOT NULL,
    id_departamento_responsable  INT NULL,
    responsable_nombre           VARCHAR(200) NULL COMMENT 'Persona responsable (texto libre)',
    fecha_asignacion             DATE NOT NULL,
    fecha_compromiso             DATE NOT NULL,
    estado                       ENUM('pendiente','en_proceso','completada','verificada','cancelada') NOT NULL DEFAULT 'pendiente',
    efectividad                  ENUM('sin_verificar','efectiva','no_efectiva') NOT NULL DEFAULT 'sin_verificar',
    observaciones                TEXT NULL,
    verificacion_comentario      TEXT NULL,
    verificado_por               INT NULL,
    verificado_por_nombre        VARCHAR(200) NULL,
    fecha_verificacion           TIMESTAMP NULL,
    fecha_cumplimiento           TIMESTAMP NULL,
    creado_por                   INT NULL,
    creado_por_nombre            VARCHAR(200) NULL,
    creado_en                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_ac_reporte (id_reporte, estado),
    KEY idx_ac_compromiso (estado, fecha_compromiso),
    KEY idx_ac_depto (id_departamento_responsable),
    CONSTRAINT fk_ac_reporte FOREIGN KEY (id_reporte) REFERENCES reportes (id) ON DELETE CASCADE,
    CONSTRAINT fk_ac_depto FOREIGN KEY (id_departamento_responsable) REFERENCES departamentos (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Evidencia de las acciones (imágenes)
CREATE TABLE IF NOT EXISTS acciones_correctivas_archivos (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    id_accion         INT NOT NULL,
    ruta_original     VARCHAR(500) NULL,
    ruta_thumbnail    VARCHAR(500) NULL,
    ruta_optimizada   VARCHAR(500) NULL,
    nombre_original   VARCHAR(255) NULL,
    mime_type         VARCHAR(100) NULL,
    tamano_bytes      BIGINT UNSIGNED NULL,
    subido_por        INT NULL,
    fecha_subida      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_aca_accion (id_accion),
    CONSTRAINT fk_aca_accion FOREIGN KEY (id_accion) REFERENCES acciones_correctivas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notificaciones de eventos (nuevos reportes, asignaciones, actualizaciones…).
-- id_departamento_destino NULL = solo supervisión (admin y supervisor).
CREATE TABLE IF NOT EXISTS notificaciones (
    id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
    tipo                     VARCHAR(40) NOT NULL,
    titulo                   VARCHAR(200) NOT NULL,
    mensaje                  VARCHAR(500) NULL,
    id_reporte               INT NULL,
    folio                    VARCHAR(50) NULL,
    id_departamento_destino  INT NULL,
    creado_en                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_not_destino (id_departamento_destino, creado_en),
    KEY idx_not_fecha (creado_en),
    CONSTRAINT fk_not_reporte FOREIGN KEY (id_reporte) REFERENCES reportes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notificaciones_lectura (
    id_notificacion  BIGINT NOT NULL,
    id_usuario       INT NOT NULL,
    leida_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_notificacion, id_usuario),
    CONSTRAINT fk_nl_notificacion FOREIGN KEY (id_notificacion) REFERENCES notificaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
