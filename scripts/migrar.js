/* ============================================================================
   Aplica las migraciones de database/migraciones en orden.
   - Registra cada archivo aplicado en la tabla migraciones_aplicadas.
   - Las migraciones son NO destructivas (crean tablas y agregan columnas o
     índices solo si no existen; nunca eliminan ni modifican datos).
   - Siembra la matriz de riesgo de referencia si aún no existe.
   Uso:  node scripts/migrar.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const riesgo = require('../lib/sms/riesgo');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'aifa_rsm',
        multipleStatements: true
    });
    try {
        await conn.query(`CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
            archivo VARCHAR(200) PRIMARY KEY,
            aplicada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        const dir = path.join(__dirname, '..', 'database', 'migraciones');
        // .sql: sentencias directas · .js: módulo que exporta async (conn) => {}
        // (para cambios que deben verificar el esquema antes, p. ej. agregar columnas)
        const archivos = fs.readdirSync(dir).filter(f => /^\d+_.+\.(sql|js)$/.test(f)).sort();
        const [hechas] = await conn.query('SELECT archivo FROM migraciones_aplicadas');
        const yaAplicadas = new Set(hechas.map(h => h.archivo));

        for (const archivo of archivos) {
            if (yaAplicadas.has(archivo)) {
                console.log(`= ${archivo} (ya aplicada)`);
                continue;
            }
            if (archivo.endsWith('.js')) {
                await require(path.join(dir, archivo))(conn);
            } else {
                await conn.query(fs.readFileSync(path.join(dir, archivo), 'utf8'));
            }
            await conn.query('INSERT INTO migraciones_aplicadas (archivo) VALUES (?)', [archivo]);
            console.log(`+ ${archivo} aplicada`);
        }

        const [cfg] = await conn.query('SELECT 1 FROM configuracion_sistema WHERE clave = ?', [riesgo.CLAVE_CONFIG]);
        if (!cfg.length) {
            await riesgo.guardarMatriz(conn, riesgo.MATRIZ_REFERENCIA);
            console.log('+ Matriz de riesgo de referencia registrada (pendiente de validación)');
        }
        console.log('Migraciones al día.');
    } finally {
        await conn.end();
    }
})().catch(e => {
    console.error('Error aplicando migraciones:', e.message);
    process.exit(1);
});
