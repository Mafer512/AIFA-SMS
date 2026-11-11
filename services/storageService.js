// Servicio de almacenamiento local de imágenes
// ============================================
// Guarda la imagen original y genera dos versiones WebP:
//   - optimizada: para ver en pantalla completa
//   - thumbnail:  miniatura para galerías
//
// Devuelve las rutas RELATIVAS a /uploads (las que se guardan en la BD)
// y las URLs públicas listas para usarse en el navegador.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const config = require('../config/storage.config');

const { carpetas, imagen, limites, tiposPermitidos } = config;

// Utilidades
// ==========

// Solo letras, números y guiones: evita rutas maliciosas tipo "../../"
function limpiarSegmento(texto, nombreCampo) {
  const limpio = String(texto || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
  if (!limpio) {
    throw new Error(`${nombreCampo} inválido`);
  }
  return limpio;
}

// Ruta relativa con "/" (funciona igual en Windows y Linux, y sirve como URL)
function rutaRelativa(...segmentos) {
  return path.posix.join(...segmentos);
}

// Convierte una ruta relativa guardada en BD (con "/" o "\") a ruta absoluta
// dentro de /uploads. Lanza error si intenta salir de esa carpeta.
function rutaAbsoluta(relativa) {
  const normalizada = String(relativa || '').replace(/\\/g, '/');
  const absoluta = path.resolve(config.uploadsDir, normalizada);
  const base = path.resolve(config.uploadsDir) + path.sep;
  if (!absoluta.startsWith(base)) {
    throw new Error('Ruta de archivo fuera de la carpeta de uploads');
  }
  return absoluta;
}

function urlPublica(relativa) {
  return `${config.publicPath}/${relativa}`;
}

function extensionPara(mimeType, nombreOriginal) {
  if (tiposPermitidos[mimeType]) return tiposPermitidos[mimeType];
  const ext = path.extname(nombreOriginal || '').toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.bin';
}

// Ancho/alto ya corregidos por la orientación EXIF (fotos de celular)
function dimensionesReales(meta) {
  const girada = meta.orientation && meta.orientation >= 5;
  return {
    ancho: girada ? meta.height : meta.width,
    alto: girada ? meta.width : meta.height
  };
}

async function borrarSilencioso(rutas) {
  await Promise.all(rutas.map(r => fs.unlink(r).catch(() => {})));
}

// Núcleo: procesa y guarda una imagen en la carpeta indicada
// ==========================================================
async function guardarImagen({ buffer, nombreOriginal, mimeType, carpetaBase, prefijoNombre, orden }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('El archivo está vacío');
  }

  // Validar que realmente sea una imagen que sharp puede leer
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: limites.maxPixeles }).metadata();
  } catch (e) {
    throw new Error(`"${nombreOriginal}" no es una imagen válida`);
  }

  const timestamp = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  const nombreBase = `${prefijoNombre.toLowerCase()}_${orden}_${timestamp}_${hash}`;
  const extOriginal = extensionPara(mimeType, nombreOriginal);

  const relOriginal = rutaRelativa(carpetaBase, carpetas.originales, nombreBase + extOriginal);
  const relOptimizada = rutaRelativa(carpetaBase, carpetas.optimizadas, nombreBase + '.webp');
  const relThumbnail = rutaRelativa(carpetaBase, carpetas.thumbnails, nombreBase + '.webp');

  const absOriginal = rutaAbsoluta(relOriginal);
  const absOptimizada = rutaAbsoluta(relOptimizada);
  const absThumbnail = rutaAbsoluta(relThumbnail);

  await Promise.all([
    fs.mkdir(path.dirname(absOriginal), { recursive: true }),
    fs.mkdir(path.dirname(absOptimizada), { recursive: true }),
    fs.mkdir(path.dirname(absThumbnail), { recursive: true })
  ]);

  try {
    // 1) Original tal cual se recibió
    await fs.writeFile(absOriginal, buffer);

    // 2) Versión optimizada (corrige orientación, limita tamaño, WebP)
    await sharp(buffer, { limitInputPixels: limites.maxPixeles })
      .rotate()
      .resize({
        width: imagen.optimizada.maxAncho,
        height: imagen.optimizada.maxAlto,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: imagen.optimizada.calidad })
      .toFile(absOptimizada);

    // 3) Miniatura
    await sharp(buffer, { limitInputPixels: limites.maxPixeles })
      .rotate()
      .resize({
        width: imagen.thumbnail.ancho,
        height: imagen.thumbnail.alto,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: imagen.thumbnail.calidad })
      .toFile(absThumbnail);
  } catch (error) {
    // No dejar archivos a medias si algo falla
    await borrarSilencioso([absOriginal, absOptimizada, absThumbnail]);
    throw new Error(`No se pudo procesar "${nombreOriginal}": ${error.message}`);
  }

  const { ancho, alto } = dimensionesReales(meta);

  return {
    ruta_original: relOriginal,
    ruta_optimizada: relOptimizada,
    ruta_thumbnail: relThumbnail,
    url_original: urlPublica(relOriginal),
    url_optimizada: urlPublica(relOptimizada),
    url_thumbnail: urlPublica(relThumbnail),
    nombre_original: nombreOriginal,
    nombre_unico: nombreBase + extOriginal,
    tipo_mime: mimeType,
    tamano_bytes_original: buffer.length,
    ancho_pixels: ancho || null,
    alto_pixels: alto || null
  };
}

