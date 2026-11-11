/* ============================================================================
   Respaldos de la base de datos
   ----------------------------------------------------------------------------
   - Usa mysqldump (transacción consistente, sin bloquear la operación) y
     guarda el resultado comprimido: respaldos/<base>_AAAA-MM-DD_HHMMSS.sql.gz
   - Conserva los últimos N respaldos (RESPALDOS_CONSERVAR, 30 por defecto).
   - programar(): respalda al iniciar si el último tiene más de 24 h y revisa
     cada hora. Se desactiva con RESPALDO_AUTOMATICO=0.
   - La contraseña de MySQL se pasa por variable de entorno (MYSQL_PWD), no
     en la línea de comandos.
   Los respaldos contienen datos personales: la carpeta está fuera de /public
   y excluida del control de versiones.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

function carpeta() {
    return path.resolve(RAIZ, process.env.RESPALDOS_DIR || 'respaldos');
}

function conservar() {
    const n = parseInt(process.env.RESPALDOS_CONSERVAR, 10);
    return Number.isInteger(n) && n >= 1 ? n : 30;
}

function base() { return process.env.DB_NAME || 'aifa_rsm'; }

/** Localiza mysqldump: variable MYSQLDUMP_PATH, el PATH o la instalación típica de Windows. */
function buscarMysqldump() {
    const candidatos = [];
    if (process.env.MYSQLDUMP_PATH) candidatos.push(process.env.MYSQLDUMP_PATH);
    candidatos.push('mysqldump');
    if (process.platform === 'win32') {
        const programas = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
        for (const pf of programas) {
            const dir = path.join(pf, 'MySQL');
            if (!fs.existsSync(dir)) continue;
            for (const sub of fs.readdirSync(dir).sort().reverse()) {
                candidatos.push(path.join(dir, sub, 'bin', 'mysqldump.exe'));
            }
        }
    }
    for (const c of candidatos) {
        try {
            const r = spawnSync(c, ['--version'], { encoding: 'utf8', windowsHide: true });
            if (r.status === 0) return c;
        } catch (e) { /* siguiente candidato */ }
    }
    return null;
}

function listar() {
    const dir = carpeta();
    if (!fs.existsSync(dir)) return [];
    const patron = new RegExp('^' + base().replace(/[^\w-]/g, '') + '_\\d{4}-\\d{2}-\\d{2}_\\d{6}\\.sql\\.gz$');
    return fs.readdirSync(dir)
        .filter(f => patron.test(f))
        .map(f => { const st = fs.statSync(path.join(dir, f)); return { archivo: f, bytes: st.size, fecha: st.mtime }; })
        .sort((a, b) => b.fecha - a.fecha);
}

function rotar() {
    const sobrantes = listar().slice(conservar());
    for (const r of sobrantes) fs.unlinkSync(path.join(carpeta(), r.archivo));
    return sobrantes.length;
}

/** Genera un respaldo. Resuelve con { archivo, bytes, ruta, eliminados }. */
function respaldar() {
    return new Promise((resolver, rechazar) => {
        const dump = buscarMysqldump();
        if (!dump) return rechazar(new Error('No se encontró mysqldump. Indica su ruta en la variable MYSQLDUMP_PATH del archivo .env'));
        const dir = carpeta();
        fs.mkdirSync(dir, { recursive: true });
        const d = new Date();
        const p2 = n => String(n).padStart(2, '0');
        const nombre = `${base()}_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.sql.gz`;
        const destino = path.join(dir, nombre);
        const temporal = destino + '.parcial';
        const args = [
            '-h', process.env.DB_HOST || 'localhost',
            '-P', String(process.env.DB_PORT || 3306),
            '-u', process.env.DB_USER || 'root',
            '--single-transaction', '--routines', '--triggers', '--hex-blob',
            '--default-character-set=utf8mb4',
            base()
        ];
        const env = { ...process.env };
        if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD;
        const proc = spawn(dump, args, { env, windowsHide: true });
        const salida = fs.createWriteStream(temporal);
        let errores = '';
        proc.stderr.on('data', c => { errores += c.toString(); });
        proc.stdout.pipe(zlib.createGzip({ level: 9 })).pipe(salida);
        const fallar = e => { try { fs.unlinkSync(temporal); } catch (x) { /* ya no existe */ } rechazar(e); };
        proc.on('error', fallar);
        proc.on('close', codigo => {
            salida.on('close', () => {
                if (codigo !== 0) return fallar(new Error('mysqldump terminó con error: ' + (errores.trim().split('\n').pop() || codigo)));
                fs.renameSync(temporal, destino);
                const bytes = fs.statSync(destino).size;
                resolver({ archivo: nombre, ruta: destino, bytes, eliminados: rotar() });
            });
        });
    });
}

/** Respaldo automático: al iniciar (si hace falta) y revisión cada hora. */
function programar({ horas = 24, log = console.log } = {}) {
    if (process.env.RESPALDO_AUTOMATICO === '0') return null;
    let enCurso = false;
    async function revisar() {
        if (enCurso) return;
        const ultimo = listar()[0];
        if (ultimo && Date.now() - ultimo.fecha.getTime() < horas * 3600000) return;
        enCurso = true;
        try {
            const r = await respaldar();
            log(`[Respaldo] ${r.archivo} (${(r.bytes / 1024).toFixed(0)} KB)${r.eliminados ? ` · ${r.eliminados} respaldo(s) antiguo(s) eliminado(s)` : ''}`);
        } catch (e) {
            log('[Respaldo] No se pudo generar el respaldo automático: ' + e.message);
        } finally {
            enCurso = false;
        }
    }
    const inicial = setTimeout(revisar, 30 * 1000);
    const periodico = setInterval(revisar, 3600 * 1000);
    if (inicial.unref) inicial.unref();
    if (periodico.unref) periodico.unref();
    return { revisar };
}

module.exports = { carpeta, conservar, buscarMysqldump, listar, rotar, respaldar, programar };
