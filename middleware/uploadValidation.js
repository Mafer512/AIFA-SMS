// Middleware de subida y validación de imágenes
// =============================================
// - upload:             instancia de multer (archivos en memoria, los guarda storageService)
// - validateImageFiles: verifica que cada archivo sea realmente una imagen
// - handleMulterError:  convierte errores de multer en respuestas JSON claras

const multer = require('multer');
const sharp = require('sharp');
const config = require('../config/storage.config');

const { limites, tiposPermitidos } = config;
const FORMATOS_VALIDOS = new Set(['jpeg', 'png', 'webp', 'gif']);

// Multer
// ======
// Los archivos que no son imagen (por ejemplo, videos) se omiten en lugar de
// cancelar toda la subida, para no perder las fotos que sí son válidas.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: limites.maxImageSize,
    files: limites.maxFilesPorReporte
  },
  fileFilter: (req, file, cb) => {
    if (tiposPermitidos[file.mimetype]) {
      return cb(null, true);
    }
    req.archivosRechazados = req.archivosRechazados || [];
    req.archivosRechazados.push(file.originalname);
    console.warn(`Archivo omitido (tipo no permitido ${file.mimetype}): ${file.originalname}`);
    cb(null, false);
  }
});

// Validación del contenido real
// =============================
async function validateImageFiles(req, res, next) {
  const archivos = req.files || [];
  const rechazados = req.archivosRechazados || [];

  if (archivos.length === 0 && rechazados.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Solo se aceptan imágenes JPG, PNG, WEBP o GIF. Archivos no permitidos: ${rechazados.join(', ')}`
    });
  }

  try {
    for (const archivo of archivos) {
      let meta;
      try {
        meta = await sharp(archivo.buffer, { limitInputPixels: limites.maxPixeles }).metadata();
      } catch (e) {
        meta = null;
      }

      if (!meta || !FORMATOS_VALIDOS.has(meta.format)) {
        return res.status(400).json({
          success: false,
          error: `"${archivo.originalname}" no es una imagen válida`
        });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

// Errores de multer
// =================
const MENSAJES_MULTER = {
  LIMIT_FILE_SIZE: `Una imagen excede el tamaño máximo de ${Math.round(limites.maxImageSize / 1024 / 1024)} MB`,
  LIMIT_FILE_COUNT: `Solo se permiten ${limites.maxFilesPorReporte} archivos por envío`,
  LIMIT_UNEXPECTED_FILE: 'Se enviaron más archivos de los permitidos o en un campo no esperado',
  LIMIT_PART_COUNT: 'El formulario tiene demasiadas partes',
  LIMIT_FIELD_KEY: 'Nombre de campo demasiado largo',
  LIMIT_FIELD_VALUE: 'Valor de campo demasiado largo',
  LIMIT_FIELD_COUNT: 'Demasiados campos en el formulario'
};

function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    console.warn('Error de subida:', err.code, err.field || '');
    return res.status(400).json({
      success: false,
      error: MENSAJES_MULTER[err.code] || `Error al subir archivos (${err.code})`
    });
  }
  next(err);
}

module.exports = {
  upload,
  validateImageFiles,
  handleMulterError
};
