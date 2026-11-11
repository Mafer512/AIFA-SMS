/* ============================================================================
   Permisos por rol (usuarios_departamento.rol)
   ----------------------------------------------------------------------------
   viewer      consulta información interna de su área
   editor      además registra y actualiza acciones correctivas, fechas
               compromiso y zonas de los reportes de su área
   supervisor  alcance global: evalúa riesgo, verifica y cancela acciones
   admin       todo lo anterior + configuración de matriz, SPI y zonas
   ========================================================================= */
'use strict';

const jwt = require('jsonwebtoken');

const ROLES = ['viewer', 'editor', 'supervisor', 'admin'];

const CAPACIDADES = {
    ver_interno:        ['viewer', 'editor', 'supervisor', 'admin'],
    registrar_accion:   ['editor', 'supervisor', 'admin'],
    actualizar_accion:  ['editor', 'supervisor', 'admin'],
    verificar_accion:   ['supervisor', 'admin'],
    cancelar_accion:    ['supervisor', 'admin'],
    evaluar_riesgo:     ['supervisor', 'admin'],
    asignar_compromiso: ['editor', 'supervisor', 'admin'], // editor: solo su área en reportes de su área
    asignar_zona:       ['editor', 'supervisor', 'admin'], // editor: solo reportes de su área
    exportar_detalle:   ['supervisor', 'admin'],
    ver_auditoria:      ['supervisor', 'admin'],
    configurar_matriz:  ['admin'],
    configurar_spi:     ['admin'],
    configurar_zonas:   ['admin'],
    eliminar_reporte:   ['admin'],
    gestionar_usuarios: ['admin'],
    gestionar_respaldos: ['admin'],                         // con copia de respaldo y restauración
    alcance_global:     ['supervisor', 'admin']
};

function puede(usuario, capacidad) {
    return Boolean(usuario && CAPACIDADES[capacidad] && CAPACIDADES[capacidad].includes(usuario.rol));
}

function capacidadesDe(usuario) {
    return Object.keys(CAPACIDADES).filter(c => puede(usuario, c));
}

/**
 * Middleware de autenticación. El token se valida y además se consulta el
 * usuario en la BD, para que un usuario desactivado o con rol cambiado no
 * conserve permisos viejos mientras su token siga vigente.
 */
function crearAutenticacion({ dbPool, secreto }) {
    async function leerUsuario(req) {
        const encabezado = req.headers.authorization || '';
        const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7).trim() : '';
        if (!token) return null;
        let datos;
        try {
            datos = jwt.verify(token, secreto);
        } catch (e) {
            return null;
        }
        const [filas] = await dbPool.query(
            `SELECT u.id, u.username, u.nombre, u.apellidos, u.rol, u.id_departamento,
                    d.nombre AS departamento_nombre, d.codigo AS departamento_codigo
             FROM usuarios_departamento u
             LEFT JOIN departamentos d ON d.id = u.id_departamento
             WHERE u.id = ? AND u.activo = 1
               AND (u.bloqueado_hasta IS NULL OR u.bloqueado_hasta <= NOW())
             LIMIT 1`,
            [datos.id]
        );
        if (!filas.length) return null;
        const u = filas[0];
        return {
            id: u.id,
            username: u.username,
            nombre: [u.nombre, u.apellidos].filter(Boolean).join(' '),
            rol: ROLES.includes(u.rol) ? u.rol : 'viewer',
            id_departamento: u.id_departamento,
            departamento: u.departamento_nombre,
            departamento_codigo: u.departamento_codigo
        };
    }

    /** Adjunta req.usuario si hay un token válido; nunca bloquea. */
    function opcional(req, res, next) {
        leerUsuario(req)
            .then(u => { req.usuario = u; next(); })
            .catch(next);
    }

    /** Exige sesión y, opcionalmente, una capacidad. */
    function requiere(capacidad) {
        return (req, res, next) => {
            leerUsuario(req)
                .then(u => {
                    if (!u) return res.status(401).json({ success: false, error: 'Inicia sesión para continuar' });
                    if (capacidad && !puede(u, capacidad)) {
                        return res.status(403).json({ success: false, error: 'Tu rol no tiene permiso para esta acción' });
                    }
                    req.usuario = u;
                    next();
                })
                .catch(next);
        };
    }

    return { opcional, requiere, leerUsuario };
}

/** ¿El usuario puede gestionar (no solo ver) el reporte? */
async function puedeGestionarReporte(db, usuario, idReporte) {
    if (!usuario) return false;
    if (puede(usuario, 'alcance_global')) return true;
    const [filas] = await db.query(
        'SELECT 1 FROM reporte_departamento WHERE id_reporte = ? AND id_departamento = ? LIMIT 1',
        [idReporte, usuario.id_departamento]
    );
    return filas.length > 0;
}

module.exports = { ROLES, CAPACIDADES, puede, capacidadesDe, crearAutenticacion, puedeGestionarReporte };
