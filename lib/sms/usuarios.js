/* ============================================================================
   Usuarios del sistema (tabla existente usuarios_departamento).
   Reglas compartidas por la pantalla de administración, la configuración
   inicial y el script scripts/crear-usuario.js.
   - Contraseñas con bcrypt (costo 12), igual que el inicio de sesión existente.
   - Los usuarios no se eliminan: se desactivan (conservan su historial).
   - Siempre debe quedar al menos un administrador activo.
   ========================================================================= */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const ROLES = {
    viewer: { nombre: 'Consulta', descripcion: 'Consulta la información interna de los reportes de su área.' },
    editor: { nombre: 'Editor de área', descripcion: 'Además registra acciones, fechas compromiso y seguimientos de su área.' },
    supervisor: { nombre: 'Supervisión SMS', descripcion: 'Todas las áreas: evalúa riesgo, verifica y cancela acciones, consulta la bitácora.' },
    admin: { nombre: 'Administrador', descripcion: 'Todo lo anterior: usuarios, matriz de riesgo, SPI, zonas y eliminación de reportes.' }
};

const USUARIO_RE = /^[a-zA-Z0-9._-]{3,60}$/;
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function sinAcentos(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** "Fabrizio Pizano Ruiz" → "fabrizio.pizano" */
function sugerirUsuario(nombre, apellidos) {
    const partes = sinAcentos([nombre, apellidos].filter(Boolean).join(' ')).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (!partes.length) return '';
    return (partes.length > 1 ? partes[0] + '.' + partes[1] : partes[0]).slice(0, 60);
}

/** Contraseña aleatoria legible (sin caracteres ambiguos), con letras y números. */
function generarPassword(largo = 14) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let p = '';
    while (!(/[A-Za-z]/.test(p) && /\d/.test(p)) || p.length !== largo) {
        p = Array.from(crypto.randomBytes(largo), b => abc[b % abc.length]).join('');
    }
    return p;
}

/** Devuelve un mensaje de error o null si la contraseña es aceptable. */
function problemaPassword(p, { usuario = '', nombre = '' } = {}) {
    const t = String(p || '');
    if (t.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
    if (t.length > 128) return 'La contraseña admite máximo 128 caracteres';
    if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return 'La contraseña debe combinar letras y números';
    const baja = t.toLowerCase();
    if (usuario && baja.includes(String(usuario).toLowerCase())) return 'La contraseña no debe contener el nombre de usuario';
    const primerNombre = sinAcentos(nombre).toLowerCase().split(/\s+/)[0];
    if (primerNombre && primerNombre.length >= 4 && sinAcentos(baja).includes(primerNombre)) return 'La contraseña no debe contener tu nombre';
    if (/^(.)\1+$/.test(t) || /^(1234567890|0987654321|qwertyuiop|contrase(ñ|n)a)/i.test(t)) return 'Elige una contraseña menos predecible';
    return null;
}

/** Valida y normaliza los datos de un usuario. parcial = solo los campos enviados. */
function validarDatos(b = {}, { parcial = false } = {}) {
    const out = {};
    const tiene = k => b[k] !== undefined;
    const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    if (!parcial || tiene('nombre')) {
        const n = txt(b.nombre, 150);
        if (n.length < 2) throw new Error('El nombre es obligatorio');
        out.nombre = n;
    }
    if (!parcial || tiene('apellidos')) out.apellidos = txt(b.apellidos, 200) || null;
    if (!parcial || tiene('username')) {
        const u = txt(b.username, 60);
        if (!USUARIO_RE.test(u)) throw new Error('El usuario admite de 3 a 60 caracteres: letras, números, punto, guion y guion bajo (sin espacios)');
        out.username = u;
    }
    if (!parcial || tiene('email')) {
        const c = txt(b.email, 255).toLowerCase();
        if (!CORREO_RE.test(c)) throw new Error('Escribe un correo electrónico válido');
        out.email = c;
    }
    if (!parcial || tiene('rol')) {
        if (!ROLES[b.rol]) throw new Error('Elige un rol válido');
        out.rol = b.rol;
    }
    if (!parcial || tiene('id_departamento')) {
        const d = Number(b.id_departamento);
        if (!Number.isInteger(d) || d < 1) throw new Error('Elige el área del usuario');
        out.id_departamento = d;
    }
    if (tiene('cargo')) out.cargo = txt(b.cargo, 100) || null;
    if (tiene('telefono')) out.telefono = txt(b.telefono, 30) || null;
    if (tiene('activo')) out.activo = b.activo ? 1 : 0;
    return out;
}

async function hashPassword(p) { return bcrypt.hash(String(p), 12); }

/** Inserta un usuario. Lanza errores claros (duplicados, área inexistente). */
async function crear(db, datos, password, { debeCambiar = false } = {}) {
    const [d] = await db.query('SELECT id, nombre FROM departamentos WHERE id = ? LIMIT 1', [datos.id_departamento]);
    if (!d.length) throw Object.assign(new Error('El área elegida no existe'), { status: 400 });
    const problema = problemaPassword(password, { usuario: datos.username, nombre: datos.nombre });
    if (problema) throw Object.assign(new Error(problema), { status: 400 });
    try {
        const [r] = await db.query(
            `INSERT INTO usuarios_departamento
                (id_departamento, username, email, password_hash, nombre, apellidos, cargo, telefono, rol, activo, debe_cambiar_password, fecha_cambio_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
            [datos.id_departamento, datos.username, datos.email, await hashPassword(password), datos.nombre, datos.apellidos || null,
             datos.cargo || null, datos.telefono || null, datos.rol, debeCambiar ? 1 : 0]);
        return { id: r.insertId, departamento: d[0].nombre };
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            const campo = /email/i.test(e.message) ? 'correo' : 'usuario';
            throw Object.assign(new Error(`Ya existe una cuenta con ese ${campo}`), { status: 409 });
        }
        throw e;
    }
}

async function adminsActivos(db, { excepto = null } = {}) {
    const [[{ n }]] = await db.query(
        `SELECT COUNT(*) AS n FROM usuarios_departamento WHERE rol = 'admin' AND activo = 1${excepto ? ' AND id <> ?' : ''}`,
        excepto ? [excepto] : []);
    return Number(n);
}

/** Comparación en tiempo constante (para el código de configuración inicial). */
function igualesSeguro(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = {
    ROLES, sugerirUsuario, generarPassword, problemaPassword, validarDatos,
    hashPassword, crear, adminsActivos, igualesSeguro
};
