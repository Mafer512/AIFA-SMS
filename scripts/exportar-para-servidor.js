/* ============================================================================
   Prepara la información para llevar el SMS a un servidor (Hostinger).
   Uso:  npm run exportar-servidor
   Genera en respaldos/para-servidor/:
     - <base>_servidor_AAAA-MM-DD_HHMMSS.sql  → se importa en phpMyAdmin de la
       base nueva (no crea la base ni cambia de base: entra en la que se elija).
     - uploads_AAAA-MM-DD_HHMMSS.zip         → fotos de evidencia; se descomprime
       en la carpeta indicada en UPLOADS_DIR del servidor.
   Ambos archivos contienen datos personales: muévelos solo por medios
   autorizados y bórralos de tu equipo cuando termine el traspaso.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const respaldos = require('../lib/respaldos');
const { limpiarParaServidor } = require('../lib/exportacion');
const { carpetaUploads } = require('../lib/configuracion');

const base = process.env.DB_NAME || 'aifa_rsm';
const destino = path.join(respaldos.carpeta(), 'para-servidor');

function marcaDeTiempo(d = new Date()) {
    const p2 = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function volcar(dump) {
    return new Promise((resolver, rechazar) => {
        const args = [
            '-h', process.env.DB_HOST || 'localhost',
            '-P', String(process.env.DB_PORT || 3306),
            '-u', process.env.DB_USER || 'root',
            '--single-transaction', '--triggers', '--routines', '--hex-blob',
            '--no-tablespaces', '--set-gtid-purged=OFF',
            '--default-character-set=utf8mb4',
            base
        ];
        const env = { ...process.env };
        if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD;
        const proc = spawn(dump, args, { env, windowsHide: true });
        const partes = [];
        let errores = '';
        proc.stdout.on('data', c => partes.push(c));
        proc.stderr.on('data', c => { errores += c.toString(); });
        proc.on('error', rechazar);
        proc.on('close', codigo => {
            if (codigo !== 0) return rechazar(new Error('mysqldump terminó con error: ' + (errores.trim().split('\n').pop() || codigo)));
            resolver(Buffer.concat(partes).toString('utf8'));
        });
    });
}

/** Comprime la carpeta de evidencias con el tar de Windows (bsdtar), que sabe crear .zip. */
function comprimirUploads(zip) {
    const origen = carpetaUploads();
    if (!fs.existsSync(origen)) return { omitido: 'no existe la carpeta de evidencias' };
    const tarWindows = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const tar = process.platform === 'win32' && fs.existsSync(tarWindows) ? tarWindows : 'tar';
    const r = spawnSync(tar, ['-a', '-c', '-f', zip, '-C', origen, '.'], { windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(zip)) return { omitido: 'no se pudo comprimir (' + ((r.stderr || r.error || '').toString().trim() || r.status) + ')' };
    return { bytes: fs.statSync(zip).size };
}

(async () => {
    const dump = respaldos.buscarMysqldump();
    if (!dump) throw new Error('No se encontró mysqldump. Indica su ruta en la variable MYSQLDUMP_PATH del archivo .env');
    fs.mkdirSync(destino, { recursive: true });
    const marca = marcaDeTiempo();

    const sql = limpiarParaServidor(await volcar(dump));
    const archivoSql = path.join(destino, `${base}_servidor_${marca}.sql`);
    fs.writeFileSync(archivoSql, sql);
    const tablas = (sql.match(/^CREATE TABLE /gm) || []).length;
    const vistas = (sql.match(/\/\*!50001 VIEW `/g) || []).length;
    console.log(`Base: ${archivoSql}`);
    console.log(`      ${(fs.statSync(archivoSql).size / 1024).toFixed(0)} KB · ${tablas} tablas${vistas ? ` · ${vistas} vistas` : ''}`);

    const archivoZip = path.join(destino, `uploads_${marca}.zip`);
    const z = comprimirUploads(archivoZip);
    console.log(z.omitido ? `Evidencias: ${z.omitido}` : `Evidencias: ${archivoZip}\n            ${(z.bytes / 1024).toFixed(0)} KB`);
    console.log('\nContienen datos personales: muévelos solo por medios autorizados y bórralos de este equipo al terminar.');
})().catch(e => {
    console.error('No se pudo preparar la exportación:', e.message);
    process.exitCode = 1;
});
