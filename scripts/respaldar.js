/* ============================================================================
   Respaldo manual de la base de datos.
   Uso:  npm run respaldar
   Genera respaldos/<base>_AAAA-MM-DD_HHMMSS.sql.gz y conserva los últimos 30
   (RESPALDOS_CONSERVAR). Usa la base indicada en .env (o DB_NAME).
   Restaurar (con cuidado: reemplaza los datos de la base de destino):
     node -e "process.stdout.write(require('zlib').gunzipSync(require('fs').readFileSync('ARCHIVO.sql.gz')))" | mysql -uroot BASE
   ========================================================================= */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const respaldos = require('../lib/respaldos');

respaldos.respaldar()
    .then(r => {
        console.log(`Respaldo creado: ${r.ruta} (${(r.bytes / 1024).toFixed(0)} KB)`);
        if (r.eliminados) console.log(`Se eliminaron ${r.eliminados} respaldo(s) antiguo(s); se conservan los últimos ${respaldos.conservar()}.`);
    })
    .catch(e => {
        console.error('No se pudo crear el respaldo:', e.message);
        process.exitCode = 1;
    });
