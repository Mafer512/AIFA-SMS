// Configuración de almacenamiento local de archivos
// =================================================
// Las imágenes se guardan en /uploads con esta estructura
// (la misma que ya usan los registros de la base de datos):
//
//   reportes/AAAA/MM/<FOLIO>/originales/<folio>_<orden>_<timestamp>_<hash>.<ext>
//   reportes/AAAA/MM/<FOLIO>/optimizadas/<...>.webp
//   reportes/AAAA/MM/<FOLIO>/thumbnails/<...>.webp
//
//   reportes/AAAA/MM/<FOLIO>/seguimientos/<FOLIO-SEG>/originales/...
//   reportes/AAAA/MM/<FOLIO>/seguimientos/<FOLIO-SEG>/optimizadas/...
//   reportes/AAAA/MM/<FOLIO>/seguimientos/<FOLIO-SEG>/thumbnails/...

const path = require('path');
require('dotenv').config();

const MB = 1024 * 1024;

function numeroEnv(nombre, valorDefecto) {
  const valor = parseInt(process.env[nombre], 10);
  return Number.isFinite(valor) && valor > 0 ? valor : valorDefecto;
}

module.exports = {
  // Carpeta física donde se guardan los archivos (servida en /uploads por app.js).
  // En un servidor se puede llevar fuera del código con UPLOADS_DIR.
  uploadsDir: require('../lib/configuracion').carpetaUploads(),
  publicPath: '/uploads',

  // Nombres de subcarpetas
  carpetas: {
    raiz: 'reportes',
    seguimientos: 'seguimientos',
    originales: 'originales',
    optimizadas: 'optimizadas',
    thumbnails: 'thumbnails'
  },

  // Límites
  limites: {
    maxImageSize: numeroEnv('MAX_IMAGE_SIZE_MB', 10) * MB,
    maxFilesPorReporte: numeroEnv('MAX_FILES_PER_REPORT', 5),
    maxFilesPorSeguimiento: 3,
    maxPixeles: 100 * 1000 * 1000 // evita imágenes "bomba" de descompresión
  },

  // Tipos aceptados (sharp los puede procesar todos)
  tiposPermitidos: {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/pjpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
  },

  // Procesamiento de imágenes
  imagen: {
    optimizada: { maxAncho: 1920, maxAlto: 1920, calidad: 82 },
    thumbnail: { ancho: 400, alto: 400, calidad: 70 }
  }
};
