/* ============================================================================
   Exportación de la base para importarla en un hosting (Hostinger, etc.)
   ----------------------------------------------------------------------------
   Un volcado de MySQL local trae detalles que un hosting compartido rechaza:
   - DEFINER=`root`@`localhost` en vistas y disparadores: asignar otro usuario
     exige privilegios de administrador que el hosting no da.
   - Intercalación utf8mb4_0900_ai_ci (MySQL 8): MariaDB no la reconoce.
   - Instrucciones de GTID / binlog: también exigen privilegios de administrador.
   limpiarParaServidor() quita o adapta solo eso; los datos no se tocan.
   ========================================================================= */
'use strict';

function limpiarParaServidor(sql) {
    return String(sql)
        // Solo dentro de los comentarios versionados que mysqldump usa para vistas
        // (/*!50013), disparadores (/*!50017) y rutinas (/*!50020); los datos no se tocan.
        .replace(/(\/\*!50\d{3})\s+DEFINER\s*=\s*`[^`]*`@`[^`]*`/g, '$1')
        .replace(/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci')
        .replace(/^SET @@(GLOBAL|SESSION)\.(GTID_PURGED|SQL_LOG_BIN)\b.*$/gim, '')
        .replace(/^SET @MYSQLDUMP_TEMP_LOG_BIN\b.*$/gim, '');
}

module.exports = { limpiarParaServidor };
