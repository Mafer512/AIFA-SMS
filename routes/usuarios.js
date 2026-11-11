/* ============================================================================
   Usuarios y permisos
   ----------------------------------------------------------------------------
   Configuración inicial (crear una cuenta de administrador sin tener sesión):
     GET  /api/auth/configuracion-inicial
     POST /api/auth/configuracion-inicial
     Solo desde la misma computadora del servidor y con el código de
     configuración que el servidor muestra en su terminal al iniciar. Quien
     tiene acceso a esa terminal ya tiene acceso a la base de datos, así que
     no se otorgan privilegios nuevos. El código cambia tras cada uso y tras
     5 intentos fallidos.

   Administración (rol admin):
     GET   /api/usuarios
     POST  /api/usuarios
     PATCH /api/usuarios/:id
     POST  /api/usuarios/:id/restablecer     nueva contraseña
     POST  /api/usuarios/:id/desbloquear

   Cuenta propia (con sesión):
     GET   /api/mi-cuenta
     PUT   /api/mi-cuenta/password
   ========================================================================= */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');

const usuarios = require('../lib/sms/usuarios');
const auditoria = require('../lib/sms/auditoria');
const respaldos = require('../lib/respaldos');
const { crearAutenticacion } = require('../lib/sms/permisos');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Petición hecha desde la misma computadora (no a través de un proxy). */
function esLocal(req) {
    const ip = req.socket && req.socket.remoteAddress;
    if (!LOOPBACK.has(ip)) return false;
    if (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers.forwarded || req.headers.via) return false;
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

module.exports = function crearRutasUsuarios({ dbPool, secreto }) {
    const router = express.Router();
    const auth = crearAutenticacion({ dbPool, secreto });
    const envolver = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const error = (res, e, codigo) => res.status(codigo || e.status || 400).json({ success: false, error: e.message || String(e) });

    // ------------------------------------------------ código de configuración
    let codigo = null;
    let fallos = 0;
    function rotarCodigo() {
        codigo = crypto.randomBytes(5).toString('hex').toUpperCase().replace(/^(.{5})(.{5})$/, '$1-$2');
        fallos = 0;
        if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
            console.log(`\n  [S.A.G.A.] Código de configuración inicial: ${codigo}`);
            console.log('  Úsalo en la pantalla de inicio de sesión, desde esta computadora, para crear una cuenta de administrador.\n');
        }
    }
    rotarCodigo();
    router.codigoConfiguracion = () => codigo; // solo para pruebas en el mismo proceso

    async function departamentos() {
        const [f] = await dbPool.query('SELECT id, codigo, nombre, activo FROM departamentos ORDER BY activo DESC, orden_display, nombre');
        return f.map(d => ({ id: d.id, codigo: d.codigo, nombre: d.nombre, activo: Boolean(d.activo) }));
    }

    function publico(u) {
        return {
            id: u.id, username: u.username, email: u.email, nombre: u.nombre, apellidos: u.apellidos,
            cargo: u.cargo, telefono: u.telefono, rol: u.rol, id_departamento: u.id_departamento,
            departamento: u.departamento, activo: Boolean(u.activo), ultimo_login: u.ultimo_login,
            bloqueado: Boolean(u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()),
            bloqueado_hasta: u.bloqueado_hasta, intentos_fallidos: Number(u.intentos_login_fallidos) || 0,
            debe_cambiar_password: Boolean(u.debe_cambiar_password), creado_en: u.creado_en
        };
    }

    async function cargar(id) {
        const [f] = await dbPool.query(
            `SELECT u.*, d.nombre AS departamento FROM usuarios_departamento u
             LEFT JOIN departamentos d ON d.id = u.id_departamento WHERE u.id = ?`, [id]);
        return f[0] || null;
    }

    // -------------------------------------------------------------- páginas
    router.get('/admin/usuarios', (req, res) => res.render('usuarios'));
    router.get('/mi-cuenta', (req, res) => res.render('mi_cuenta'));
    router.get('/admin/respaldos', (req, res) => res.render('respaldos'));

    // ------------------------------------------------- configuración inicial
    router.get('/api/auth/configuracion-inicial', envolver(async (req, res) => {
        const local = esLocal(req);
        res.json({
            success: true,
            disponible: local,
            administradores_activos: local ? await usuarios.adminsActivos(dbPool) : undefined,
            departamentos: local ? (await departamentos()).filter(d => d.activo) : undefined
        });
    }));

    router.post('/api/auth/configuracion-inicial', envolver(async (req, res) => {
        if (!esLocal(req)) return error(res, new Error('La configuración inicial solo está disponible desde la computadora del servidor'), 403);
        const b = req.body || {};
        if (!usuarios.igualesSeguro(String(b.codigo || '').trim().toUpperCase(), codigo)) {
            fallos++;
            if (fallos >= 5) rotarCodigo();
            return error(res, new Error(fallos === 0
                ? 'Código incorrecto. Por seguridad se generó un código nuevo en la terminal del servidor.'
                : 'Código de configuración incorrecto. Revísalo en la terminal del servidor.'), 403);
        }
        let datos;
        try {
            datos = usuarios.validarDatos({ ...b, rol: 'admin' });
            if (String(b.password || '') !== String(b.confirmacion || '')) throw new Error('Las contraseñas no coinciden');
        } catch (e) { return error(res, e); }
        let creado;
        try { creado = await usuarios.crear(dbPool, datos, b.password); } catch (e) { if (e.status) return error(res, e); throw e; }
        rotarCodigo();
        await auditoria.auditar(dbPool, {
            accion: 'usuario_creado',
            descripcion: `Cuenta de administrador "${datos.username}" creada en la configuración inicial (desde la computadora del servidor)`,
            usuario: null, req,
            datos: { id_usuario_creado: creado.id, username: datos.username, rol: 'admin', via: 'configuracion_inicial' }
        });
        res.status(201).json({ success: true, username: datos.username });
    }));

    // -------------------------------------------------------- administración
    router.get('/api/usuarios', auth.requiere('gestionar_usuarios'), envolver(async (req, res) => {
        const [f] = await dbPool.query(
            `SELECT u.*, d.nombre AS departamento FROM usuarios_departamento u
             LEFT JOIN departamentos d ON d.id = u.id_departamento
             ORDER BY u.activo DESC, u.nombre, u.username`);
        res.json({ success: true, usuarios: f.map(publico), departamentos: await departamentos(), roles: usuarios.ROLES, yo: req.usuario.id });
    }));

    router.post('/api/usuarios', auth.requiere('gestionar_usuarios'), envolver(async (req, res) => {
        const b = req.body || {};
        let datos;
        try { datos = usuarios.validarDatos(b); } catch (e) { return error(res, e); }
        const generada = !b.password;
        const password = generada ? usuarios.generarPassword() : String(b.password);
        let creado;
        try { creado = await usuarios.crear(dbPool, datos, password, { debeCambiar: true }); } catch (e) { if (e.status) return error(res, e); throw e; }
        await auditoria.auditar(dbPool, {
            accion: 'usuario_creado',
            descripcion: `Usuario "${datos.username}" (${usuarios.ROLES[datos.rol].nombre}) creado en ${creado.departamento}`,
            usuario: req.usuario, req,
            datos: { id_usuario_creado: creado.id, ...datos }
        });
        res.status(201).json({ success: true, id: creado.id, username: datos.username, password: generada ? password : undefined });
    }));

    router.patch('/api/usuarios/:id', auth.requiere('gestionar_usuarios'), envolver(async (req, res) => {
        const id = Number(req.params.id);
        const antes = await cargar(id);
        if (!antes) return error(res, new Error('Usuario no encontrado'), 404);
        let cambios;
        try { cambios = usuarios.validarDatos(req.body || {}, { parcial: true }); } catch (e) { return error(res, e); }
        delete cambios.username; // el usuario de acceso no se cambia (trazabilidad)
        if (!Object.keys(cambios).length) return error(res, new Error('No hay cambios que guardar'));
        const quitaAdmin = antes.rol === 'admin' && antes.activo && ((cambios.rol && cambios.rol !== 'admin') || cambios.activo === 0);
        if (id === req.usuario.id && (cambios.activo === 0 || (cambios.rol && cambios.rol !== antes.rol))) {
            return error(res, new Error('No puedes desactivar tu propia cuenta ni cambiar tu propio rol'));
        }
        if (quitaAdmin && (await usuarios.adminsActivos(dbPool, { excepto: id })) === 0) {
            return error(res, new Error('Debe quedar al menos un administrador activo'));
        }
        if (cambios.id_departamento) {
            const [d] = await dbPool.query('SELECT id FROM departamentos WHERE id = ?', [cambios.id_departamento]);
            if (!d.length) return error(res, new Error('El área elegida no existe'));
        }
        try {
            await dbPool.query('UPDATE usuarios_departamento SET ? WHERE id = ?', [cambios, id]);
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return error(res, new Error('Ya existe una cuenta con ese correo'), 409);
            throw e;
        }
        const previo = {};
        Object.keys(cambios).forEach(k => { previo[k] = antes[k]; });
        await auditoria.auditar(dbPool, {
            accion: cambios.activo === 0 ? 'usuario_desactivado' : cambios.activo === 1 && !antes.activo ? 'usuario_reactivado' : 'usuario_actualizado',
            descripcion: `Usuario "${antes.username}": ${Object.keys(cambios).join(', ')}`,
            usuario: req.usuario, req,
            datos: { id_usuario_afectado: id, antes: previo, despues: cambios }
        });
        res.json({ success: true, usuario: publico(await cargar(id)) });
    }));

    router.post('/api/usuarios/:id/restablecer', auth.requiere('gestionar_usuarios'), envolver(async (req, res) => {
        const u = await cargar(Number(req.params.id));
        if (!u) return error(res, new Error('Usuario no encontrado'), 404);
        const b = req.body || {};
        const generada = !b.password;
        const password = generada ? usuarios.generarPassword() : String(b.password);
        const problema = usuarios.problemaPassword(password, { usuario: u.username, nombre: u.nombre });
        if (problema) return error(res, new Error(problema));
        await dbPool.query(
            `UPDATE usuarios_departamento SET password_hash = ?, debe_cambiar_password = 1, fecha_cambio_password = NOW(),
                    intentos_login_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?`,
            [await usuarios.hashPassword(password), u.id]);
        await auditoria.auditar(dbPool, {
            accion: 'password_restablecida',
            descripcion: `Contraseña restablecida para "${u.username}"`,
            usuario: req.usuario, req, datos: { id_usuario_afectado: u.id }
        });
        res.json({ success: true, password: generada ? password : undefined });
    }));

    router.post('/api/usuarios/:id/desbloquear', auth.requiere('gestionar_usuarios'), envolver(async (req, res) => {
        const u = await cargar(Number(req.params.id));
        if (!u) return error(res, new Error('Usuario no encontrado'), 404);
        await dbPool.query('UPDATE usuarios_departamento SET intentos_login_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [u.id]);
        await auditoria.auditar(dbPool, {
            accion: 'usuario_desbloqueado', descripcion: `Usuario "${u.username}" desbloqueado`,
            usuario: req.usuario, req, datos: { id_usuario_afectado: u.id }
        });
        res.json({ success: true });
    }));

    // ------------------------------------------------------------ mi cuenta
    router.get('/api/mi-cuenta', auth.requiere(), envolver(async (req, res) => {
        const u = await cargar(req.usuario.id);
        res.json({ success: true, usuario: publico(u), rol_nombre: (usuarios.ROLES[u.rol] || {}).nombre });
    }));

    router.put('/api/mi-cuenta/password', auth.requiere(), envolver(async (req, res) => {
        const b = req.body || {};
        const u = await cargar(req.usuario.id);
        if (!(await bcrypt.compare(String(b.actual || ''), u.password_hash))) return error(res, new Error('La contraseña actual no es correcta'));
        if (String(b.nueva || '') !== String(b.confirmacion || '')) return error(res, new Error('La confirmación no coincide con la nueva contraseña'));
        if (String(b.nueva) === String(b.actual)) return error(res, new Error('La nueva contraseña debe ser distinta de la actual'));
        const problema = usuarios.problemaPassword(b.nueva, { usuario: u.username, nombre: u.nombre });
        if (problema) return error(res, new Error(problema));
        await dbPool.query('UPDATE usuarios_departamento SET password_hash = ?, debe_cambiar_password = 0, fecha_cambio_password = NOW() WHERE id = ?',
            [await usuarios.hashPassword(b.nueva), u.id]);
        await auditoria.auditar(dbPool, { accion: 'password_cambiada', descripcion: `"${u.username}" cambió su contraseña`, usuario: req.usuario, req, datos: {} });
        res.json({ success: true });
    }));

    // ------------------------------------------------------------ respaldos
    router.get('/api/sistema/respaldos', auth.requiere('gestionar_respaldos'), envolver(async (req, res) => {
        res.json({
            success: true,
            respaldos: respaldos.listar(),
            carpeta: respaldos.carpeta(),
            conservar: respaldos.conservar(),
            automatico: process.env.RESPALDO_AUTOMATICO !== '0',
            mysqldump: Boolean(respaldos.buscarMysqldump())
        });
    }));

    router.post('/api/sistema/respaldos', auth.requiere('gestionar_respaldos'), envolver(async (req, res) => {
        let r;
        try { r = await respaldos.respaldar(); } catch (e) { return error(res, e, 500); }
        await auditoria.auditar(dbPool, {
            accion: 'respaldo_creado', descripcion: `Respaldo manual de la base de datos: ${r.archivo}`,
            usuario: req.usuario, req, datos: { archivo: r.archivo, bytes: r.bytes, eliminados: r.eliminados }
        });
        res.status(201).json({ success: true, archivo: r.archivo, bytes: r.bytes });
    }));

    router.use(['/api/usuarios', '/api/mi-cuenta', '/api/auth/configuracion-inicial', '/api/sistema'], (err, req, res, next) => {
        console.error('Error en usuarios:', err);
        res.status(500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message });
    });

    return router;
};
