/* ============================================================================
   Alta de usuarios desde la terminal (alternativa a /admin/usuarios).
   Uso:
     node scripts/crear-usuario.js --usuario jlopez --nombre "Juan López" \
          --correo jlopez@aifa.aero --rol editor --departamento dir_operacion
   Opcional: --password "..." (si no se indica, se genera una segura y se
   muestra UNA sola vez). Roles: viewer, editor, supervisor, admin.
   Usa la base de datos indicada en .env (o la variable DB_NAME).
   Aplica las mismas reglas que la pantalla de administración.
   ========================================================================= */
'use strict';

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const usuarios = require('../lib/sms/usuarios');

function args() {
    const out = {};
    const a = process.argv.slice(2);
    for (let i = 0; i < a.length; i++) {
        if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    }
    return out;
}

(async () => {
    const o = args();
    const faltan = ['usuario', 'nombre', 'correo', 'rol', 'departamento'].filter(k => !o[k] || o[k] === true);
    if (faltan.length) {
        console.error('Faltan datos: ' + faltan.map(f => '--' + f).join(', '));
        process.exit(1);
    }
    const generada = !o.password || o.password === true;
    const password = generada ? usuarios.generarPassword() : String(o.password);

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'aifa_rsm'
    });
    try {
        const [d] = await conn.query('SELECT id, nombre FROM departamentos WHERE codigo = ? LIMIT 1', [o.departamento]);
        if (!d.length) throw new Error(`No existe el departamento con código "${o.departamento}"`);
        const datos = usuarios.validarDatos({ nombre: o.nombre, username: o.usuario, email: o.correo, rol: o.rol, id_departamento: d[0].id });
        await usuarios.crear(conn, datos, password, { debeCambiar: generada });
        console.log(`Usuario "${datos.username}" creado (${datos.rol}) en ${d[0].nombre} · base ${process.env.DB_NAME || 'aifa_rsm'}.`);
        if (generada) console.log(`Contraseña generada (cópiala ahora, no se vuelve a mostrar): ${password}`);
    } catch (e) {
        console.error('No se pudo crear el usuario:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
