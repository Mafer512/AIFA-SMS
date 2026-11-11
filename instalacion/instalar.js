/* ============================================================================
   Instalación del SMS (S.A.G.A.) en esta computadora
   ----------------------------------------------------------------------------
   1. Revisa Node.js y las dependencias (node_modules). Si faltan, como al
      descargar desde GitHub, las instala con npm install (requiere internet).
   2. Pide los datos de MySQL (servidor, puerto, usuario, contraseña, base).
   3. Crea la base e importa el respaldo más reciente de la carpeta base-de-datos.
      Sin respaldo, instala la base vacía con los catálogos
      (database/esquema_y_catalogos.sql). Si la base ya existe con tablas, solo
      la reemplaza si escribes SI.
   4. Escribe la configuración (.env) con una clave de sesión nueva.
   5. Aplica las migraciones pendientes.
   Se ejecuta con "Instalar en otra computadora.bat" (doble clic).
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const CARPETA_BD = path.join(RAIZ, 'base-de-datos');
const ESQUEMA_VACIO = path.join(RAIZ, 'database', 'esquema_y_catalogos.sql');
const ARCHIVO_ENV = path.join(RAIZ, process.env.SMS_ARCHIVO_ENV || '.env');
const SIN_PREGUNTAS = process.argv.includes('--sin-preguntas');

function salir(mensaje) {
    console.error('\n  ✗ ' + mensaje + '\n');
    process.exit(1);
}

// ------------------------------------------------------------------ preguntas
const rl = SIN_PREGUNTAS ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
function preguntar(texto, porDefecto = '', oculto = false) {
    const env = { 'Servidor MySQL': 'SMS_DB_HOST', 'Puerto': 'SMS_DB_PORT', 'Usuario de MySQL': 'SMS_DB_USER', 'Contraseña de MySQL': 'SMS_DB_PASSWORD', 'Nombre de la base': 'SMS_DB_NAME' }[texto];
    if (SIN_PREGUNTAS) return Promise.resolve(env && process.env[env] !== undefined ? process.env[env] : porDefecto);
    return new Promise(resolver => {
        const sufijo = porDefecto ? ` [${porDefecto}]` : (oculto ? ' [vacía]' : '');
        if (oculto) {
            // No se muestra lo que se escribe
            const escribir = rl._writeToOutput.bind(rl);
            rl._writeToOutput = s => { if (s.includes(texto)) escribir(s); else if (s.includes('\n')) escribir('\n'); };
            rl.question(`  ${texto}${sufijo}: `, r => { rl._writeToOutput = escribir; resolver(r); });
        } else {
            rl.question(`  ${texto}${sufijo}: `, r => resolver(r.trim() || porDefecto));
        }
    });
}

// ------------------------------------------------- respaldo con DELIMITER ;;
/** Divide el volcado de mysqldump en sentencias, respetando los bloques DELIMITER (disparadores). */
function sentencias(sql) {
    const lista = [];
    let delim = ';';
    let actual = [];
    for (const linea of sql.split(/\r?\n/)) {
        const t = linea.trim();
        if (!actual.length && (t === '' || t.startsWith('-- ') || t === '--')) continue;
        const cambio = /^DELIMITER\s+(\S+)\s*$/i.exec(t);
        if (cambio) { delim = cambio[1]; continue; }
        actual.push(linea);
        if (t.endsWith(delim)) {
            const s = actual.join('\n').trim();
            lista.push(s.slice(0, s.length - delim.length).trim());
            actual = [];
        }
    }
    if (actual.join('').trim()) lista.push(actual.join('\n').trim());
    return lista.filter(Boolean);
}

function respaldoMasReciente() {
    if (!fs.existsSync(CARPETA_BD)) return null;
    const sql = fs.readdirSync(CARPETA_BD).filter(f => f.toLowerCase().endsWith('.sql')).sort();
    return sql.length ? path.join(CARPETA_BD, sql[sql.length - 1]) : null;
}

// ------------------------------------------------------------------ .env
function escribirEnv({ host, port, user, password, database }) {
    let base = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
    const poner = (clave, valor) => {
        const re = new RegExp(`^#?\\s*${clave}=.*$`, 'm');
        base = re.test(base) ? base.replace(re, `${clave}=${valor}`) : base + `\n${clave}=${valor}\n`;
    };
    poner('NODE_ENV', 'development');
    poner('PORT', '3000');
    poner('BASE_URL', 'http://localhost:3000');
    poner('DB_HOST', host);
    poner('DB_PORT', port);
    poner('DB_USER', user);
    poner('DB_PASSWORD', password);
    poner('DB_NAME', database);
    poner('JWT_SECRET', crypto.randomBytes(48).toString('hex'));
    if (fs.existsSync(ARCHIVO_ENV)) fs.copyFileSync(ARCHIVO_ENV, ARCHIVO_ENV + '.anterior');
    fs.writeFileSync(ARCHIVO_ENV, base);
}

