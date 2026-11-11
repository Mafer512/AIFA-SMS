-- S.A.G.A. · Estructura de la base de datos y catálogos.
-- Sin reportes, usuarios, seguimientos ni bitácora; los teléfonos y correos de las áreas van vacíos.
-- Para instalar desde cero: crear la base, importar este archivo y ejecutar  npm run migrar
-- Generado el 2026-11-09.


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `acciones_correctivas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `acciones_correctivas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL,
  `tipo` enum('correctiva','preventiva') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'correctiva',
  `descripcion` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_departamento_responsable` int DEFAULT NULL,
  `responsable_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Persona responsable (texto libre)',
  `fecha_asignacion` date NOT NULL,
  `fecha_compromiso` date NOT NULL,
  `estado` enum('pendiente','en_proceso','completada','verificada','cancelada') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  `efectividad` enum('sin_verificar','efectiva','no_efectiva') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sin_verificar',
  `observaciones` text COLLATE utf8mb4_unicode_ci,
  `verificacion_comentario` text COLLATE utf8mb4_unicode_ci,
  `verificado_por` int DEFAULT NULL,
  `verificado_por_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_verificacion` timestamp NULL DEFAULT NULL,
  `fecha_cumplimiento` timestamp NULL DEFAULT NULL,
  `creado_por` int DEFAULT NULL,
  `creado_por_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ac_reporte` (`id_reporte`,`estado`),
  KEY `idx_ac_compromiso` (`estado`,`fecha_compromiso`),
  KEY `idx_ac_depto` (`id_departamento_responsable`),
  CONSTRAINT `fk_ac_depto` FOREIGN KEY (`id_departamento_responsable`) REFERENCES `departamentos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ac_reporte` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `acciones_correctivas_archivos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `acciones_correctivas_archivos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_accion` int NOT NULL,
  `ruta_original` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ruta_thumbnail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ruta_optimizada` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nombre_original` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tamano_bytes` bigint unsigned DEFAULT NULL,
  `subido_por` int DEFAULT NULL,
  `fecha_subida` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aca_accion` (`id_accion`),
  CONSTRAINT `fk_aca_accion` FOREIGN KEY (`id_accion`) REFERENCES `acciones_correctivas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `configuracion_sistema`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuracion_sistema` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clave` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `valor` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `tipo` enum('string','number','boolean','json') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'string',
  `descripcion` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `editable` tinyint(1) DEFAULT '1',
  `categoria` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clave` (`clave`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `departamentos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `departamentos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `correo` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `descripcion` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activo` tinyint(1) DEFAULT '1',
  `icono` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `color` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `orden_display` int DEFAULT '100',
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `idx_codigo` (`codigo`),
  KEY `idx_activo` (`activo`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `logs_sistema`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `logs_sistema` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `nivel` enum('debug','info','warning','error','critical') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'info',
  `categoria` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accion` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `datos_adicionales` json DEFAULT NULL,
  `id_usuario` int DEFAULT NULL,
  `id_reporte` int DEFAULT NULL,
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `fecha` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nivel` (`nivel`),
  KEY `idx_categoria` (`categoria`),
  KEY `idx_fecha` (`fecha`),
  KEY `idx_usuario` (`id_usuario`),
  KEY `idx_reporte` (`id_reporte`)
) ENGINE=InnoDB AUTO_INCREMENT=93 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `migraciones_aplicadas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migraciones_aplicadas` (
  `archivo` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `aplicada_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`archivo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `notificaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notificaciones` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tipo` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `titulo` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mensaje` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `id_reporte` int DEFAULT NULL,
  `folio` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `id_departamento_destino` int DEFAULT NULL,
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_not_destino` (`id_departamento_destino`,`creado_en`),
  KEY `idx_not_fecha` (`creado_en`),
  KEY `fk_not_reporte` (`id_reporte`),
  CONSTRAINT `fk_not_reporte` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `notificaciones_lectura`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notificaciones_lectura` (
  `id_notificacion` bigint NOT NULL,
  `id_usuario` int NOT NULL,
  `leida_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_notificacion`,`id_usuario`),
  CONSTRAINT `fk_nl_notificacion` FOREIGN KEY (`id_notificacion`) REFERENCES `notificaciones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reporte_compromiso`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reporte_compromiso` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL,
  `id_departamento_responsable` int DEFAULT NULL,
  `responsable_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Persona responsable (texto libre)',
  `fecha_compromiso` date NOT NULL,
  `motivo` text COLLATE utf8mb4_unicode_ci COMMENT 'Obligatorio al reprogramar',
  `creado_por` int DEFAULT NULL,
  `creado_por_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rc_reporte` (`id_reporte`,`creado_en`),
  KEY `idx_rc_depto` (`id_departamento_responsable`),
  CONSTRAINT `fk_rc_depto` FOREIGN KEY (`id_departamento_responsable`) REFERENCES `departamentos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rc_reporte` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reporte_departamento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reporte_departamento` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL,
  `id_departamento` int NOT NULL,
  `es_responsable` tinyint(1) DEFAULT '0' COMMENT 'TRUE si el departamento es responsable del reporte',
  `notificado` tinyint(1) DEFAULT '0',
  `fecha_notificacion` timestamp NULL DEFAULT NULL,
  `metodo_notificacion` enum('whatsapp','email','app','sms') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'whatsapp',
  `mensaje_enviado` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `respuesta_recibida` tinyint(1) DEFAULT '0',
  `fecha_respuesta` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reporte_departamento` (`id_reporte`,`id_departamento`),
  KEY `idx_notificado` (`notificado`),
  KEY `idx_reporte` (`id_reporte`),
  KEY `idx_departamento` (`id_departamento`),
  CONSTRAINT `reporte_departamento_ibfk_1` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reporte_departamento_ibfk_2` FOREIGN KEY (`id_departamento`) REFERENCES `departamentos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=108 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reporte_evaluacion_riesgo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reporte_evaluacion_riesgo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL,
  `tipo` enum('inicial','residual') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'inicial' COMMENT 'inicial: peligro identificado · residual: tras las medidas de mitigación',
  `probabilidad` tinyint unsigned NOT NULL COMMENT '1 a 5',
  `severidad` tinyint unsigned NOT NULL COMMENT '1 a 5 (5 = más grave)',
  `indice` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Código de celda, p. ej. 4B',
  `nivel` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Clave del nivel según la matriz configurada',
  `nivel_nombre` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prioridad` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `plazo_dias` smallint unsigned DEFAULT NULL,
  `fecha_limite` date DEFAULT NULL COMMENT 'Solo si el nivel tiene plazo configurado',
  `justificacion` text COLLATE utf8mb4_unicode_ci,
  `medidas_mitigacion` text COLLATE utf8mb4_unicode_ci COMMENT 'Medidas aplicadas (obligatorio en la evaluación residual)',
  `version_matriz` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evaluado_por` int DEFAULT NULL,
  `evaluado_por_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rer_reporte` (`id_reporte`,`fecha`),
  KEY `idx_rer_nivel` (`nivel`),
  KEY `idx_rer_tipo` (`id_reporte`,`tipo`,`fecha`),
  CONSTRAINT `fk_rer_reporte` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reporte_zona`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reporte_zona` (
  `id_reporte` int NOT NULL,
  `id_zona` int NOT NULL,
  `nota` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `asignado_por` int DEFAULT NULL,
  `asignado_por_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `asignado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_reporte`),
  KEY `idx_rz_zona` (`id_zona`),
  CONSTRAINT `fk_rz_reporte` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rz_zona` FOREIGN KEY (`id_zona`) REFERENCES `zonas_aeropuerto` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reportes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reportes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_tipo_problema` int DEFAULT NULL,
  `folio` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `hora` time NOT NULL DEFAULT (curtime()),
  `nombre` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `area` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cargo` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tipo_problema` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo_problema_otro` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lugar` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `creado_por` int DEFAULT NULL,
  `estado` enum('A','B','C','D','E','F') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'A',
  `prioridad` enum('baja','media','alta','critica') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'media',
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `folio` (`folio`),
  KEY `idx_folio` (`folio`),
  KEY `idx_fecha` (`fecha`),
  KEY `idx_estado` (`estado`),
  KEY `idx_id_tipo_problema` (`id_tipo_problema`),
  FULLTEXT KEY `descripcion` (`descripcion`),
  FULLTEXT KEY `lugar` (`lugar`),
  CONSTRAINT `fk_reportes_tipo_problema` FOREIGN KEY (`id_tipo_problema`) REFERENCES `tipos_problemas` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=85 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017*/ /*!50003 TRIGGER `log_cambios_reporte` AFTER UPDATE ON `reportes` FOR EACH ROW BEGIN
    IF OLD.estado != NEW.estado THEN
        INSERT INTO logs_sistema (nivel, categoria, accion, descripcion, datos_adicionales, id_reporte)
        VALUES ('info', 'reportes', 'cambio_estado', 
                CONCAT('Estado cambiado de ', OLD.estado, ' a ', NEW.estado),
                JSON_OBJECT('estado_anterior', OLD.estado, 'estado_nuevo', NEW.estado),
                NEW.id);
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `reportes_archivos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reportes_archivos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL,
  `public_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `secure_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `thumbnail_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `optimized_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `nombre_original` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ruta_original` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ruta relativa de la imagen original',
  `ruta_thumbnail` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ruta relativa del thumbnail',
  `ruta_optimizada` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ruta relativa de la versión optimizada',
  `tipo_archivo` enum('image','video','document') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `formato` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mime_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tamaño_bytes` bigint DEFAULT NULL,
  `ancho_pixels` int DEFAULT NULL,
  `alto_pixels` int DEFAULT NULL,
  `duracion_segundos` decimal(10,2) DEFAULT NULL,
  `orden_display` tinyint DEFAULT '1',
  `es_thumbnail_principal` tinyint(1) DEFAULT '0',
  `descripcion_archivo` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` enum('uploading','processing','completed','failed','deleted') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'uploading',
  `cloudinary_version` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `etag` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transformation_data` json DEFAULT NULL,
  `fecha_subida` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_eliminacion` timestamp NULL DEFAULT NULL,
  `eliminado_por` int DEFAULT NULL,
  `tamano_bytes` bigint unsigned DEFAULT NULL COMMENT 'Tamaño del archivo en bytes',
  PRIMARY KEY (`id`),
  UNIQUE KEY `public_id` (`public_id`),
  KEY `idx_reporte` (`id_reporte`),
  KEY `idx_estado` (`estado`),
  KEY `idx_tipo` (`tipo_archivo`),
  CONSTRAINT `reportes_archivos_ibfk_1` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reportes_backup_pre_migracion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reportes_backup_pre_migracion` (
  `id` int NOT NULL DEFAULT '0',
  `folio` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `hora` time NOT NULL DEFAULT (curtime()),
  `nombre` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cargo` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tipo_problema` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo_problema_otro` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lugar` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `creado_por` int DEFAULT NULL,
  `estado` enum('nuevo','notificado','en_proceso','resuelto') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'nuevo',
  `prioridad` enum('baja','media','alta','critica') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'media',
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reportes_eliminados`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reportes_eliminados` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL COMMENT 'id original (no se reutiliza)',
  `folio` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo_problema` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_reporte` timestamp NULL DEFAULT NULL,
  `estado` char(1) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Estatus vigente al eliminar',
  `resumen` json DEFAULT NULL COMMENT 'Conteo de registros incluidos en la copia',
  `datos` longtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Copia completa en JSON',
  `motivo` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `eliminado_por` int DEFAULT NULL,
  `eliminado_por_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `eliminado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `restaurado_por` int DEFAULT NULL,
  `restaurado_por_nombre` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `restaurado_en` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_re_folio` (`folio`),
  KEY `idx_re_reporte` (`id_reporte`),
  KEY `idx_re_fecha` (`eliminado_en`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `seguimiento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `seguimiento` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL,
  `folio_seguimiento` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_departamento` int DEFAULT NULL,
  `id_usuario` int DEFAULT NULL,
  `fecha` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_evento` timestamp NULL DEFAULT NULL COMMENT 'Fecha en que realmente ocurrió la acción reportada',
  `hora` time NOT NULL DEFAULT (curtime()),
  `tipo_accion` enum('visualizado','asignado','en_revision','accion_tomada','escalado','resuelto','reabierto','comentario') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `archivos_adjuntos` json DEFAULT NULL,
  `visibilidad` enum('publico','interno','privado') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'publico',
  `requiere_respuesta` tinyint(1) DEFAULT '0',
  `fecha_limite_respuesta` timestamp NULL DEFAULT NULL,
  `creado_por` int DEFAULT NULL,
  `estado` enum('A','B','C','D','E','F') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'A' COMMENT 'A=generado, B=enterado, C=en atencion, D=resuelto, E=duplicado, F=no requiere atencion',
  `numero_secuencial_estado` int unsigned DEFAULT '1' COMMENT 'Número secuencial dentro del mismo estado',
  `tiempo_respuesta_minutos` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_folio_seguimiento` (`folio_seguimiento`),
  KEY `idx_reporte` (`id_reporte`),
  KEY `idx_departamento` (`id_departamento`),
  KEY `idx_tipo_accion` (`tipo_accion`),
  KEY `idx_fecha` (`fecha`),
  KEY `idx_seguimiento_reporte_estado` (`id_reporte`,`estado`,`fecha`),
  FULLTEXT KEY `descripcion` (`descripcion`),
  CONSTRAINT `seguimiento_ibfk_1` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `seguimiento_ibfk_2` FOREIGN KEY (`id_departamento`) REFERENCES `departamentos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=84 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `seguimiento_archivos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `seguimiento_archivos` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `id_seguimiento` int NOT NULL COMMENT 'ID del seguimiento al que pertenece',
  `ruta_original` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ruta de imagen original',
  `ruta_thumbnail` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ruta del thumbnail 200x200',
  `ruta_optimizada` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ruta de version optimizada 800px',
  `nombre_original` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Nombre original del archivo',
  `tipo_archivo` enum('image') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'image' COMMENT 'Tipo de archivo',
  `mime_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tipo MIME',
  `tamano_bytes` bigint unsigned DEFAULT NULL COMMENT 'Tamano en bytes',
  `ancho_pixels` int unsigned DEFAULT NULL COMMENT 'Ancho en pixeles',
  `alto_pixels` int unsigned DEFAULT NULL COMMENT 'Alto en pixeles',
  `orden_display` tinyint unsigned DEFAULT '1' COMMENT 'Orden de visualizacion',
  `estado` enum('uploading','processing','completed','failed','deleted') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'completed' COMMENT 'Estado del archivo',
  `fecha_subida` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de subida',
  `fecha_eliminacion` timestamp NULL DEFAULT NULL COMMENT 'Fecha de eliminacion',
  PRIMARY KEY (`id`),
  KEY `idx_seguimiento` (`id_seguimiento`),
  KEY `idx_estado` (`estado`),
  KEY `idx_orden` (`id_seguimiento`,`orden_display`),
  CONSTRAINT `fk_seguimiento_archivos_seguimiento` FOREIGN KEY (`id_seguimiento`) REFERENCES `seguimiento` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Almacena archivos multimedia de los seguimientos';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sesiones_usuario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sesiones_usuario` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_usuario` int NOT NULL,
  `token_sesion` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `fecha_inicio` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_ultimo_uso` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `fecha_expiracion` timestamp NOT NULL,
  `activa` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_sesion` (`token_sesion`),
  KEY `idx_token` (`token_sesion`),
  KEY `idx_usuario` (`id_usuario`),
  KEY `idx_activa` (`activa`),
  CONSTRAINT `sesiones_usuario_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios_departamento` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tipo_problema_departamentos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tipo_problema_departamentos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tipo_problema` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `codigo_departamento` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `es_responsable` tinyint(1) DEFAULT '0' COMMENT 'TRUE si el departamento puede dar seguimiento',
  `recibe_notificacion` tinyint(1) DEFAULT '0' COMMENT 'TRUE si el departamento recibe notificaciones',
  `activo` tinyint(1) DEFAULT '1',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_tipo_dept` (`tipo_problema`,`codigo_departamento`),
  KEY `idx_tipo_problema` (`tipo_problema`),
  KEY `idx_departamento` (`codigo_departamento`),
  KEY `idx_responsable` (`es_responsable`),
  CONSTRAINT `tipo_problema_departamentos_ibfk_1` FOREIGN KEY (`codigo_departamento`) REFERENCES `departamentos` (`codigo`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Define qué departamentos son responsables o notificados por tipo de problema';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tipos_problemas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tipos_problemas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activo` tinyint(1) DEFAULT '1',
  `orden_display` int DEFAULT '0',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`),
  KEY `idx_activo` (`activo`),
  KEY `idx_codigo` (`codigo`)
) ENGINE=InnoDB AUTO_INCREMENT=64 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ubicaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ubicaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reporte` int NOT NULL,
  `latitud` decimal(10,8) NOT NULL,
  `longitud` decimal(11,8) NOT NULL,
  `precision_metros` decimal(8,2) DEFAULT NULL,
  `accuracy_level` enum('high','medium','low','unknown') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'unknown',
  `altitud` decimal(8,2) DEFAULT NULL,
  `velocidad` decimal(6,2) DEFAULT NULL,
  `direccion` decimal(5,2) DEFAULT NULL,
  `timestamp_ubicacion` timestamp NOT NULL,
  `metodo_obtencion` enum('gps','network','fused','manual','ip') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'gps',
  `proveedor` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dentro_geofence` tinyint(1) DEFAULT '0',
  `nombre_geofence` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `distancia_geofence` decimal(8,2) DEFAULT NULL,
  `validado_manualmente` tinyint(1) DEFAULT '0',
  `direccion_texto` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `punto_referencia` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id_reporte` (`id_reporte`),
  KEY `idx_coordenadas` (`latitud`,`longitud`),
  KEY `idx_geofence` (`dentro_geofence`),
  CONSTRAINT `ubicaciones_ibfk_1` FOREIGN KEY (`id_reporte`) REFERENCES `reportes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `usuarios_departamento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios_departamento` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_departamento` int NOT NULL,
  `username` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `apellidos` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cargo` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rol` enum('viewer','editor','admin','supervisor') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'viewer',
  `permisos` json DEFAULT NULL,
  `puede_recibir_notificaciones` tinyint(1) DEFAULT '1',
  `metodo_notificacion_preferido` enum('whatsapp','email','app','sms','todos') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'todos',
  `token_notificacion` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ultimo_login` timestamp NULL DEFAULT NULL,
  `intentos_login_fallidos` int DEFAULT '0',
  `bloqueado_hasta` timestamp NULL DEFAULT NULL,
  `debe_cambiar_password` tinyint(1) DEFAULT '0',
  `fecha_cambio_password` timestamp NULL DEFAULT NULL,
  `activo` tinyint(1) DEFAULT '1',
  `creado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_username` (`username`),
  KEY `idx_email` (`email`),
  KEY `idx_activo` (`activo`),
  KEY `idx_departamento` (`id_departamento`),
  CONSTRAINT `usuarios_departamento_ibfk_1` FOREIGN KEY (`id_departamento`) REFERENCES `departamentos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `v_estadisticas_departamento`;
/*!50001 DROP VIEW IF EXISTS `v_estadisticas_departamento`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_estadisticas_departamento` AS SELECT 
 1 AS `id`,
 1 AS `nombre`,
 1 AS `total_reportes`,
 1 AS `reportes_nuevos`,
 1 AS `reportes_proceso`,
 1 AS `reportes_resueltos`,
 1 AS `tiempo_respuesta_promedio`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_reportes_completos`;
/*!50001 DROP VIEW IF EXISTS `v_reportes_completos`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_reportes_completos` AS SELECT 
 1 AS `id`,
 1 AS `folio`,
 1 AS `fecha`,
 1 AS `hora`,
 1 AS `nombre`,
 1 AS `telefono`,
 1 AS `cargo`,
 1 AS `tipo_problema`,
 1 AS `tipo_problema_otro`,
 1 AS `lugar`,
 1 AS `descripcion`,
 1 AS `creado_por`,
 1 AS `estado`,
 1 AS `prioridad`,
 1 AS `ip_address`,
 1 AS `user_agent`,
 1 AS `num_departamentos`,
 1 AS `num_archivos`,
 1 AS `num_seguimientos`,
 1 AS `latitud`,
 1 AS `longitud`,
 1 AS `precision_metros`,
 1 AS `departamentos_nombres`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `zonas_aeropuerto`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zonas_aeropuerto` (
  `id` int NOT NULL AUTO_INCREMENT,
  `codigo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `descripcion` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `orden` int NOT NULL DEFAULT '100',
  `creado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_zona_codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50001 DROP VIEW IF EXISTS `v_estadisticas_departamento`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_estadisticas_departamento` AS select `d`.`id` AS `id`,`d`.`nombre` AS `nombre`,count(distinct `rd`.`id_reporte`) AS `total_reportes`,sum((case when (`r`.`estado` = 'nuevo') then 1 else 0 end)) AS `reportes_nuevos`,sum((case when (`r`.`estado` = 'en_proceso') then 1 else 0 end)) AS `reportes_proceso`,sum((case when (`r`.`estado` = 'resuelto') then 1 else 0 end)) AS `reportes_resueltos`,avg(`s`.`tiempo_respuesta_minutos`) AS `tiempo_respuesta_promedio` from (((`departamentos` `d` left join `reporte_departamento` `rd` on((`d`.`id` = `rd`.`id_departamento`))) left join `reportes` `r` on((`rd`.`id_reporte` = `r`.`id`))) left join `seguimiento` `s` on(((`r`.`id` = `s`.`id_reporte`) and (`s`.`id_departamento` = `d`.`id`)))) where (`d`.`activo` = true) group by `d`.`id` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_reportes_completos`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY DEFINER */
/*!50001 VIEW `v_reportes_completos` AS select `r`.`id` AS `id`,`r`.`folio` AS `folio`,`r`.`fecha` AS `fecha`,`r`.`hora` AS `hora`,`r`.`nombre` AS `nombre`,`r`.`telefono` AS `telefono`,`r`.`cargo` AS `cargo`,`r`.`tipo_problema` AS `tipo_problema`,`r`.`tipo_problema_otro` AS `tipo_problema_otro`,`r`.`lugar` AS `lugar`,`r`.`descripcion` AS `descripcion`,`r`.`creado_por` AS `creado_por`,`r`.`estado` AS `estado`,`r`.`prioridad` AS `prioridad`,`r`.`ip_address` AS `ip_address`,`r`.`user_agent` AS `user_agent`,count(distinct `rd`.`id_departamento`) AS `num_departamentos`,count(distinct `ra`.`id`) AS `num_archivos`,count(distinct `s`.`id`) AS `num_seguimientos`,`u`.`latitud` AS `latitud`,`u`.`longitud` AS `longitud`,`u`.`precision_metros` AS `precision_metros`,group_concat(distinct `d`.`nombre` separator ', ') AS `departamentos_nombres` from (((((`reportes` `r` left join `reporte_departamento` `rd` on((`r`.`id` = `rd`.`id_reporte`))) left join `departamentos` `d` on((`rd`.`id_departamento` = `d`.`id`))) left join `reportes_archivos` `ra` on(((`r`.`id` = `ra`.`id_reporte`) and (`ra`.`estado` = 'completed')))) left join `seguimiento` `s` on((`r`.`id` = `s`.`id_reporte`))) left join `ubicaciones` `u` on((`r`.`id` = `u`.`id_reporte`))) group by `r`.`id` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- Catálogos
SET FOREIGN_KEY_CHECKS=0;
INSERT INTO `departamentos` (`id`,`codigo`,`nombre`,`telefono`,`correo`,`descripcion`,`activo`,`icono`,`color`,`orden_display`,`creado_en`) VALUES
(1,'ing_civil','Ingeniería Civil',NULL,NULL,'Departamento de Ingeniería Civil y Estructuras',0,'🏗️','#28a745',1,'2025-09-27 15:27:27'),
(2,'operaciones','Operaciones',NULL,NULL,'Centro de Control de Operaciones Aeroportuarias',0,'✈️','#dc3545',2,'2025-09-27 15:27:27'),
(3,'sms','Sistema de Gestión de la Seguridad Operacional',NULL,NULL,'Gestión de seguridad operacional y SMS',0,'🛡️','#004b87',3,'2025-09-27 15:27:27'),
(4,'mantenimiento','Mantenimiento (DESACTIVADO)',NULL,NULL,'Mantenimiento de Instalaciones',0,'🔧','#ffc107',4,'2025-09-27 15:27:27'),
(5,'avsec','Seguridad de la Aviación Civil',NULL,NULL,'Seguridad de la aviación y control de accesos',0,'🛡️','#6c757d',5,'2025-09-27 15:27:27'),
(6,'electromecanica','Electromecánica',NULL,NULL,'Sistemas electromecánicos y energía',0,'⚡','#ff6b6b',40,'2025-10-21 22:50:54'),
(7,'fauna','Control de Fauna',NULL,NULL,'Control y mitigación de fauna',0,'🦅','#51cf66',50,'2025-10-21 22:51:05'),
(8,'ssei','Sistema de Salvamento y Extinción de Incendios',NULL,NULL,'Prevención y extinción de incendios',0,'🚒','#ff8787',60,'2025-10-21 22:51:12'),
(9,'afac','Agencia Federal de Aviación Civil',NULL,NULL,'Supervisión y regulación de aviación civil',0,'🏛️','#2f54eb',70,'2025-10-23 23:09:19'),
(24,'dir_general','Dirección General',NULL,NULL,NULL,1,NULL,NULL,10,'2025-11-01 09:28:59'),
(25,'dir_admin','Dirección de Administración',NULL,NULL,NULL,1,NULL,NULL,20,'2025-11-01 09:28:59'),
(26,'dir_planeacion','Dirección de Planeación Estratégica',NULL,NULL,NULL,1,NULL,NULL,30,'2025-11-01 09:28:59'),
(27,'dir_juridica','Dirección Jurídica',NULL,NULL,NULL,1,NULL,NULL,40,'2025-11-01 09:28:59'),
(28,'dir_operacion','Dirección de Operación',NULL,NULL,NULL,1,NULL,NULL,50,'2025-11-01 09:28:59'),
(29,'dir_comercial','Dirección Comercial y de Servicios',NULL,NULL,NULL,1,NULL,NULL,60,'2025-11-01 09:28:59'),
(30,'dir_coordinacion','Dirección de Coordinación y Seguimiento de Acuerdos',NULL,NULL,NULL,1,NULL,NULL,70,'2025-11-01 09:28:59'),
(31,'subdir_seg_op','Subdirección de Seguridad Operacional',NULL,NULL,NULL,1,NULL,NULL,80,'2025-11-01 09:28:59'),
(32,'subdir_seg_av','Subdirección de Seguridad de la Aviación Civil',NULL,NULL,NULL,1,NULL,NULL,90,'2025-11-01 09:28:59'),
(33,'subdir_ingenieria','Subdirección de Ingeniería',NULL,NULL,NULL,1,NULL,NULL,100,'2025-11-01 09:28:59'),
(34,'subdir_serv_conexos','Subdirección de Servicios Conexos',NULL,NULL,NULL,1,NULL,NULL,110,'2025-11-01 09:28:59'),
(35,'subdir_serv_compl','Subdirección de Servicios Complementarios',NULL,NULL,NULL,1,NULL,NULL,120,'2025-11-01 09:28:59'),
(36,'ger_sms','Gerencia de SMS',NULL,NULL,NULL,1,NULL,NULL,130,'2025-11-01 09:28:59'),
(37,'afc','AFAC',NULL,NULL,NULL,1,NULL,NULL,140,'2025-11-01 09:28:59');
INSERT INTO `tipos_problemas` (`id`,`codigo`,`nombre`,`descripcion`,`activo`,`orden_display`,`fecha_creacion`) VALUES
(1,'aumento_fauna_ambiental','Aumento de fauna por factores ambientales o estacionales',NULL,1,10,'2025-11-01 12:36:48'),
(2,'autorizacion_pista_ocupada','Autorización de aterrizaje/despegue con pista ocupada',NULL,1,20,'2025-11-01 12:36:48'),
(3,'avistamiento_fauna_aviar','Avistamiento de fauna aviar',NULL,1,30,'2025-11-01 12:36:48'),
(4,'avistamiento_fauna_terrestre','Avistamiento de fauna terrestre',NULL,1,40,'2025-11-01 12:36:48'),
(5,'balizamiento_inadecuado','Balizamiento inadecuado o ausente',NULL,1,50,'2025-11-01 12:36:48'),
(6,'cercania_gse_pasajeros','Cercanía de estacionamiento GSE con ruta de pasajeros',NULL,1,60,'2025-11-01 12:36:48'),
(7,'comunicacion_rtar_deficiente','Comunicación RTAR deficiente',NULL,1,70,'2025-11-01 12:36:48'),
(8,'condiciones_ambientales','Condiciones ambientales adversas',NULL,1,80,'2025-11-01 12:36:48'),
(9,'friccion_reducida_pista','Condiciones de fricción reducida en la superficie de pista',NULL,1,90,'2025-11-01 12:36:48'),
(10,'contaminacion_caucho_pista','Contaminación de caucho en la superficie de pista',NULL,1,100,'2025-11-01 12:36:48'),
(11,'cruce_frente_aeronave','Cruce al frente o detrás de una aeronave',NULL,1,110,'2025-11-01 12:36:48'),
(12,'cruce_aeropasillo','Cruce durante aeropasillo en movimiento',NULL,1,120,'2025-11-01 12:36:48'),
(13,'cuerpos_agua','Cuerpos de agua',NULL,1,130,'2025-11-01 12:36:48'),
(14,'deficiencias_instrumentos','Deficiencias en los instrumentos de inspección',NULL,1,140,'2025-11-01 12:36:48'),
(15,'deficit_cultura_seguridad','Déficit en el desarrollo de una cultura de seguridad operacional positiva',NULL,1,150,'2025-11-01 12:36:48'),
(16,'despegue_sin_autorizacion','Despegue o aterrizaje de aeronaves sin autorización',NULL,1,160,'2025-11-01 12:36:48'),
(17,'encendido_motores_sin_autorizacion','Encendido de motores sin autorización',NULL,1,170,'2025-11-01 12:36:48'),
(18,'espacio_limitado_transito','Espacio limitado para tránsito de equipos motorizados y no motorizados',NULL,1,180,'2025-11-01 12:36:48'),
(19,'estacionamiento_registros_turbosina','Estacionamiento o cruce sobre registros de turbosina',NULL,1,190,'2025-11-01 12:36:48'),
(20,'falla_sistema_aeronave','Falla de algún sistema de la aeronave',NULL,1,200,'2025-11-01 12:36:48'),
(21,'falla_vdgs','Falla en el sistema VDGS (Visual Docking Guidance System)',NULL,1,210,'2025-11-01 12:36:48'),
(22,'falla_equipos_comunicacion','Falla en los equipos de comunicación',NULL,1,220,'2025-11-01 12:36:48'),
(23,'falla_sistema_vehiculo_gse','Falla en un sistema del vehículo/equipo GSE',NULL,1,230,'2025-11-01 12:36:48'),
(24,'falla_iluminacion','Falla/ausencia de iluminación en área operacional',NULL,1,240,'2025-11-01 12:36:48'),
(25,'falta_compromiso_psat','Falta de compromiso de los PSAT con la seguridad operacional',NULL,1,250,'2025-11-01 12:36:48'),
(26,'falta_compromiso_personal','Falta de compromiso del personal con la seguridad operacional',NULL,1,260,'2025-11-01 12:36:48'),
(27,'falta_control_procesos','Falta de control y/o supervisión de los procesos operacionales',NULL,1,270,'2025-11-01 12:36:48'),
(28,'falta_coordinacion_cco','Falta de coordinación de CCO en plataforma',NULL,1,280,'2025-11-01 12:36:48'),
(29,'falta_coordinacion_trabajos','Falta de coordinación para realizar trabajos en el área de movimiento',NULL,1,290,'2025-11-01 12:36:48'),
(30,'falta_mantenimiento','Falta de mantenimiento correctivo/preventivo',NULL,1,300,'2025-11-01 12:36:48'),
(31,'falta_supervision_contratistas','Falta de supervisión a empresas contratadas',NULL,1,310,'2025-11-01 12:36:48'),
(32,'fod','FOD (Foreign Object Debris)',NULL,1,320,'2025-11-01 12:36:48'),
(33,'hallazgos_sin_seguimiento','Hallazgos sin evidencia de seguimiento',NULL,1,330,'2025-11-01 12:36:48'),
(34,'impacto_fauna','Impacto con fauna dentro del polígono',NULL,1,340,'2025-11-01 12:36:48'),
(35,'incumplimiento_reglas','Incumplimiento a las reglas de operación',NULL,1,350,'2025-11-01 12:36:48'),
(36,'incumplimiento_abastecimiento','Incumplimiento de protocolos de seguridad en el abastecimiento de combustible a aeronaves',NULL,1,360,'2025-11-01 12:36:48'),
(37,'incumplimiento_personal_tierra','Incumplimiento de protocolos de seguridad en plataforma por personal de tierra',NULL,1,370,'2025-11-01 12:36:48'),
(38,'incumplimiento_vuelo_visual','Incumplimiento de seguridad en operaciones de vuelo visual',NULL,1,380,'2025-11-01 12:36:48'),
(39,'indice_perfil_bajo','Índice de perfil con valores bajos en algunas zonas de pista',NULL,1,390,'2025-11-01 12:36:48'),
(40,'infraccion_conduccion','Infracción a las normas de conducción',NULL,1,400,'2025-11-01 12:36:48'),
(41,'infraestructura_mal_emplazada','Infraestructura mal emplazada',NULL,1,410,'2025-11-01 12:36:48'),
(42,'ingreso_plataforma_sin_autorizacion','Ingreso/salida de aeronaves a plataforma sin autorización',NULL,1,420,'2025-11-01 12:36:48'),
(43,'invasion_areas_seguridad','Invasión de áreas de seguridad de la aeronave por vehículos/equipos GSE',NULL,1,430,'2025-11-01 12:36:48'),
(44,'letreros_danados','Letreros inexistentes o dañados',NULL,1,440,'2025-11-01 12:36:48'),
(45,'maniobras_limitadas_gse','Maniobras limitadas del equipo de apoyo en tierra',NULL,1,450,'2025-11-01 12:36:48'),
(46,'notificacion_tardia','Notificación de incidente tardía',NULL,1,460,'2025-11-01 12:36:48'),
(47,'operador_sin_licencia','Operador de vehículos sin licencia de conducir',NULL,1,470,'2025-11-01 12:36:48'),
(48,'pasajeros_sin_supervision','Pasajeros sin supervisión en plataforma',NULL,1,480,'2025-11-01 12:36:48'),
(49,'pavimento_oquedades','Pavimento con oquedades o fisuras',NULL,1,490,'2025-11-01 12:36:48'),
(50,'personal_no_apto','Personal en condiciones no aptas para laborar',NULL,1,500,'2025-11-01 12:36:48'),
(51,'personal_sin_equipo_seguridad','Personal sin equipo de seguridad personal o incompleto',NULL,1,510,'2025-11-01 12:36:48'),
(52,'piloto_confunde_salida','Piloto confunde salida',NULL,1,520,'2025-11-01 12:36:48'),
(53,'piloto_no_acata','Piloto no acata la instrucción recibida',NULL,1,530,'2025-11-01 12:36:48'),
(54,'planificacion_capacitacion','Planificación de capacitación incompleta',NULL,1,540,'2025-11-01 12:36:48'),
(55,'registros_baja_resistencia','Registros de baja resistencia',NULL,1,550,'2025-11-01 12:36:48'),
(56,'retraso_emergencias','Retraso en la respuesta a emergencias',NULL,1,560,'2025-11-01 12:36:48'),
(57,'senalamientos_desgastados','Señalamientos desgastados o ausentes',NULL,1,570,'2025-11-01 12:36:48'),
(58,'senalamientos_obstruidos','Señalamientos obstruidos por maleza',NULL,1,580,'2025-11-01 12:36:48'),
(59,'transporte_inadecuado_combustible','Transporte inadecuado de combustible',NULL,1,590,'2025-11-01 12:36:48'),
(60,'uso_inadecuado_gse','Uso inadecuado de vehículos/equipos GSE',NULL,1,600,'2025-11-01 12:36:48'),
(61,'vegetacion_crecida','Vegetación crecida',NULL,1,610,'2025-11-01 12:36:48'),
(62,'vehiculo_condiciones_deficientes','Vehículo o equipo en condiciones deficientes',NULL,1,620,'2025-11-01 12:36:48'),
(63,'vehiculo_encendido_sin_supervision','Vehículo o equipo encendido sin supervisión',NULL,1,630,'2025-11-01 12:36:48');
INSERT INTO `tipo_problema_departamentos` (`id`,`tipo_problema`,`codigo_departamento`,`es_responsable`,`recibe_notificacion`,`activo`,`fecha_creacion`) VALUES
(1,'Daño en infraestructura','ing_civil',1,1,1,'2025-10-24 01:32:12'),
(2,'Daño en infraestructura','sms',0,1,1,'2025-10-24 01:32:12'),
(3,'Daño en infraestructura','operaciones',0,1,1,'2025-10-24 01:32:12'),
(4,'FOD','sms',1,1,1,'2025-10-24 01:32:20'),
(5,'FOD','operaciones',0,1,1,'2025-10-24 01:32:20'),
(6,'Falla de iluminación','electromecanica',1,1,1,'2025-10-24 01:32:27'),
(7,'Falla de iluminación','operaciones',0,1,1,'2025-10-24 01:32:27'),
(8,'Falla de iluminación','sms',0,1,1,'2025-10-24 01:32:27'),
(9,'Problema de señalización','operaciones',1,1,1,'2025-10-24 01:32:35'),
(10,'Problema de señalización','sms',0,1,1,'2025-10-24 01:32:35'),
(11,'Daño en pavimento','ing_civil',1,1,1,'2025-10-24 01:32:41'),
(12,'Daño en pavimento','operaciones',0,1,1,'2025-10-24 01:32:41'),
(13,'Presencia de fauna','fauna',1,1,1,'2025-10-24 01:32:49'),
(14,'Presencia de fauna','sms',0,1,1,'2025-10-24 01:32:49'),
(15,'Presencia de fauna','afac',0,1,1,'2025-10-24 01:32:49'),
(16,'Incidente de seguridad','avsec',1,1,1,'2025-10-24 01:32:58'),
(17,'Incidente de seguridad','sms',0,1,1,'2025-10-24 01:32:58'),
(18,'Incidente de seguridad','afac',0,1,1,'2025-10-24 01:32:58'),
(19,'Falla de equipos','operaciones',1,1,1,'2025-10-24 01:33:14'),
(20,'Contaminación de pavimento','operaciones',1,1,1,'2025-10-24 01:33:22'),
(21,'Falla de ayudas visuales','electromecanica',1,1,1,'2025-10-24 01:33:34'),
(22,'Falla de ayudas visuales','operaciones',0,1,1,'2025-10-24 01:33:34'),
(23,'Falla de ayudas visuales','sms',0,1,1,'2025-10-24 01:33:34');
INSERT INTO `configuracion_sistema` (`id`,`clave`,`valor`,`tipo`,`descripcion`,`editable`,`categoria`,`actualizado_en`) VALUES
(1,'ultimo_folio_rsm','56','number','Último número de folio RSM generado',1,'folios','2026-11-09 09:45:54'),
(2,'max_archivos_por_reporte','5','number','Número máximo de archivos por reporte',1,'limites','2025-09-27 15:27:36'),
(3,'max_size_imagen_mb','10','number','Tamaño máximo de imagen en MB',1,'limites','2025-09-27 15:27:36'),
(4,'max_size_video_mb','50','number','Tamaño máximo de video en MB',1,'limites','2025-09-27 15:27:36'),
(5,'tiempo_expiracion_sesion_minutos','120','number','Tiempo de expiración de sesión en minutos',1,'seguridad','2025-09-27 15:27:36'),
(6,'intentos_login_maximos','5','number','Intentos máximos de login antes de bloqueo',1,'seguridad','2025-09-27 15:27:36'),
(7,'tiempo_bloqueo_minutos','30','number','Tiempo de bloqueo después de intentos fallidos',1,'seguridad','2025-09-27 15:27:36'),
(8,'whatsapp_api_enabled','false','boolean','API de WhatsApp habilitada',1,'notificaciones','2025-09-27 15:27:36'),
(9,'email_notifications_enabled','true','boolean','Notificaciones por email habilitadas',1,'notificaciones','2025-09-27 15:27:36'),
(10,'cloudinary_folder','aifa/reportes','string','Carpeta base en Cloudinary',1,'almacenamiento','2025-09-27 15:27:36'),
(14,'sms_matriz_riesgo','{\"version\":\"referencia-oaci-1\",\"validada\":false,\"nota\":\"Matriz de referencia basada en el Doc 9859 de la OACI. Requiere validación de la Gerencia de SMS antes de considerarse criterio oficial.\",\"probabilidad\":[{\"valor\":5,\"nombre\":\"Frecuente\",\"descripcion\":\"Es probable que suceda muchas veces (ha ocurrido con frecuencia).\"},{\"valor\":4,\"nombre\":\"Ocasional\",\"descripcion\":\"Es probable que suceda algunas veces (ha ocurrido con poca frecuencia).\"},{\"valor\":3,\"nombre\":\"Remoto\",\"descripcion\":\"Es poco probable que ocurra, pero no imposible (rara vez ha ocurrido).\"},{\"valor\":2,\"nombre\":\"Improbable\",\"descripcion\":\"Es muy poco probable que ocurra (no se sabe que haya ocurrido).\"},{\"valor\":1,\"nombre\":\"Sumamente improbable\",\"descripcion\":\"Es casi inconcebible que el suceso ocurra.\"}],\"severidad\":[{\"valor\":5,\"codigo\":\"A\",\"nombre\":\"Catastrófico\",\"descripcion\":\"Destrucción de equipo; múltiples muertes.\"},{\"valor\":4,\"codigo\":\"B\",\"nombre\":\"Peligroso\",\"descripcion\":\"Gran reducción de márgenes de seguridad; lesiones graves; daños mayores al equipo.\"},{\"valor\":3,\"codigo\":\"C\",\"nombre\":\"Grave\",\"descripcion\":\"Reducción importante de márgenes de seguridad; incidente grave; lesiones a personas.\"},{\"valor\":2,\"codigo\":\"D\",\"nombre\":\"Leve\",\"descripcion\":\"Molestias; limitaciones operacionales; incidente menor.\"},{\"valor\":1,\"codigo\":\"E\",\"nombre\":\"Insignificante\",\"descripcion\":\"Pocas consecuencias.\"}],\"niveles\":[{\"clave\":\"alto\",\"nombre\":\"Alto · Intolerable\",\"prioridad\":\"Atención inmediata\",\"color\":\"#CF324C\",\"plazo_dias\":null,\"es_alto\":true},{\"clave\":\"medio\",\"nombre\":\"Medio · Tolerable\",\"prioridad\":\"Atención programada\",\"color\":\"#E0A030\",\"plazo_dias\":null,\"es_alto\":false},{\"clave\":\"bajo\",\"nombre\":\"Bajo · Aceptable\",\"prioridad\":\"Seguimiento normal\",\"color\":\"#078C72\",\"plazo_dias\":null,\"es_alto\":false}],\"celdas\":{\"1-1\":\"bajo\",\"1-2\":\"bajo\",\"1-3\":\"bajo\",\"1-4\":\"bajo\",\"1-5\":\"medio\",\"2-1\":\"bajo\",\"2-2\":\"bajo\",\"2-3\":\"medio\",\"2-4\":\"medio\",\"2-5\":\"medio\",\"3-1\":\"bajo\",\"3-2\":\"medio\",\"3-3\":\"medio\",\"3-4\":\"medio\",\"3-5\":\"alto\",\"4-1\":\"medio\",\"4-2\":\"medio\",\"4-3\":\"medio\",\"4-4\":\"alto\",\"4-5\":\"alto\",\"5-1\":\"medio\",\"5-2\":\"medio\",\"5-3\":\"alto\",\"5-4\":\"alto\",\"5-5\":\"alto\"},\"alertas\":{\"dias_aviso_vencimiento\":7}}','json','Matriz de riesgo operacional 5x5 (SMS)',1,'sms','2026-11-04 16:11:28');
INSERT INTO `migraciones_aplicadas` (`archivo`,`aplicada_en`) VALUES
('001_sms_riesgo_acciones_notificaciones.sql','2026-11-04 16:11:28'),
('002_sms_compromisos_residual_zonas.js','2026-11-05 10:23:50'),
('003_sms_reportes_eliminados.sql','2026-11-05 11:14:06');
SET FOREIGN_KEY_CHECKS=1;
