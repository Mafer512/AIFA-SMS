'use strict';

const path = require('path');
const { secretoJWT, problemaSecreto, carpetaUploads } = require('../../lib/configuracion');
const { limpiarParaServidor } = require('../../lib/exportacion');

const BUENA = 'a'.repeat(20) + 'B7c9D1e3F5g7H9j1K3m5';

describe('secretoJWT', () => {
    test('en producción exige una clave definida, distinta de la de ejemplo y de al menos 32 caracteres', () => {
        expect(() => secretoJWT({ NODE_ENV: 'production' })).toThrow(/no está definida/);
        expect(() => secretoJWT({ NODE_ENV: 'production', JWT_SECRET: '   ' })).toThrow(/no está definida/);
        expect(() => secretoJWT({ NODE_ENV: 'production', JWT_SECRET: 'secret_key' })).toThrow(/clave de ejemplo/);
        expect(() => secretoJWT({ NODE_ENV: 'production', JWT_SECRET: 'cambia-esta-clave' })).toThrow(/clave de ejemplo/);
        expect(() => secretoJWT({ NODE_ENV: 'production', JWT_SECRET: 'corta123' })).toThrow(/menos de 32/);
        expect(secretoJWT({ NODE_ENV: 'production', JWT_SECRET: BUENA })).toBe(BUENA);
    });

    test('fuera de producción conserva el comportamiento anterior', () => {
        expect(secretoJWT({ NODE_ENV: 'development' })).toBe('secret_key');
        expect(secretoJWT({ NODE_ENV: 'test', JWT_SECRET: 'corta' })).toBe('corta');
    });

    test('problemaSecreto no acepta valores vacíos', () => {
        expect(problemaSecreto(undefined)).toBe('no está definida');
        expect(problemaSecreto(BUENA)).toBeNull();
    });
});

describe('carpetaUploads', () => {
    const raiz = path.join(__dirname, '..', '..');
    test('por omisión es la carpeta uploads del proyecto', () => {
        expect(carpetaUploads({})).toBe(path.join(raiz, 'uploads'));
    });
    test('UPLOADS_DIR la lleva a otra carpeta (absoluta o relativa al proyecto)', () => {
        const fuera = path.resolve(raiz, '..', 'sms-datos', 'uploads');
        expect(carpetaUploads({ UPLOADS_DIR: fuera })).toBe(fuera);
        expect(carpetaUploads({ UPLOADS_DIR: '../sms-datos/uploads' })).toBe(fuera);
    });
});

describe('limpiarParaServidor', () => {
    const volcado = [
        'SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;',
        'SET @@SESSION.SQL_LOG_BIN= 0;',
        "SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '';",
        'CREATE TABLE `t` (`a` varchar(5) COLLATE utf8mb4_0900_ai_ci) ENGINE=InnoDB;',
        "INSERT INTO `t` VALUES ('DEFINER=`x`@`y` dentro de un dato');",
        '/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */',
        '/*!50001 VIEW `v` AS select 1 */;',
        '/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `g` AFTER UPDATE ON `t` FOR EACH ROW SET @x = 1 */;;'
    ].join('\n');
    const limpio = limpiarParaServidor(volcado);

    test('quita los DEFINER de vistas y disparadores', () => {
        expect(limpio).toContain('/*!50013 SQL SECURITY DEFINER */');
        expect(limpio).toContain('/*!50017*/');
        expect(limpio).not.toMatch(/DEFINER=`root`/);
    });
    test('cambia la intercalación de MySQL 8 por una que MariaDB reconoce', () => {
        expect(limpio).not.toContain('utf8mb4_0900_ai_ci');
        expect(limpio).toContain('utf8mb4_unicode_ci');
    });
    test('quita las instrucciones que exigen privilegios de administrador', () => {
        expect(limpio).not.toMatch(/GTID_PURGED|SQL_LOG_BIN/);
    });
    test('no deja tablas ni vistas fuera y no altera los datos', () => {
        expect(limpio).toContain('CREATE TABLE `t`');
        expect(limpio).toContain('VIEW `v`');
        expect(limpio).toContain("INSERT INTO `t` VALUES ('DEFINER=`x`@`y` dentro de un dato');");
    });
});