(async () => {
    console.log('\n  Instalación del SMS · S.A.G.A. (AIFA)\n  ─────────────────────────────────────');

    // 1. Node.js y dependencias
    const mayor = Number(process.versions.node.split('.')[0]);
    if (mayor < 18) salir(`Se necesita Node.js 18 o más reciente (tienes ${process.versions.node}). Descárgalo de https://nodejs.org`);
    const cargarDependencias = () => {
        const m = require(path.join(RAIZ, 'node_modules', 'mysql2', 'promise'));
        require(path.join(RAIZ, 'node_modules', 'bcrypt'));
        return m;
    };
    let mysql;
    try {
        mysql = cargarDependencias();
    } catch (e) {
        // Descargado desde GitHub (sin node_modules) o de otra versión de Node.js
        console.log('\n  Instalando las dependencias con npm install (requiere internet; tarda unos minutos)…\n');
        const npm = spawnSync('npm', ['install', '--omit=dev'], { cwd: RAIZ, stdio: 'inherit', shell: true });
        try {
            if (npm.status !== 0) throw new Error();
            mysql = cargarDependencias();
        } catch (e2) {
            salir('No se pudieron instalar las dependencias. Con internet, abre una terminal en esta carpeta, ejecuta  npm install  y vuelve a intentar.');
        }
    }

    // Con respaldo: datos reales · sin respaldo: base vacía con los catálogos
    const respaldo = respaldoMasReciente();
    const origen = respaldo || ESQUEMA_VACIO;
    if (!fs.existsSync(origen)) salir('No se encontró el respaldo (.sql) en base-de-datos ni el esquema en database/esquema_y_catalogos.sql.');
    console.log(respaldo
        ? `  Respaldo: ${path.basename(respaldo)}\n`
        : '  Sin respaldo en base-de-datos: se instala la base vacía, solo con los catálogos.\n');

    // 2. Datos de MySQL
    console.log('  Datos de MySQL (Enter para aceptar el valor entre corchetes):');
    const host = await preguntar('Servidor MySQL', 'localhost');
    const port = await preguntar('Puerto', '3306');
    const user = await preguntar('Usuario de MySQL', 'root');
    const password = await preguntar('Contraseña de MySQL', '', true);
    const database = await preguntar('Nombre de la base', 'aifa_rsm');
    if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) salir('El nombre de la base solo admite letras, números y guion bajo.');

    let con;
    try {
        con = await mysql.createConnection({ host, port: Number(port), user, password, charset: 'utf8mb4' });
    } catch (e) {
        salir(`No se pudo conectar a MySQL (${e.code || e.message}). Revisa que MySQL esté encendido y los datos de acceso.`);
    }

    // 3. Base de datos
    const [[existe]] = await con.query(
        "SELECT COUNT(*) AS n, SUM(TABLE_TYPE = 'BASE TABLE') AS tablas FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    if (existe.n > 0) {
        console.log(`\n  La base "${database}" ya existe y tiene ${Number(existe.tablas) || 0} tablas.`);
        const r = SIN_PREGUNTAS ? (process.env.SMS_REEMPLAZAR || '') : await preguntar(`Escribe SI para reemplazarla con ${respaldo ? 'el respaldo' : 'una base vacía'} (se pierden sus datos actuales)`);
        if (r !== 'SI') { await con.end(); salir('Instalación cancelada: no se tocó la base existente.'); }
        await con.query(`DROP DATABASE \`${database}\``);
    }
    await con.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await con.query(`USE \`${database}\``);

    const lista = sentencias(fs.readFileSync(origen, 'utf8'));
    process.stdout.write(`\n  Importando ${lista.length} instrucciones… `);
    for (let i = 0; i < lista.length; i++) {
        try {
            await con.query(lista[i]);
        } catch (e) {
            await con.end();
            salir(`Falló la instrucción ${i + 1} de ${path.basename(origen)}: ${e.message}`);
        }
    }
    const [[tablas]] = await con.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [database]);
    const [[reportes]] = await con.query('SELECT COUNT(*) AS n FROM reportes');
    await con.end();
    console.log(`listo: ${tablas.n} tablas, ${reportes.n} reportes.`);

    // 4. Configuración
    escribirEnv({ host, port, user, password, database });
    console.log(`  Configuración guardada en ${path.basename(ARCHIVO_ENV)} (con una clave de sesión nueva).`);

    // 5. Migraciones pendientes, con los mismos datos de conexión
    const m = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'migrar.js')], {
        cwd: RAIZ, encoding: 'utf8',
        env: { ...process.env, DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME: database }
    });
    console.log(m.status === 0 ? '  Migraciones: al día.' : '  Aviso: no se pudieron aplicar las migraciones (' + ((m.stderr || m.stdout || '').trim().split('\n').pop()) + ').');

    console.log(respaldo
        ? '\n  ✓ Instalación terminada. Abre "Iniciar SMS.bat" e inicia sesión con tu usuario.\n'
        : '\n  ✓ Instalación terminada. Abre "Iniciar SMS.bat". En la pantalla de acceso crea el primer\n    administrador con el "código de configuración inicial" que muestra la ventana del SMS.\n');
    if (rl) rl.close();
})().catch(e => salir(e.message));
