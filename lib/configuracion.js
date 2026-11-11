/* ============================================================================
   Configuración sensible del servidor
   ----------------------------------------------------------------------------
   - secretoJWT(): clave con la que se firman las sesiones. En producción
     (NODE_ENV=production) es obligatoria y debe ser larga y aleatoria; sin
     ella cualquiera podría fabricar una sesión válida. En desarrollo se
     conserva el valor de respaldo para no romper instalaciones locales.
   - carpetaUploads(): dónde se guardan las fotos de evidencia. En un
     servidor conviene una carpeta fuera del código (UPLOADS_DIR) para que
     no se pierda al actualizar la aplicación.
   ========================================================================= */
'use strict';

const path = require('path');

const RAIZ = path.join(__dirname, '..');
const LONGITUD_MINIMA = 32;
const CLAVES_DE_EJEMPLO = new Set(['secret_key', 'cambia-esta-clave', 'changeme', 'secret']);

function esProduccion(env = process.env) {
    return env.NODE_ENV === 'production';
}

function problemaSecreto(valor) {
    const s = String(valor || '').trim();
    if (!s) return 'no está definida';
    if (CLAVES_DE_EJEMPLO.has(s)) return 'es la clave de ejemplo';
    if (s.length < LONGITUD_MINIMA) return `tiene menos de ${LONGITUD_MINIMA} caracteres`;
    return null;
}

function secretoJWT(env = process.env) {
    const problema = problemaSecreto(env.JWT_SECRET);
    if (problema && esProduccion(env)) {
        throw new Error(`JWT_SECRET ${problema}. En producción debe ser una clave aleatoria de al menos ${LONGITUD_MINIMA} caracteres; genera una con: npm run generar-clave`);
    }
    return String(env.JWT_SECRET || '').trim() || 'secret_key';
}

function carpetaUploads(env = process.env) {
    return env.UPLOADS_DIR ? path.resolve(RAIZ, env.UPLOADS_DIR) : path.join(RAIZ, 'uploads');
}

module.exports = { esProduccion, problemaSecreto, secretoJWT, carpetaUploads, LONGITUD_MINIMA };