function carpetaDelReporte(folio) {
  const ahora = new Date();
  const anio = String(ahora.getFullYear());
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  return rutaRelativa(carpetas.raiz, anio, mes, limpiarSegmento(folio, 'Folio'));
}

// API pública
// ===========

/**
 * Sube una imagen de un reporte.
 * Uso en app.js: uploadImage(buffer, nombre, mime, folio, 'reportes', orden)
 */
async function uploadImage(buffer, nombreOriginal, mimeType, folio, categoria = 'reportes', orden = 1) {
  const folioLimpio = limpiarSegmento(folio, 'Folio');
  return guardarImagen({
    buffer,
    nombreOriginal,
    mimeType,
    carpetaBase: carpetaDelReporte(folioLimpio),
    prefijoNombre: folioLimpio,
    orden
  });
}

/**
 * Sube una imagen de un seguimiento.
 * Uso en app.js: uploadImageSeguimiento(buffer, nombre, mime, folioReporte, folioSeguimiento, orden)
 */
async function uploadImageSeguimiento(buffer, nombreOriginal, mimeType, folioReporte, folioSeguimiento, orden = 1) {
  const folioSeg = limpiarSegmento(folioSeguimiento, 'Folio de seguimiento');
  return guardarImagen({
    buffer,
    nombreOriginal,
    mimeType,
    carpetaBase: rutaRelativa(carpetaDelReporte(folioReporte), carpetas.seguimientos, folioSeg),
    prefijoNombre: folioSeg,
    orden
  });
}

/**
 * Elimina la imagen original y sus versiones optimizada y miniatura.
 * Recibe la ruta_original guardada en la BD.
 * Devuelve true si los archivos ya no existen en disco (borrados o ausentes).
 */
async function deleteImage(rutaOriginal) {
  try {
    const normalizada = String(rutaOriginal || '').replace(/\\/g, '/');
    if (!normalizada) return false;

    const sepOriginales = `/${carpetas.originales}/`;
    const rutas = [rutaAbsoluta(normalizada)];

    if (normalizada.includes(sepOriginales)) {
      const sinExt = normalizada.replace(/\.[^/.]+$/, '');
      rutas.push(rutaAbsoluta(sinExt.replace(sepOriginales, `/${carpetas.optimizadas}/`) + '.webp'));
      rutas.push(rutaAbsoluta(sinExt.replace(sepOriginales, `/${carpetas.thumbnails}/`) + '.webp'));
    }

    for (const ruta of rutas) {
      try {
        await fs.unlink(ruta);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error; // si ya no existe, está bien
      }
    }
    return true;
  } catch (error) {
    console.error('Error eliminando imagen:', error.message);
    return false;
  }
}

module.exports = {
  uploadImage,
  uploadImageSeguimiento,
  deleteImage
};
