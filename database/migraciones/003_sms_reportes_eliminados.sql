-- ============================================================================
-- Migración 003 · Archivo de reportes eliminados
--
-- Antes de eliminar un reporte se guarda aquí una copia completa (el reporte
-- y todo lo asociado: áreas, seguimientos, evidencias, ubicación, acciones,
-- riesgo, compromisos y zona) para poder restaurarlo y conservar la
-- trazabilidad. El folio de un reporte eliminado no se vuelve a asignar.
--
-- NO DESTRUCTIVA: solo crea una tabla nueva (IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS reportes_eliminados (
    id                     INT AUTO_INCREMENT PRIMARY KEY,
    id_reporte             INT NOT NULL COMMENT 'id original (no se reutiliza)',
    folio                  VARCHAR(50) NOT NULL,
    tipo_problema          VARCHAR(150) NULL,
    fecha_reporte          TIMESTAMP NULL,
    estado                 CHAR(1) NULL COMMENT 'Estatus vigente al eliminar',
    resumen                JSON NULL COMMENT 'Conteo de registros incluidos en la copia',
    datos                  LONGTEXT NOT NULL COMMENT 'Copia completa en JSON',
    motivo                 VARCHAR(1000) NOT NULL,
    eliminado_por          INT NULL,
    eliminado_por_nombre   VARCHAR(200) NULL,
    eliminado_en           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    restaurado_por         INT NULL,
    restaurado_por_nombre  VARCHAR(200) NULL,
    restaurado_en          TIMESTAMP NULL,
    KEY idx_re_folio (folio),
    KEY idx_re_reporte (id_reporte),
    KEY idx_re_fecha (eliminado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
