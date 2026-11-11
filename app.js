
// Sistema de Reportes Rápidos (RSM) - Backend Node.js/Express
// ===========================================================

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const path = require('path');


const rateLimit = require('express-rate-limit');
const validator = require('validator');
const helmet = require('helmet');
const compression = require('compression');
const dotenv = require('dotenv');


// IMPORTS PARA ALMACENAMIENTO LOCAL
// =================================
const storageService = require('./services/storageService');
const { upload, validateImageFiles, handleMulterError } = require('./middleware/uploadValidation');
const storageConfig = require('./config/storage.config');

// Cargar variables de entorno
dotenv.config();

// Módulo SMS (riesgo, acciones correctivas, notificaciones, análisis)
const crearRutasSMS = require('./routes/sms');
const crearRutasUsuarios = require('./routes/usuarios');
const smsAcciones = require('./lib/sms/acciones');
const smsNotificaciones = require('./lib/sms/notificaciones');
const smsClasificacion = require('./lib/sms/clasificacion');
const smsRiesgo = require('./lib/sms/riesgo');
const { crearAutenticacion: smsCrearAutenticacion } = require('./lib/sms/permisos');
const configuracion = require('./lib/configuracion');
let JWT_SECRET;
try {
  JWT_SECRET = configuracion.secretoJWT();
} catch (e) {
  console.error('[S.A.G.A.] No se puede iniciar: ' + e.message);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;





// Conexiones MySQL
// ================
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aifa_rms',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
const smsAuth = smsCrearAutenticacion({ dbPool, secreto: JWT_SECRET });
app.locals.dbPool = dbPool;


// Middleware
// ==========
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      // Las vistas usan onclick/onerror en el HTML; sin esto el navegador los bloquea
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      // Forzar HTTPS solo en producción; en la red local se usa http://
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
}));
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

// Confiar en proxies (ngrok)
app.set('trust proxy', 1);

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Servir archivos de uploads de forma estática.
// Solo imágenes: cualquier otro tipo de archivo que llegara a existir en la
// carpeta no se entrega, y se impide que el navegador lo interprete como otra cosa.
const EXT_IMAGEN_PUBLICA = /\.(jpe?g|png|webp|gif)$/i;
app.use('/uploads', (req, res, next) => {
  if (!EXT_IMAGEN_PUBLICA.test(req.path) || req.path.includes('..')) {
    return res.status(404).end();
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  next();
}, express.static(storageConfig.uploadsDir, { index: false, dotfiles: 'deny' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


// Rate Limiting
// =============
const createReportLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: process.env.NODE_ENV === 'production' ? 5 : 1000,
  message: { success: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }
});

const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 1000,
  message: { success: false, error: 'Demasiados archivos subidos. Intenta más tarde.' }
});


// Funciones auxiliares
// ====================

// Generar siguiente folio
async function generarSiguienteFolio(connection) {
  // Considera también los reportes eliminados (archivo de respaldo):
  // un folio nunca se vuelve a asignar, para no confundir la trazabilidad.
  try {
    const [[fila]] = await connection.execute(
      `SELECT MAX(n) AS n FROM (
         SELECT CAST(SUBSTRING(folio, 5) AS UNSIGNED) AS n FROM reportes WHERE folio REGEXP '^RSM-[0-9]+$'
         UNION ALL
         SELECT CAST(SUBSTRING(folio, 5) AS UNSIGNED) AS n FROM reportes_eliminados WHERE folio REGEXP '^RSM-[0-9]+$'
       ) t`
    );
    return `RSM-${(Number(fila && fila.n) || 0) + 1}`;
  } catch (error) {
    // Si el archivo de eliminados aún no existe (migración pendiente), se usa la regla original
    console.error('Folio con archivo de eliminados no disponible:', error.message);
  }
  try {
    // Buscar el último número usado
    const [ultimoReporte] = await connection.execute(
      `SELECT folio FROM reportes 
       WHERE folio REGEXP '^RSM-[0-9]+$' 
       ORDER BY CAST(SUBSTRING(folio, 5) AS UNSIGNED) DESC 
       LIMIT 1`
    );
    
    let nuevoNumero = 1;
    
    if (ultimoReporte.length > 0) {
      const numeroActual = parseInt(ultimoReporte[0].folio.replace('RSM-', ''));
      nuevoNumero = numeroActual + 1;
    }
    
    return `RSM-${nuevoNumero}`;
    
  } catch (error) {
    console.error('Error generando folio:', error);
    // Fallback simple
    const [countResult] = await connection.execute('SELECT COUNT(*) as total FROM reportes');
    return `RSM-${countResult[0].total + 1}`;
  }
}

// Validar token JWT
function verificarToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token no proporcionado' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Token inválido' });
    }
    req.usuario = decoded;
    next();
  });
}

// Generar mensaje de WhatsApp
function generarMensajeWhatsApp(reporte, departamento) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  let mensaje = `🚨 *REPORTE DE HALLAZGO*\n\n`;
  mensaje += `*Folio:* ${reporte.folio}\n`;
  mensaje += `*Área:* ${departamento}\n`;
  mensaje += `❗ *Problema:* ${reporte.descripcion.substring(0, 200)}${reporte.descripcion.length > 200 ? '...' : ''}\n`;
  mensaje += `📍 *Lugar:* ${reporte.lugar.substring(0, 100)}${reporte.lugar.length > 100 ? '...' : ''}\n`;
  
  if (reporte.latitud && reporte.longitud) {
    mensaje += `*Ubicación:* https://maps.google.com/?q=${reporte.latitud},${reporte.longitud}\n`;
  }
  
  mensaje += `\n*Ver reporte completo:*\n${baseUrl}/reportes/${reporte.folio}`;
  
  return encodeURIComponent(mensaje);
}

// Registrar log en el sistema
async function registrarLog(nivel, categoria, accion, descripcion, datos = {}) {
  try {
    const connection = await dbPool.getConnection();
    await connection.execute(
      `INSERT INTO logs_sistema (nivel, categoria, accion, descripcion, datos_adicionales, id_usuario, id_reporte, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nivel,
        categoria,
        accion,
        descripcion,
        JSON.stringify(datos),
        datos.id_usuario || null,
        datos.id_reporte || null,
        datos.ip_address || null
      ]
    );
    connection.release();
  } catch (error) {
    console.error('Error registrando log:', error);
  }
}


// Datos de quien reporta: no salen en respuestas ni páginas públicas.
// El personal con sesión los consulta en /api/sms/reportes/:folio/reportante.
const CAMPOS_PERSONALES = ['nombre', 'telefono', 'area', 'cargo', 'ip_address', 'user_agent'];
function sinDatosPersonales(reporte) {
  if (!reporte) return reporte;
  const copia = { ...reporte };
  CAMPOS_PERSONALES.forEach(c => { delete copia[c]; });
  return copia;
}


// Función auxiliar: Traducir código de estado a texto
// ===================================================
function traducirEstado(codigoEstado) {
    const estados = {
        'A': 'Generado',
        'B': 'Enterado',
        'C': 'En Atención',
        'D': 'Resuelto',
        'E': 'Duplicado',
        'F': 'No Requiere Atención'
    };
    return estados[codigoEstado] || codigoEstado;
}


function getEstadoEmoji(codigoEstado) {
    const emojis = {
        'A': '🟡',
        'B': '🔵',
        'C': '🟠',
        'D': '🟢',
        'E': '⚪',
        'F': '🔴'
    };
    return emojis[codigoEstado] || '⚫';
}


// ENDPOINTS API - REPORTES
// ========================


// POST /api/reportes - Crear nuevo reporte
app.post('/api/reportes', async (req, res) => {
  console.log('Endpoint /api/reportes alcanzado');
  console.log('Body recibido:', req.body);
  
  const connection = await dbPool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const {
        id_tipo_problema,
        tipo_problema_otro,
        lugar,
        descripcion,
        nombre,
        telefono,
        area,
        cargo
    } = req.body;
    
    console.log('Tipo de problema:', id_tipo_problema);
    
    // Validaciones mínimas
    if (!descripcion || descripcion.trim().length === 0) {
      throw new Error('La descripción es requerida');
    }
    
    if (!id_tipo_problema) {
        return res.status(400).json({
            success: false,
            error: 'El tipo de problema es requerido'
        });
    }
    
    // Obtener el nombre del tipo de problema desde la tabla tipos_problemas
    const [tipoProblemaData] = await connection.execute(
        'SELECT nombre FROM tipos_problemas WHERE id = ? AND activo = 1',
        [id_tipo_problema]
    );
    
    if (tipoProblemaData.length === 0) {
        await connection.rollback();
        throw new Error('Tipo de problema no válido o inactivo');
    }
    
    const nombreTipoProblema = tipoProblemaData[0].nombre;
    console.log('Tipo de problema validado:', nombreTipoProblema);

    // Tipo de reporte, opinión de quien reporta y datos operacionales (opcionales)
    let clasif;
    try {
        clasif = smsClasificacion.validarDatosReporte(req.body);
    } catch (e) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: e.message });
    }

    // Generar folio secuencial
    const [configResult] = await connection.execute(
        'SELECT valor FROM configuracion_sistema WHERE clave = "ultimo_folio_rsm" FOR UPDATE'
    );
    
    let ultimoNumero = parseInt(configResult[0].valor) || 0;
    ultimoNumero++;
    const folio = `RSM-${ultimoNumero}`;
    
    await connection.execute(
        'UPDATE configuracion_sistema SET valor = ? WHERE clave = "ultimo_folio_rsm"',
        [ultimoNumero.toString()]
    );
    
    console.log('Folio generado:', folio);
    
    // Insertar reporte principal. Las columnas de clasificación son las claves
    // que devuelve validarDatosReporte (nombres fijos, no vienen del cliente).
    const columnasClasif = Object.keys(clasif);
    const [resultReporte] = await connection.execute(
      `INSERT INTO reportes (
        folio, id_tipo_problema, tipo_problema, nombre, telefono, area, cargo, tipo_problema_otro,
        lugar, descripcion, estado, ip_address, user_agent, ${columnasClasif.join(', ')}
      ) VALUES (${Array(13 + columnasClasif.length).fill('?').join(', ')})`,
      [
        folio,
        id_tipo_problema,
        nombreTipoProblema,
        nombre || null,
        telefono || null,
        area || null,
        cargo || null,
        tipo_problema_otro || null,
        lugar || 'No especificado',
        descripcion,
        'A',
        req.ip || '0.0.0.0',
        req.get('user-agent') || 'Unknown',
        ...Object.values(clasif)
      ]
    );
    
    const reporteId = resultReporte.insertId;
    console.log('Reporte insertado con ID:', reporteId);
    
    // Buscar departamentos asignados según tipo de problema
    // ⭐ NUEVO: Recibir arrays de departamentos desde el frontend
    const departamentosResponsables = req.body.departamentos_responsables || [];
    // FUNCIONALIDAD DE DEPARTAMENTOS NOTIFICADOS DESHABILITADA
    // Si se necesita en el futuro, descomentar las siguientes líneas
    // const departamentosNotificados = req.body.departamentos_notificados || [];

    console.log('Departamentos recibidos:');
    console.log(' Responsables:', departamentosResponsables);
    // console.log('  Notificados:', departamentosNotificados);


    if (!departamentosResponsables || departamentosResponsables.length === 0) {
        await connection.rollback();
        return res.status(400).json({
            success: false,
            error: 'Debe seleccionar al menos un departamento responsable'
        });
    }

    // ⭐ Obtener IDs de departamentos responsables
    const codigosResponsables = Array.isArray(departamentosResponsables) 
        ? departamentosResponsables 
        : [departamentosResponsables];

    const placeholdersResp = codigosResponsables.map(() => '?').join(',');
    const [deptosResp] = await connection.execute(
        `SELECT id, codigo, nombre, icono FROM departamentos WHERE codigo IN (${placeholdersResp}) AND activo = TRUE`,
        codigosResponsables
    );

    if (deptosResp.length === 0) {
        await connection.rollback();
        return res.status(400).json({
            success: false,
            error: 'No se encontraron departamentos responsables válidos'
        });
    }

    console.log(`${deptosResp.length} departamentos responsables validados`);

    /*
    // ⭐ Obtener IDs de departamentos notificados 
    let deptosNotif = [];
    if (departamentosNotificados && departamentosNotificados.length > 0) {
        const codigosNotif = Array.isArray(departamentosNotificados) 
            ? departamentosNotificados 
            : [departamentosNotificados];

        const placeholdersNotif = codigosNotif.map(() => '?').join(',');
        const [result] = await connection.execute(
            `SELECT id, codigo, nombre, icono FROM departamentos WHERE codigo IN (${placeholdersNotif}) AND activo = TRUE`,
            codigosNotif
        );
        deptosNotif = result;
        console.log(`${deptosNotif.length} departamentos notificados validados`);
    }
    */
    // ⭐ Insertar relaciones RESPONSABLES en reporte_departamento    // ⭐ Insertar relaciones RESPONSABLES en reporte_departamento
    for (const dept of deptosResp) {
        await connection.execute(
            `INSERT INTO reporte_departamento (id_reporte, id_departamento, es_responsable)
             VALUES (?, ?, TRUE)`,
            [reporteId, dept.id]
        );
        console.log(`${dept.nombre} - RESPONSABLE`);
    }

    //Crear un solo seguimiento inicial sin departamento específico
    const folioSeguimientoInicial = `${folio}-A1`;

    await connection.execute(
        `INSERT INTO seguimiento (
            id_reporte, 
            id_departamento, 
            folio_seguimiento, 
            tipo_accion, 
            estado, 
            descripcion
        ) VALUES (?, NULL, ?, 'asignado', 'A', 'Reporte generado')`,
        [reporteId, folioSeguimientoInicial]
    );

    console.log(`  Seguimiento inicial creado: ${folioSeguimientoInicial}`);
    console.log(`  Departamentos responsables: ${deptosResp.map(d => d.nombre).join(', ')}`);

    /*
    // ⭐ Insertar relaciones NOTIFICADOS en reporte_departamento
    for (const dept of deptosNotif) {
        // ⭐ NUEVO: Verificar que NO esté ya como responsable
        const yaEsResponsable = deptosResp.some(r => r.id === dept.id);

        if (!yaEsResponsable) {
            await connection.execute(
                `INSERT INTO reporte_departamento (id_reporte, id_departamento, es_responsable)
                 VALUES (?, ?, FALSE)`,
                [reporteId, dept.id]
            );
            console.log(`  ${dept.nombre} - NOTIFICADO`);
        } else {
            console.log(`  ${dept.nombre} - Ya es RESPONSABLE, omitiendo como notificado`);
        }
    }
    */
    
    await connection.commit();
    console.log('Transacción completada');

    // Aviso dentro de la plataforma para las áreas asignadas y supervisión
    smsNotificaciones.notificar(dbPool, {
      tipo: 'nuevo_reporte',
      titulo: `Nuevo reporte ${folio}`,
      mensaje: `${clasif.tipo_reporte ? smsClasificacion.nombreTipo(clasif.tipo_reporte) + ' · ' : ''}${nombreTipoProblema}. ${String(descripcion || '').slice(0, 200)}`,
      idReporte: reporteId,
      folio,
      departamentos: deptosResp.map(d => d.id),
      supervision: true
    });

    res.json({
      success: true,
      id: reporteId,
      folio: folio,
      mensaje: 'Reporte creado exitosamente'
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error creando reporte:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    connection.release();
  }
});


// GET /api/reportes - Listar reportes con filtros
app.get('/api/reportes', async (req, res) => {
  const connection = await dbPool.getConnection();
  
  try {
    const [reportes] = await connection.execute(
      `SELECT r.*, 
              (SELECT COUNT(*) FROM reporte_departamento WHERE id_reporte = r.id) as num_departamentos,
              (SELECT COUNT(*) FROM reportes_archivos WHERE id_reporte = r.id) as num_archivos,
              (SELECT GROUP_CONCAT(d.nombre SEPARATOR ', ') 
               FROM departamentos d 
               JOIN reporte_departamento rd ON d.id = rd.id_departamento 
               WHERE rd.id_reporte = r.id) as departamentos_nombres
       FROM reportes r 
       ORDER BY r.fecha DESC 
       LIMIT 20`
    );
    
    const [countResult] = await connection.execute(
      'SELECT COUNT(*) as total FROM reportes'
    );
    
    res.json({
      success: true,
      reportes: (reportes || []).map(sinDatosPersonales),
      paginacion: {
        total: countResult[0]?.total || 0,
        pagina: 1,
        limite: 20,
        totalPaginas: Math.ceil((countResult[0]?.total || 0) / 20)
      }
    });
    
  } catch (error) {
    console.error('Error listando reportes:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      reportes: [],
      paginacion: {
        total: 0,
        pagina: 1,
        limite: 20,
        totalPaginas: 0
      }
    });
  } finally {
    connection.release();
  }
});

      

      

// ENDPOINT API - VISTA GENERAL
// =======================================

// GET /api/reportes/general - Vista general de todos los reportes con seguimientos
app.get('/api/reportes/general', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        console.log('Cargando vista general de reportes...');
        
        // Query principal que obtiene el último seguimiento de cada reporte por departamento
        const [reportes] = await connection.execute(`
            SELECT 
                r.id,
                r.folio,
                r.fecha,
                r.tipo_problema,
                r.descripcion,
                r.estado as estado_reporte,
                s.folio_seguimiento,
                COALESCE(s.estado, 'A') as estado,
                s.descripcion as ultimo_seguimiento,
                s.fecha as fecha_actualizacion,
                s.fecha_evento,
                CASE 
                    WHEN d.id IS NOT NULL THEN d.id
                    ELSE (
                        SELECT rd.id_departamento 
                        FROM reporte_departamento rd 
                        WHERE rd.id_reporte = r.id 
                        AND rd.es_responsable = 1 
                        LIMIT 1
                    )
                END as id_departamento,
                CASE 
                    WHEN d.nombre IS NOT NULL THEN d.nombre
                    ELSE (
                        SELECT d2.nombre 
                        FROM reporte_departamento rd 
                        INNER JOIN departamentos d2 ON rd.id_departamento = d2.id
                        WHERE rd.id_reporte = r.id 
                        AND rd.es_responsable = 1 
                        LIMIT 1
                    )
                END as departamento_nombre,
                CASE 
                    WHEN d.icono IS NOT NULL THEN d.icono
                    ELSE (
                        SELECT d2.icono 
                        FROM reporte_departamento rd 
                        INNER JOIN departamentos d2 ON rd.id_departamento = d2.id
                        WHERE rd.id_reporte = r.id 
                        AND rd.es_responsable = 1 
                        LIMIT 1
                    )
                END as departamento_icono
            FROM reportes r
            LEFT JOIN (
                SELECT s1.*
                FROM seguimiento s1
                INNER JOIN (
                    SELECT id_reporte, id_departamento, MAX(fecha) as max_fecha
                    FROM seguimiento
                    GROUP BY id_reporte, id_departamento
                ) s2 ON s1.id_reporte = s2.id_reporte 
                    AND s1.id_departamento = s2.id_departamento 
                    AND s1.fecha = s2.max_fecha
            ) s ON r.id = s.id_reporte
            LEFT JOIN departamentos d ON s.id_departamento = d.id
            ORDER BY r.fecha DESC
        `);
        
        // Obtener estadísticas basadas en el ÚLTIMO seguimiento de cada reporte
        const [estadisticas] = await connection.execute(`
            SELECT 
                COUNT(DISTINCT r.id) as total,
                SUM(CASE WHEN COALESCE(ultimo_seg.estado, r.estado) = 'A' THEN 1 ELSE 0 END) as nuevos,
                SUM(CASE WHEN COALESCE(ultimo_seg.estado, r.estado) = 'C' THEN 1 ELSE 0 END) as en_proceso,
                SUM(CASE WHEN COALESCE(ultimo_seg.estado, r.estado) = 'D' THEN 1 ELSE 0 END) as resueltos
            FROM reportes r
            LEFT JOIN (
                SELECT 
                    s1.id_reporte,
                    s1.estado
                FROM seguimiento s1
                INNER JOIN (
                    SELECT 
                        id_reporte, 
                        MAX(fecha) as max_fecha
                    FROM seguimiento
                    GROUP BY id_reporte
                ) s2 ON s1.id_reporte = s2.id_reporte AND s1.fecha = s2.max_fecha
            ) ultimo_seg ON r.id = ultimo_seg.id_reporte
        `);
        
        console.log(`${reportes.length} registros encontrados`);
        
        res.json({
            success: true,
            reportes: reportes,
            estadisticas: estadisticas[0]
        });
        
    } catch (error) {
        console.error('Error en vista general:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            reportes: [],
            estadisticas: {
                total: 0,
                nuevos: 0,
                en_proceso: 0,
                resueltos: 0
            }
        });
    } finally {
        connection.release();
    }
});      
      
      
      
      
// RUTAS DE VISTAS DEPARTAMENTALES
// ===============================

// Panel de administrador por departamento 
app.get('/admin/panel/:departamento_codigo', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { departamento_codigo } = req.params;
        
        // Obtener información del departamento
        const [departamentos] = await connection.execute(
            'SELECT * FROM departamentos WHERE codigo = ? AND activo = TRUE',
            [departamento_codigo]
        );
        
        if (departamentos.length === 0) {
            return res.status(404).render('error', { codigo: 404, mensaje: 'Departamento no encontrado' });
        }
        
        res.render('admin_dashboard', {
            departamento: departamentos[0]
        });
        
    } catch (error) {
        console.error('Error cargando panel:', error);
        res.status(500).render('error', { codigo: 500, mensaje: 'Error al cargar el panel' });
    } finally {
        connection.release();
    }
});

     
// ENDPOINTS API - PANEL DEPARTAMENTAL
// ===================================

// Obtener reportes de un departamento específico
app.get('/api/departamento/:id/reportes', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { id } = req.params;
        const { desde, hasta, orden } = req.query;
        
        console.log('GET /api/departamento/:id/reportes');
        console.log('   Departamento ID:', id);
        console.log('   Filtros:', { desde, hasta, orden });
        
        // ⭐ Filtro de es_responsable
        let whereClause = 'WHERE rd.id_departamento = ? AND rd.es_responsable = TRUE';
        let orderClause = orden === 'antiguos' ? 'ASC' : 'DESC';
        let params = [id];
        
        // Agregar filtro de fechas si existen
        if (desde && hasta) {
            whereClause += ' AND r.fecha BETWEEN ? AND ?';
            params.push(desde, hasta);
        }
        
        const query = `SELECT r.*, 
                (SELECT COUNT(*) FROM reportes_archivos WHERE id_reporte = r.id) as num_archivos
         FROM reportes r
         INNER JOIN reporte_departamento rd ON r.id = rd.id_reporte
         ${whereClause}
         ORDER BY r.fecha ${orderClause}`;
        
        console.log('   Query SQL:', query);
        console.log('   Params:', params);
        
        const [reportes] = await connection.execute(query, params);
        
        console.log(`   ${reportes.length} reportes encontrados`);

        res.json({
            success: true,
            reportes: reportes.map(sinDatosPersonales)
        });
        
    } catch (error) {
        console.error('Error obteniendo reportes del departamento:', error);
        console.error('   Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    } finally {
        connection.release();
    }
});

// Obtener seguimientos de un departamento
app.get('/api/departamento/:id/seguimientos', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { id } = req.params;
        const { desde, hasta, estado, orden } = req.query;
        
        console.log('Obteniendo seguimientos para departamento ID:', id);
        console.log('Filtros recibidos:', { desde, hasta, estado, orden });
        
        //Mostrar TODOS los seguimientos de reportes donde el departamento es responsable
        let whereConditions = ['rd.id_departamento = ?', 'rd.es_responsable = TRUE'];
        let params = [id];
        
        // Agregar filtros de fecha
        if (desde && hasta) {
            whereConditions.push('s.fecha BETWEEN ? AND ?');
            params.push(desde, hasta);
        }
        
        // Agregar filtro de estado
        if (estado) {
            whereConditions.push('s.estado = ?');
            params.push(estado);
        }
        
        const whereClause = whereConditions.join(' AND ');
        const orderClause = orden === 'antiguos' ? 'ASC' : 'DESC';
        
        const [seguimientos] = await connection.execute(
            `SELECT s.*, 
                    r.id as id_reporte,
                    r.folio as reporte_folio, 
                    r.tipo_problema, 
                    r.descripcion as reporte_descripcion,
                    r.fecha as reporte_fecha
             FROM seguimiento s
             INNER JOIN reportes r ON s.id_reporte = r.id
             INNER JOIN reporte_departamento rd ON r.id = rd.id_reporte
             WHERE ${whereClause}
             ORDER BY s.fecha ${orderClause}`,
            params
        );
        
        console.log(`${seguimientos.length} seguimientos encontrados`);
        
        res.json({
            success: true,
            seguimientos
        });
        
    } catch (error) {
        console.error('Error obteniendo seguimientos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            seguimientos: []
        });
    } finally {
        connection.release();
    }
});
      

// GET /api/departamento/:id/seguimientos-notificados
// ==================================================
app.get('/api/departamento/:id/seguimientos-notificados', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { id } = req.params;
        const { desde, hasta, departamento_responsable, tipo_problema, estado, orden } = req.query;
        
        console.log('Obteniendo seguimientos notificados para departamento ID:', id);
        
        let whereConditions = [
            'rd_notif.id_departamento = ?',
            'rd_notif.es_responsable = FALSE'
        ];
        let params = [id];
        
        // Filtro de fechas
        if (desde && hasta) {
            whereConditions.push('r.fecha BETWEEN ? AND ?');
            params.push(desde, hasta);
        }
        
        // Filtro por departamento responsable
        if (departamento_responsable) {
            whereConditions.push('rd_resp.id_departamento = ?');
            params.push(departamento_responsable);
        }
        
        // Filtro por tipo de problema
        if (tipo_problema) {
            whereConditions.push('r.tipo_problema = ?');
            params.push(tipo_problema);
        }
        
        // Filtro por estado del seguimiento
        if (estado) {
            whereConditions.push('s.estado = ?');
            params.push(estado);
        }
        
        const whereClause = whereConditions.join(' AND ');
        const orderClause = orden === 'antiguos' ? 'ASC' : 'DESC';
        
        // Agrupar departamentos responsables
        const [seguimientos] = await connection.execute(
            `SELECT 
                s.id as seguimiento_id,
                s.folio_seguimiento,
                s.estado as seguimiento_estado,
                s.descripcion as seguimiento_descripcion,
                s.fecha as seguimiento_fecha,
                s.fecha_evento,
                r.id as reporte_id,
                r.folio as reporte_folio,
                r.fecha as reporte_fecha,
                r.tipo_problema,
                r.descripcion as reporte_descripcion,
                GROUP_CONCAT(
                    DISTINCT CONCAT(
                        COALESCE(d_resp.icono, '🏢'), 
                        ' ', 
                        d_resp.nombre
                    ) 
                    ORDER BY d_resp.nombre 
                    SEPARATOR ', '
                ) as departamentos_responsables
             FROM seguimiento s
             INNER JOIN reportes r ON s.id_reporte = r.id
             INNER JOIN reporte_departamento rd_notif ON r.id = rd_notif.id_reporte
             INNER JOIN reporte_departamento rd_resp ON r.id = rd_resp.id_reporte AND rd_resp.es_responsable = TRUE
             INNER JOIN departamentos d_resp ON rd_resp.id_departamento = d_resp.id
             WHERE ${whereClause}
               AND s.id = (
                   SELECT s2.id 
                   FROM seguimiento s2 
                   WHERE s2.id_reporte = r.id 
                   ORDER BY s2.fecha DESC 
                   LIMIT 1
               )
             GROUP BY s.id, s.folio_seguimiento, s.estado, s.descripcion, s.fecha, s.fecha_evento, 
                      r.id, r.folio, r.fecha, r.tipo_problema, r.descripcion
             ORDER BY r.fecha ${orderClause}`,
            params
        );
        
        console.log(`${seguimientos.length} seguimientos notificados encontrados (agrupados)`);
        
        res.json({
            success: true,
            seguimientos
        });
        
    } catch (error) {
        console.error('Error obteniendo seguimientos notificados:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    } finally {
        connection.release();
    }
});

// GET /api/departamentos-responsables
// ===================================
app.get('/api/departamentos-responsables', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        console.log('Obteniendo lista de departamentos responsables...');
        
        const [departamentos] = await connection.execute(
            `SELECT DISTINCT d.id, d.codigo, d.nombre, d.icono, d.color
             FROM departamentos d
             INNER JOIN reporte_departamento rd ON d.id = rd.id_departamento
             WHERE rd.es_responsable = TRUE
             ORDER BY d.nombre`
        );
        
        console.log(`${departamentos.length} departamentos responsables encontrados`);
        
        res.json({
            success: true,
            departamentos
        });
        
    } catch (error) {
        console.error('Error obteniendo departamentos responsables:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            departamentos: []
        });
    } finally {
        connection.release();
    }
});      

// Obtener departamentos sugeridos por tipo de problema
// ====================================================
app.get('/api/tipos-problema/:tipo/departamentos-sugeridos', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { tipo } = req.params;
        console.log('Buscando departamentos sugeridos para:', tipo);
        
        // Obtener departamentos asociados a este tipo de problema
        const [sugerencias] = await connection.execute(
            `SELECT codigo_departamento, es_responsable 
             FROM tipo_problema_departamentos 
             WHERE tipo_problema = ? AND activo = TRUE`,
            [tipo]
        );
        
        // Separar en responsables y notificados
        const responsables = sugerencias
            .filter(s => s.es_responsable === 1)
            .map(s => s.codigo_departamento);
            
        const notificados = sugerencias
            .filter(s => s.es_responsable === 0)
            .map(s => s.codigo_departamento);
        
        console.log('Sugerencias encontradas:');
        console.log('Responsables:', responsables);
        console.log('Notificados:', notificados);
        
        res.json({
            success: true,
            tipo_problema: tipo,
            responsables,
            notificados
        });
        
    } catch (error) {
        console.error('Error obteniendo sugerencias:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener departamentos sugeridos',
            responsables: [],
            notificados: []
        });
    } finally {
        connection.release();
    }
});

      
// Listar TODOS los departamentos disponibles
// ==========================================
app.get('/api/departamentos', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        console.log('Listando todos los departamentos...');
        
        const [departamentos] = await connection.execute(
            `SELECT id, codigo, nombre, icono, color 
             FROM departamentos 
             WHERE activo = TRUE 
             ORDER BY nombre`
        );
        
        console.log(`${departamentos.length} departamentos encontrados`);
        
        res.json({
            success: true,
            departamentos
        });
        
    } catch (error) {
        console.error('Error listando departamentos:', error);
        res.status(500).json({
            success: false,
            error: 'Error al listar departamentos',
            departamentos: []
        });
    } finally {
        connection.release();
    }
});


// Crear nuevo seguimiento con imagenes
// ====================================
app.post('/api/seguimiento/crear', upload.array('archivos_seguimiento', 3), async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        //Extraer variables del body
        const { id_reporte, id_departamento, tipo_accion, estado, fecha_evento, folio_original } = req.body;
        let { descripcion } = req.body;
        
        // Validar que al menos tenga estado
        if (!estado) {
            throw new Error('El estado es requerido');
        }
        
        // Validar que el estado sea válido
        const estadosValidos = ['A', 'B', 'C', 'D', 'E', 'F'];
        if (!estadosValidos.includes(estado)) {
            throw new Error('Estado inválido');
        }
        
        // Verificar que el departamento es RESPONSABLE
        const [permisoResp] = await connection.execute(
            `SELECT rd.es_responsable 
             FROM reporte_departamento rd
             WHERE rd.id_reporte = ? AND rd.id_departamento = ?`,
            [id_reporte, id_departamento]
        );
        
        if (permisoResp.length === 0) {
            throw new Error('El departamento no está asociado a este reporte');
        }
        
        if (!permisoResp[0].es_responsable) {
            throw new Error('Este departamento no puede dar seguimiento a este reporte. Solo puede visualizar los seguimientos realizados por el departamento responsable.');
        }
        
        console.log('Departamento verificado como RESPONSABLE');
        
        console.log(`Creando seguimiento para reporte ${id_reporte} con estado ${estado}`);
        
        // Obtener el folio del reporte
        const [reportes] = await connection.execute(
            'SELECT folio FROM reportes WHERE id = ?',
            [id_reporte]
        );
        
        if (reportes.length === 0) {
            throw new Error('Reporte no encontrado');
        }
        
        const folioReporte = reportes[0].folio;

        // Cierres sin acción: Duplicado exige el folio del reporte original;
        // No requiere atención exige explicar el motivo
        if (estado === 'E') {
            const original = String(folio_original || '').trim().toUpperCase();
            if (!/^RSM-\d+$/.test(original)) {
                throw new Error('Indica el folio del reporte original (por ejemplo, RSM-22)');
            }
            if (original === String(folioReporte).toUpperCase()) {
                throw new Error('El reporte original debe ser distinto de este reporte');
            }
            const [orig] = await connection.execute('SELECT id FROM reportes WHERE folio = ?', [original]);
            if (orig.length === 0) {
                throw new Error(`No existe el reporte ${original}`);
            }
            const nota = String(descripcion || '').trim();
            descripcion = `Duplicado de ${original}.` + (nota ? ' ' + nota : '');
        }
        if (estado === 'F' && String(descripcion || '').trim().length < 10) {
            throw new Error('Explica por qué no requiere atención (mínimo 10 caracteres)');
        }

        // Regla SMS: no se cierra (Resuelto, Duplicado o No requiere atención) con
        // acciones correctivas sin concluir o sin verificar
        if (['D', 'E', 'F'].includes(estado)) {
            const [accionesReporte] = await connection.execute(
                'SELECT estado FROM acciones_correctivas WHERE id_reporte = ?',
                [id_reporte]
            );
            const nombreCierre = { D: 'Resuelto', E: 'Duplicado', F: 'No requiere atención' }[estado];
            const cierre = smsAcciones.evaluarCierre(accionesReporte, nombreCierre);
            if (!cierre.puede_cerrar) {
                throw new Error(cierre.mensaje);
            }
        }

        // Si quien registra tiene sesión, se guarda quién hizo el movimiento
        const usuarioSesion = await smsAuth.leerUsuario(req).catch(() => null);
        
        // Contar seguimientos existentes con ese estado
        const [conteoEstado] = await connection.execute(
            `SELECT COUNT(*) as total 
             FROM seguimiento 
             WHERE id_reporte = ? AND estado = ?
             FOR UPDATE`,
            [id_reporte, estado]
        );
        
        const numeroSecuencial = conteoEstado[0].total + 1;
        const folioSeguimiento = `${folioReporte}-${estado}${numeroSecuencial}`;
        
        console.log(`Folio generado: ${folioSeguimiento}`);
        
        // Verificar que no existe
        const [existente] = await connection.execute(
            'SELECT id FROM seguimiento WHERE folio_seguimiento = ?',
            [folioSeguimiento]
        );
        
        if (existente.length > 0) {
            throw new Error(`El folio ${folioSeguimiento} ya existe. Intenta nuevamente.`);
        }
        
        // Determinar la fecha del evento
        // Hora local del servidor (antes se guardaba en UTC y quedaba adelantada 5-6 h)
        const ahoraLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
        const fechaEventoFinal = fecha_evento || ahoraLocal.toISOString().slice(0, 19).replace('T', ' ');
        
        // Insertar seguimiento
        const [result] = await connection.execute(
            `INSERT INTO seguimiento (
                id_reporte, 
                folio_seguimiento, 
                id_departamento, 
                tipo_accion,
                descripcion,
                estado,
                numero_secuencial_estado,
                fecha_evento,
                id_usuario
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id_reporte,
                folioSeguimiento,
                id_departamento,
                tipo_accion || 'comentario',
                descripcion || null,
                estado,
                numeroSecuencial,
                fechaEventoFinal,
                usuarioSesion ? usuarioSesion.id : null
            ]
        );
        
        const seguimientoId = result.insertId;
        console.log(`Seguimiento insertado con ID: ${seguimientoId}`);
        
        // PROCESAR IMÁGENES DEL SEGUIMIENTO
        // =================================
        const archivosSubidos = [];
        
        if (req.files && req.files.length > 0) {
            console.log(`Procesando ${req.files.length} imagen(es) del seguimiento...`);
            
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const orden = i + 1;
                
                console.log(`Procesando imagen ${orden}: ${file.originalname}`);
                
                // Subir imagen usando storageService
                const resultado = await storageService.uploadImageSeguimiento(
                    file.buffer,
                    file.originalname,
                    file.mimetype,
                    folioReporte,
                    folioSeguimiento,
                    orden
                );
                
                // Guardar en tabla seguimiento_archivos
                const [archivoResult] = await connection.execute(
                    `INSERT INTO seguimiento_archivos (
                        id_seguimiento,
                        ruta_original,
                        ruta_thumbnail,
                        ruta_optimizada,
                        nombre_original,
                        tipo_archivo,
                        mime_type,
                        tamano_bytes,
                        ancho_pixels,
                        alto_pixels,
                        orden_display,
                        estado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
                    [
                        seguimientoId,
                        resultado.ruta_original,
                        resultado.ruta_thumbnail,
                        resultado.ruta_optimizada,
                        resultado.nombre_original,
                        'image',
                        resultado.tipo_mime,
                        resultado.tamano_bytes_original,
                        resultado.ancho_pixels,
                        resultado.alto_pixels,
                        orden
                    ]
                );
                
                archivosSubidos.push({
                    id: archivoResult.insertId,
                    url: resultado.url_optimizada,
                    thumbnail: resultado.url_thumbnail,
                    orden: orden
                });
                
                console.log(`Imagen ${orden} guardada con ID: ${archivoResult.insertId}`);
            }
            
            console.log(`${archivosSubidos.length} imagen(es) procesada(s) correctamente`);
        }
        
        //Actualizar el estado del reporte al estado del seguimiento
        await connection.execute(
            'UPDATE reportes SET estado = ? WHERE id = ?',
            [estado, id_reporte]
        );
        
        await connection.commit();
        console.log('Transacción completada exitosamente');

        // Aviso a supervisión y a las demás áreas del reporte
        const [otrasAreas] = await dbPool.query(
            'SELECT id_departamento FROM reporte_departamento WHERE id_reporte = ? AND id_departamento <> ?',
            [id_reporte, id_departamento || 0]
        );
        smsNotificaciones.notificar(dbPool, {
            tipo: 'actualizacion',
            titulo: `${folioReporte}: ${traducirEstado(estado)}`,
            mensaje: descripcion ? String(descripcion).slice(0, 200) : `Nuevo seguimiento ${folioSeguimiento}`,
            idReporte: Number(id_reporte),
            folio: folioReporte,
            departamentos: otrasAreas.map(a => a.id_departamento),
            supervision: true
        });

        res.json({
            success: true,
            id: seguimientoId,
            folio: folioSeguimiento,
            numero_secuencial: numeroSecuencial,
            fecha_evento: fechaEventoFinal,
            imagenes: archivosSubidos,
            mensaje: `Seguimiento creado ${archivosSubidos.length > 0 ? `con ${archivosSubidos.length} imagen(es)` : 'exitosamente'}`
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Error creando seguimiento:', error);
        
        res.status(400).json({
            success: false,
            error: error.message
        });
    } finally {
        connection.release();
    }
});
      

// ENDPOINTS API - ARCHIVOS MULTIMEDIA
// ===================================

// POST /api/subir-archivos - Subir archivos multimedia
app.post('/api/subir-archivos',
  upload.array('archivos', 5), // Multer maneja el upload
  validateImageFiles,           // Validación adicional
  async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
      const { id_reporte, folio } = req.body;
      
      if (!id_reporte || !folio) {
        throw new Error('ID de reporte y folio son requeridos');
      }
      
      if (!req.files || req.files.length === 0) {
        throw new Error('No se recibieron archivos');
      }
      
      console.log(`Procesando ${req.files.length} archivo(s) para reporte ${folio}...`);
      
      const archivosSubidos = [];
      let ordenActual = 1;
      
      // Obtener el último orden usado
      const [ultimoOrden] = await connection.execute(
        'SELECT MAX(orden_display) as max_orden FROM reportes_archivos WHERE id_reporte = ?',
        [id_reporte]
      );
      
      if (ultimoOrden[0].max_orden) {
        ordenActual = ultimoOrden[0].max_orden + 1;
      }
      
      // Procesar cada archivo
      for (const file of req.files) {
        console.log(`Procesando: ${file.originalname}...`);
        
        // Subir y procesar imagen con storageService
        const resultado = await storageService.uploadImage(
          file.buffer,
          file.originalname,
          file.mimetype,
          folio,
          'reportes',
          ordenActual
        );
        
        // Guardar en base de datos
        const [resultadoDB] = await connection.execute(
          `INSERT INTO reportes_archivos (
            id_reporte,
            ruta_original,
            ruta_thumbnail,
            ruta_optimizada,
            nombre_original,
            tipo_archivo,
            mime_type,
            tamano_bytes,
            ancho_pixels,
            alto_pixels,
            orden_display,
            estado
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
          [
            id_reporte,
            resultado.ruta_original,
            resultado.ruta_thumbnail,
            resultado.ruta_optimizada,
            resultado.nombre_original,
            'image',
            resultado.tipo_mime,
            resultado.tamano_bytes_original,
            resultado.ancho_pixels,
            resultado.alto_pixels,
            ordenActual
          ]
        );
        
        archivosSubidos.push({
          id: resultadoDB.insertId,
          url: resultado.url_optimizada,      // URL principal
          url_original: resultado.url_original,
          thumbnail: resultado.url_thumbnail,
          tipo: 'image',
          orden: ordenActual,
          nombre: resultado.nombre_original
        });
        
        console.log(`Archivo procesado: ${resultado.nombre_unico}`);
        ordenActual++;
      }
      
      await registrarLog('info', 'archivos', 'subir', `${archivosSubidos.length} archivos subidos`, {
        id_reporte: id_reporte,
        folio: folio,
        num_archivos: archivosSubidos.length
      });
      
      res.json({
        success: true,
        archivos: archivosSubidos,
        mensaje: `${archivosSubidos.length} archivo(s) subido(s) exitosamente`
      });
      
    } catch (error) {
      console.error('Error subiendo archivos:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    } finally {
      connection.release();
    }
  }
);


app.use(handleMulterError);

// DELETE /api/archivo/:id - Eliminar archivo
app.delete('/api/archivo/:id', async (req, res) => {
  const connection = await dbPool.getConnection();
  
  try {
    const { id } = req.params;
    
    // Obtener información del archivo
    const [archivos] = await connection.execute(
      'SELECT * FROM reportes_archivos WHERE id = ?',
      [id]
    );
    
    if (archivos.length === 0) {
      throw new Error('Archivo no encontrado');
    }
    
    const archivo = archivos[0];
    
    // Eliminar archivos del sistema de archivos
    const eliminado = await storageService.deleteImage(archivo.ruta_original);
    
    if (eliminado) {
      // Marcar como eliminado en BD
      await connection.execute(
        `UPDATE reportes_archivos 
         SET estado = 'deleted', fecha_eliminacion = NOW()
         WHERE id = ?`,
        [id]
      );
      
      console.log(`Archivo ${id} eliminado`);
      
      res.json({
        success: true,
        mensaje: 'Archivo eliminado exitosamente'
      });
    } else {
      throw new Error('No se pudo eliminar el archivo del disco');
    }
    
  } catch (error) {
    console.error('Error eliminando archivo:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    connection.release();
  }
});

      

// Eliminar imagen de un seguimiento
// =================================
      
// DELETE /api/seguimiento/:id_seguimiento/archivo/:id_archivo 
app.delete('/api/seguimiento/:id_seguimiento/archivo/:id_archivo', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { id_seguimiento, id_archivo } = req.params;
        
        console.log(`Eliminando archivo ${id_archivo} del seguimiento ${id_seguimiento}`);
        
        // Obtener información del archivo
        const [archivos] = await connection.execute(
            `SELECT * FROM seguimiento_archivos 
             WHERE id = ? AND id_seguimiento = ?`,
            [id_archivo, id_seguimiento]
        );
        
        if (archivos.length === 0) {
            throw new Error('Archivo no encontrado o no pertenece a este seguimiento');
        }
        
        const archivo = archivos[0];
        
        // Eliminar archivos
        const eliminado = await storageService.deleteImage(archivo.ruta_original);
        
        if (eliminado) {
            // Marcar como eliminado en BD
            await connection.execute(
                `UPDATE seguimiento_archivos 
                 SET estado = 'deleted', fecha_eliminacion = NOW()
                 WHERE id = ?`,
                [id_archivo]
            );
            
            console.log(`Archivo ${id_archivo} eliminado correctamente`);
            
            res.json({
                success: true,
                mensaje: 'Imagen eliminada exitosamente'
            });
        } else {
            throw new Error('No se pudo eliminar el archivo del disco');
        }
        
    } catch (error) {
        console.error('Error eliminando archivo:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    } finally {
        connection.release();
    }
});      
      
      
// ENDPOINTS API - UBICACIÓN
// =========================

// POST /api/ubicacion - Guardar ubicación GPS
app.post('/api/ubicacion', async (req, res) => {
  const connection = await dbPool.getConnection();
  
  try {
    const {
      id_reporte,
      latitud,
      longitud,
      precision_metros,
      altitud,
      velocidad,
      direccion,
      metodo_obtencion
    } = req.body;
    
    if (!id_reporte || !latitud || !longitud) {
      throw new Error('Reporte, latitud y longitud son requeridos');
    }
    
    // Verificar si ya existe ubicación
    const [existente] = await connection.execute(
      'SELECT id FROM ubicaciones WHERE id_reporte = ?',
      [id_reporte]
    );
    
    if (existente.length > 0) {
      // Actualizar ubicación existente
      await connection.execute(
        `UPDATE ubicaciones SET
         latitud = ?, longitud = ?, precision_metros = ?,
         altitud = ?, velocidad = ?, direccion = ?,
         metodo_obtencion = ?, timestamp_ubicacion = NOW()
         WHERE id_reporte = ?`,
        [
          latitud, longitud, precision_metros || null,
          altitud || null, velocidad || null, direccion || null,
          metodo_obtencion || 'gps', id_reporte
        ]
      );
    } else {
      // Insertar nueva ubicación
      await connection.execute(
        `INSERT INTO ubicaciones (
          id_reporte, latitud, longitud, precision_metros,
          altitud, velocidad, direccion, metodo_obtencion,
          timestamp_ubicacion, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [
          id_reporte, latitud, longitud, precision_metros || null,
          altitud || null, velocidad || null, direccion || null,
          metodo_obtencion || 'gps', req.ip, req.get('user-agent')
        ]
      );
    }
    
    res.json({
      success: true,
      mensaje: 'Ubicación guardada exitosamente',
      mapa_url: `https://maps.google.com/?q=${latitud},${longitud}`
    });
    
  } catch (error) {
    console.error('Error guardando ubicación:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// ENDPOINTS API - SEGUIMIENTO
// ===========================

// POST /api/seguimiento - Crear seguimiento
app.post('/api/seguimiento', verificarToken, async (req, res) => {
  const connection = await dbPool.getConnection();
  
  try {
    const {
      id_reporte,
      id_departamento,
      tipo_accion,
      descripcion,
      estado
    } = req.body;
    
    // Generar folio de seguimiento
    const [ultimoSeguimiento] = await connection.execute(
      'SELECT COUNT(*) as total FROM seguimiento WHERE id_reporte = ?',
      [id_reporte]
    );
    
    const letra = String.fromCharCode(65 + ultimoSeguimiento[0].total);
    const [reporte] = await connection.execute(
      'SELECT folio FROM reportes WHERE id = ?',
      [id_reporte]
    );
    
    const folioSeguimiento = `${reporte[0].folio}-${letra}`;
    
    // Insertar seguimiento
    const [result] = await connection.execute(
      `INSERT INTO seguimiento (
        id_reporte, folio_seguimiento, id_departamento,
        id_usuario, tipo_accion, descripcion, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id_reporte, folioSeguimiento, id_departamento,
        req.usuario.id, tipo_accion, descripcion, estado
      ]
    );
    
    // Actualizar estado del reporte si es necesario
    if (estado === 'C') {
      await connection.execute(
        'UPDATE reportes SET estado = "resuelto" WHERE id = ?',
        [id_reporte]
      );
    } else if (estado === 'B') {
      await connection.execute(
        'UPDATE reportes SET estado = "en_proceso" WHERE id = ?',
        [id_reporte]
      );
    }
    
    res.json({
      success: true,
      id: result.insertId,
      folio: folioSeguimiento,
      mensaje: 'Seguimiento creado exitosamente'
    });
    
  } catch (error) {
    console.error('Error creando seguimiento:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    connection.release();
  }
});


// ENDPOINTS API - AUTENTICACIÓN
// =============================

// POST /api/auth/login - Login de usuarios departamentales
app.post('/api/auth/login', async (req, res) => {
  const connection = await dbPool.getConnection();
  
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      throw new Error('Usuario y contraseña son requeridos');
    }
    
    // Buscar usuario
    const [usuarios] = await connection.execute(
      `SELECT u.*, d.nombre as departamento_nombre, d.codigo as departamento_codigo
       FROM usuarios_departamento u
       JOIN departamentos d ON u.id_departamento = d.id
       WHERE (u.username = ? OR u.email = ?) AND u.activo = TRUE`,
      [String(username).trim(), String(username).trim().toLowerCase()]
    );
    
    if (usuarios.length === 0) {
      throw new Error('Usuario o contraseña incorrectos');
    }
    
    const usuario = usuarios[0];
    
    // Verificar si está bloqueado
    if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
      throw new Error('Usuario bloqueado temporalmente');
    }
    
    // Verificar contraseña
    const passwordValido = await bcrypt.compare(password, usuario.password_hash);
    
    if (!passwordValido) {
      // Incrementar intentos fallidos
      await connection.execute(
        `UPDATE usuarios_departamento 
         SET intentos_login_fallidos = intentos_login_fallidos + 1
         WHERE id = ?`,
        [usuario.id]
      );
      
      // Bloquear si excede intentos
      if (usuario.intentos_login_fallidos >= 4) {
        await connection.execute(
          `UPDATE usuarios_departamento 
           SET bloqueado_hasta = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
           WHERE id = ?`,
          [usuario.id]
        );
      }
      
      throw new Error('Usuario o contraseña incorrectos');
    }
    
    // Login exitoso - resetear intentos y actualizar último login
    await connection.execute(
      `UPDATE usuarios_departamento 
       SET intentos_login_fallidos = 0, 
           ultimo_login = NOW(),
           bloqueado_hasta = NULL
       WHERE id = ?`,
      [usuario.id]
    );
    
    // Generar token JWT
    const token = jwt.sign(
      {
        id: usuario.id,
        username: usuario.username,
        departamento_id: usuario.id_departamento,
        rol: usuario.rol
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    
    // Registrar log
    await registrarLog('info', 'auth', 'login', `Usuario ${username} inició sesión`, {
      id_usuario: usuario.id,
      ip_address: req.ip
    });
    
    res.json({
      success: true,
      token,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        nombre: usuario.nombre,
        departamento: usuario.departamento_nombre,
        departamento_codigo: usuario.departamento_codigo,
        rol: usuario.rol,
        debe_cambiar_password: Boolean(usuario.debe_cambiar_password)
      }
    });
    
  } catch (error) {
    console.error('Error en login:', error);
    res.status(401).json({
      success: false,
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// GET /api/departamentos - Obtener lista de departamentos activos
// ===============================================================
app.get('/api/departamentos', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const [departamentos] = await connection.execute(
            `SELECT id, codigo, nombre, telefono, icono, color 
             FROM departamentos 
             WHERE activo = 1 
             ORDER BY id`
        );
        
        res.json({
            success: true,
            departamentos
        });
        
    } catch (error) {
        console.error('Error obteniendo departamentos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    } finally {
        connection.release();
    }
});
      

// GET /api/tipos-problemas/activos - Obtener tipos de problemas activos
// =====================================================================
app.get('/api/tipos-problemas/activos', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const [tiposProblemas] = await connection.execute(
            `SELECT id, codigo, nombre 
             FROM tipos_problemas 
             WHERE activo = 1 
             ORDER BY orden_display ASC, nombre ASC`
        );
        
        res.json({
            success: true,
            data: tiposProblemas
        });
        
    } catch (error) {
        console.error('Error obteniendo tipos de problemas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    } finally {
        connection.release();
    }
});


// ENDPOINTS API - WHATSAPP
// ========================

// GET /api/reportes/:folio/whatsapp - Generar enlaces de WhatsApp
app.get('/api/reportes/:folio/whatsapp', async (req, res) => {
  const connection = await dbPool.getConnection();
  
  try {
    const { folio } = req.params;
    console.log('Generando enlaces WhatsApp para:', folio);
    
    // Buscar el reporte directamente por folio
    const [reportes] = await connection.execute(
      'SELECT * FROM reportes WHERE folio = ?',
      [folio]
    );
    
    console.log('Reportes encontrados:', reportes.length);
    
    if (reportes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Reporte no encontrado',
        folio: folio,
        enlaces: []
      });
    }
    
    const reporte = reportes[0];
    console.log('Reporte encontrado ID:', reporte.id);
    
    // ⭐ NUEVO: Obtener el departamento RESPONSABLE
    const [departamentoResponsable] = await connection.execute(
      `SELECT d.id, d.codigo, d.nombre, d.icono, d.telefono
       FROM departamentos d 
       INNER JOIN reporte_departamento rd ON d.id = rd.id_departamento 
       WHERE rd.id_reporte = ? AND rd.es_responsable = TRUE
       LIMIT 1`,
      [reporte.id]
    );
    
    console.log('Departamento responsable:', departamentoResponsable.length > 0 ? departamentoResponsable[0].nombre : 'NINGUNO');
    
    // Obtener TODOS los departamentos asociados al reporte (para notificaciones)
    const [departamentos] = await connection.execute(
      `SELECT d.id, d.codigo, d.nombre, d.icono, d.telefono, rd.es_responsable
       FROM departamentos d 
       INNER JOIN reporte_departamento rd ON d.id = rd.id_departamento 
       WHERE rd.id_reporte = ?
       ORDER BY rd.es_responsable DESC`,
      [reporte.id]
    );
    
    console.log('Total departamentos asociados:', departamentos.length);
    
    if (departamentos.length === 0) {
      console.warn('⚠️ No hay departamentos asociados al reporte');
      return res.json({
        success: true,
        folio: reporte.folio,
        enlaces: [],
        mensaje: 'Reporte creado sin departamentos asociados'
      });
    }
    
    // Obtener ubicación si existe
    const [ubicaciones] = await connection.execute(
      'SELECT * FROM ubicaciones WHERE id_reporte = ? LIMIT 1',
      [reporte.id]
    );
    
    // Truncar descripción a 250 caracteres
    const descripcionCorta = reporte.descripcion.length > 250 
      ? reporte.descripcion.substring(0, 250) + '...' 
      : reporte.descripcion;
    
    // Truncar lugar a 100 caracteres
    const lugarCorto = reporte.lugar.length > 100 
      ? reporte.lugar.substring(0, 100) + '...' 
      : reporte.lugar;
    
    //CREAR MENSAJE
    let mensaje = `*Reporte de Hallazgo (${reporte.folio})*\n`;
    
    // AGREGAR DEPARTAMENTO RESPONSABLE
    if (departamentoResponsable.length > 0) {
      mensaje += `\n*Departamento Responsable:* ${departamentoResponsable[0].icono || '🏢'} ${departamentoResponsable[0].nombre}\n`;
    }
    
    mensaje += `\n*Tipo de problema:* ${reporte.tipo_problema}\n\n`;
    mensaje += `*Descripción:*\n${descripcionCorta}\n\n`;
    mensaje += `*Ubicación:* ${lugarCorto}\n`;
    
    // Agregar enlace de Google Maps si hay coordenadas
    if (ubicaciones.length > 0 && ubicaciones[0].latitud && ubicaciones[0].longitud) {
      mensaje += `\n📍 *Ver en Google Maps:*\n`;
      mensaje += `https://maps.google.com/?q=${ubicaciones[0].latitud},${ubicaciones[0].longitud}\n`;
    }
    
    mensaje += `\n*Ver reporte completo:*\n`;
    mensaje += `${process.env.BASE_URL || 'http://localhost:3000'}/reportes/${reporte.folio}`;
    
    const mensajeCodificado = encodeURIComponent(mensaje);
    
    // Crear enlaces para cada departamento CON TELÉFONO
    const enlaces = departamentos.map(dept => {
      console.log(`${dept.nombre} ${dept.es_responsable ? '(RESPONSABLE)' : '(NOTIFICADO)'} - Tel: ${dept.telefono || 'SIN TELÉFONO'}`);
      
      // Si el departamento tiene teléfono, usar enlace directo
      const enlaceWhatsApp = dept.telefono 
        ? `https://wa.me/${dept.telefono.replace(/[^0-9]/g, '')}?text=${mensajeCodificado}`
        : `https://wa.me/?text=${mensajeCodificado}`;
      
      return {
        departamento: dept.nombre,
        icono: dept.icono || '',
        telefono: dept.telefono || null,
        es_responsable: dept.es_responsable,
        enlace: enlaceWhatsApp
      };
    });
    
    console.log(`${enlaces.length} enlaces generados`);
    
    res.json({
      success: true,
      folio: reporte.folio,
      departamento_responsable: departamentoResponsable.length > 0 ? departamentoResponsable[0].nombre : null,
      enlaces
    });
    
  } catch (error) {
    console.error('Error generando enlaces WhatsApp:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      folio: req.params.folio,
      enlaces: []
    });
  } finally {
    connection.release();
  }
});
      
// ENDPOINTS API - GESTIÓN DE ÁREAS EN REPORTES
// ============================================

// Obtener áreas notificadas de un reporte
app.get('/api/reporte/:id/areas-notificadas', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const idReporte = req.params.id;
        
        const query = `
            SELECT d.id, d.nombre, d.codigo
            FROM departamentos d
            INNER JOIN reporte_departamento rd ON d.id = rd.id_departamento
            WHERE rd.id_reporte = ?
            ORDER BY d.nombre
        `;
        
        const [departamentos] = await connection.execute(query, [idReporte]);
        
        res.json({
            success: true,
            departamentos
        });
    } catch (error) {
        console.error('Error obteniendo áreas notificadas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener áreas notificadas'
        });
    } finally {
        connection.release();
    }
});

// Obtener áreas disponibles para agregar a un reporte
app.get('/api/reporte/:id/areas-disponibles', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const idReporte = req.params.id;
        
        const query = `
            SELECT id, nombre, codigo, icono
            FROM departamentos
            WHERE activo = 1
              AND id NOT IN (
                SELECT id_departamento
                FROM reporte_departamento
                WHERE id_reporte = ?
              )
            ORDER BY id
        `;
        
        const [departamentos] = await connection.execute(query, [idReporte]);
        
        res.json({
            success: true,
            departamentos
        });
    } catch (error) {
        console.error('Error obteniendo áreas disponibles:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener áreas disponibles'
        });
    } finally {
        connection.release();
    }
});

// Agregar áreas a un reporte existente
app.post('/api/reporte/:id/agregar-areas', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const idReporte = req.params.id;
        const { departamentos } = req.body;
        
        console.log('Agregando áreas al reporte:', idReporte);
        console.log('Departamentos a agregar:', departamentos);
        
        // Validaciones
        if (!departamentos || !Array.isArray(departamentos) || departamentos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Debe proporcionar al menos un departamento'
            });
        }
        
        // Verificar que el reporte existe
        const [reporteExiste] = await connection.execute(
            'SELECT id FROM reportes WHERE id = ?',
            [idReporte]
        );
        
        if (reporteExiste.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Reporte no encontrado'
            });
        }
        
        // Insertar departamentos
        let areasAgregadas = 0;
        
        for (const idDepartamento of departamentos) {
            const queryInsert = `
                INSERT IGNORE INTO reporte_departamento
                (id_reporte, id_departamento, es_responsable, notificado, metodo_notificacion, fecha_notificacion)
                VALUES (?, ?, 1, 1, 'whatsapp', NOW())
            `;
            
            const [result] = await connection.execute(queryInsert, [idReporte, idDepartamento]);
            
            if (result.affectedRows > 0) {
                areasAgregadas++;
            }
        }
        
        console.log(`${areasAgregadas} áreas agregadas exitosamente`);

        if (areasAgregadas > 0) {
            const [[rep]] = await connection.execute('SELECT folio FROM reportes WHERE id = ?', [idReporte]);
            smsNotificaciones.notificar(dbPool, {
                tipo: 'asignacion',
                titulo: `${rep.folio}: se asignó a tu área`,
                mensaje: 'El reporte se agregó a las áreas responsables de atención.',
                idReporte: Number(idReporte),
                folio: rep.folio,
                departamentos: departamentos,
                supervision: false
            });
        }
        
        res.json({
            success: true,
            message: 'Áreas agregadas exitosamente',
            areas_agregadas: areasAgregadas
        });
    } catch (error) {
        console.error('Error agregando áreas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al agregar áreas al reporte'
        });
    } finally{
        connection.release();
    }
});
      
      
// ENDPOINTS API - ESTADÍSTICAS
// ============================

// GET /api/estadisticas - Obtener estadísticas generales
app.get('/api/estadisticas', verificarToken, async (req, res) => {
  const connection = await dbPool.getConnection();
  
  try {
    // Estadísticas generales
    const [stats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_reportes,
        SUM(CASE WHEN estado = 'nuevo' THEN 1 ELSE 0 END) as nuevos,
        SUM(CASE WHEN estado = 'en_proceso' THEN 1 ELSE 0 END) as en_proceso,
        SUM(CASE WHEN estado = 'resuelto' THEN 1 ELSE 0 END) as resueltos,
        SUM(CASE WHEN prioridad = 'critica' THEN 1 ELSE 0 END) as criticos,
        SUM(CASE WHEN fecha >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as ultimas_24h,
        SUM(CASE WHEN fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as ultima_semana
      FROM reportes
    `);
    
    // Por departamento
    const [porDepartamento] = await connection.execute(`
      SELECT 
        d.nombre,
        d.codigo,
        COUNT(DISTINCT rd.id_reporte) as total,
        SUM(CASE WHEN r.estado = 'nuevo' THEN 1 ELSE 0 END) as nuevos,
        SUM(CASE WHEN r.estado = 'resuelto' THEN 1 ELSE 0 END) as resueltos
      FROM departamentos d
      LEFT JOIN reporte_departamento rd ON d.id = rd.id_departamento
      LEFT JOIN reportes r ON rd.id_reporte = r.id
      WHERE d.activo = TRUE
      GROUP BY d.id
    `);
    
    connection.release();
    
    res.json({
      success: true,
      estadisticas: {
        general: stats[0],
        por_departamento: porDepartamento
      }
    });
    
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});
      
    
// Módulo SMS: análisis, riesgo, acciones correctivas, notificaciones, exportación
// (antes de /reportes/:folio para que /reportes/analisis no se tome como folio)
// ==============================================================================
// Usuarios y permisos (administración, configuración inicial y cuenta propia)
const rutasUsuarios = crearRutasUsuarios({ dbPool, secreto: JWT_SECRET });
app.locals.codigoConfiguracion = rutasUsuarios.codigoConfiguracion;
app.use(rutasUsuarios);

app.use(crearRutasSMS({
  dbPool,
  secreto: JWT_SECRET,
  upload,
  validateImageFiles,
  handleMulterError,
  storageService
}));

// RUTAS DE VISTAS (Frontend)
// ==========================

// Página de inicio: lleva a la vista general de reportes
app.get('/', (req, res) => {
  res.redirect('/reportes/general');
});

// Vista de formulario de reportes rápidos
app.get('/reportes-rapidos', async (req, res) => {
  // Nombres de la escala (frecuencia y gravedad) de la matriz configurada.
  // Si la base falla, el formulario se muestra igual con los de referencia.
  let matriz = smsRiesgo.MATRIZ_REFERENCIA;
  try {
    matriz = await smsRiesgo.obtenerMatriz(dbPool);
  } catch (error) {
    console.error('Matriz no disponible para el formulario:', error.message);
  }
  res.render('reportes_rapidos', {
    tiposReporte: smsClasificacion.TIPOS_REPORTE,
    gruposReporte: smsClasificacion.GRUPOS_REPORTE,
    gseTipos: smsClasificacion.GSE_TIPOS,
    escalaProbabilidad: matriz.probabilidad.slice().sort((a, b) => a.valor - b.valor),
    escalaSeveridad: matriz.severidad.slice().sort((a, b) => a.valor - b.valor)
  });
});

// Vista de login
app.get('/login', (req, res) => {
    res.render('login');
});

// Vista de admin
app.get('/admin/reportes-rapidos', (req, res) => {
    res.render('reportes_rapidos_admin');
});

//Rutas específicas ANTES de rutas con parámetros dinámicos

// Vista general de reportes
app.get('/reportes/general', (req, res) => {
    res.render('reportes_general');
});

// Vista del historial de seguimiento de un reporte CON IMÁGENES
// =============================================================
app.get('/reportes/:folio/historial', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { folio } = req.params;
        
        console.log(`Cargando historial completo para: ${folio}`);
        
        // Obtener datos del reporte
        const [reportes] = await connection.execute(
            `SELECT r.*, GROUP_CONCAT(d.nombre SEPARATOR ', ') as departamentos_nombres
             FROM reportes r
             LEFT JOIN reporte_departamento rd ON r.id = rd.id_reporte
             LEFT JOIN departamentos d ON rd.id_departamento = d.id
             WHERE r.folio = ?
             GROUP BY r.id`,
            [folio]
        );
        
        if (reportes.length === 0) {
            return res.status(404).render('error', { codigo: 404, mensaje: 'Reporte no encontrado' });
        }

        // Página pública: sin datos de quien reportó (se cargan con sesión)
        const reporte = sinDatosPersonales(reportes[0]);

        // Verificar que el usuario tiene acceso
        // =====================================
        /*
        if (req.usuario && req.usuario.id_departamento) {
            const [tieneAcceso] = await connection.execute(
                `SELECT COUNT(*) as tiene_acceso
                 FROM reporte_departamento rd
                 WHERE rd.id_reporte = ? AND rd.id_departamento = ?`,
                [reporte.id, req.usuario.id_departamento]
            );
            
            if (tieneAcceso[0].tiene_acceso === 0) {
                return res.status(403).render('error', { codigo: 403, mensaje: 'No tiene permisos para ver este reporte' });
            }
        }
        */
        
        // Obtener ubicación si existe
        const [ubicaciones] = await connection.execute(
            'SELECT * FROM ubicaciones WHERE id_reporte = ?',
            [reporte.id]
        );
        
        // Obtener seguimientos del reporte
        const [seguimientos] = await connection.execute(
            `SELECT s.*, d.nombre as departamento_nombre, d.icono as departamento_icono
             FROM seguimiento s
             LEFT JOIN departamentos d ON s.id_departamento = d.id
             WHERE s.id_reporte = ?
             ORDER BY s.fecha ASC`,
            [reporte.id]
        );
        
        // OBTENER IMÁGENES DE CADA SEGUIMIENTO
        // ====================================
        for (let seg of seguimientos) {
            const [imagenes] = await connection.execute(
                `SELECT 
                    id,
                    ruta_original,
                    ruta_thumbnail,
                    ruta_optimizada,
                    nombre_original,
                    tamano_bytes,
                    ancho_pixels,
                    alto_pixels,
                    orden_display
                 FROM seguimiento_archivos
                 WHERE id_seguimiento = ? AND estado = 'completed'
                 ORDER BY orden_display ASC`,
                [seg.id]
            );
            
            // Agregar URLs completas a cada imagen
            seg.imagenes = imagenes.map(img => ({
                id: img.id,
                url_original: `/uploads/${img.ruta_original}`,
                url_thumbnail: `/uploads/${img.ruta_thumbnail}`,
                url_optimizada: `/uploads/${img.ruta_optimizada}`,
                nombre_original: img.nombre_original,
                tamano_bytes: img.tamano_bytes,
                ancho_pixels: img.ancho_pixels,
                alto_pixels: img.alto_pixels,
                orden: img.orden_display
            }));
        }
        
        console.log(`Historial cargado: ${seguimientos.length} seguimientos`);
        
        // Obtener archivos multimedia del REPORTE PRINCIPAL    
        const [archivos] = await connection.execute(
            `SELECT * FROM reportes_archivos WHERE id_reporte = ? AND estado = 'completed' ORDER BY orden_display`,
            [reporte.id]
        );
        
        // Obtener departamento responsable 
        const [deptResponsable] = await connection.execute(
            `SELECT d.id, d.codigo, d.nombre, d.icono
             FROM departamentos d
             INNER JOIN reporte_departamento rd ON d.id = rd.id_departamento
             WHERE rd.id_reporte = ? AND rd.es_responsable = TRUE
             LIMIT 1`,
            [reporte.id]
        );
        
        // Obtener TODOS los departamentos responsables (para lista)
        const [departamentosResponsables] = await connection.execute(
            `SELECT d.id, d.codigo, d.nombre
             FROM departamentos d
             INNER JOIN reporte_departamento rd ON d.id = rd.id_departamento
             WHERE rd.id_reporte = ? AND rd.es_responsable = TRUE
             ORDER BY d.nombre`,
            [reporte.id]
        );
        
        // Obtener departamentos notificados
        const [deptsNotificados] = await connection.execute(
            `SELECT d.id, d.codigo, d.nombre, d.icono
             FROM departamentos d
             INNER JOIN reporte_departamento rd ON d.id = rd.id_departamento
             WHERE rd.id_reporte = ? AND rd.es_responsable = FALSE`,
            [reporte.id]
        );
        
        console.log('Dept Responsable:', deptResponsable[0]?.nombre || 'Ninguno');
        console.log('Depts Notificados:', deptsNotificados.length);
        
        res.render('reporte_historial', {
            reporte,
            ubicacion: ubicaciones[0] || null,
            seguimientos,
            archivos,
            departamento_responsable: deptResponsable[0] || null,
            departamentosResponsables: departamentosResponsables || [],
            departamentos_notificados: deptsNotificados || []
        });
        
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).render('error', { codigo: 500, mensaje: 'Error al cargar el historial' });
    } finally {
        connection.release();
    }
});

// Vista de reporte individual
app.get('/reportes/:folio', async (req, res) => {
    const connection = await dbPool.getConnection();
    
    try {
        const { folio } = req.params;
        
        // Obtener datos del reporte
        const [reportes] = await connection.execute(
            `SELECT r.*,
                    GROUP_CONCAT(d.nombre SEPARATOR ', ') as departamentos_nombres
             FROM reportes r
             LEFT JOIN reporte_departamento rd ON r.id = rd.id_reporte
             LEFT JOIN departamentos d ON rd.id_departamento = d.id
             WHERE r.folio = ?
             GROUP BY r.id`,
            [folio]
        );

        if (reportes.length === 0) {
            return res.status(404).render('error', { codigo: 404, mensaje: 'Reporte no encontrado' });
        }

        // Página pública: sin datos de quien reportó (se cargan con sesión)
        const reporte = sinDatosPersonales(reportes[0]);
        reporte.tipo_reporte_nombre = smsClasificacion.nombreTipo(reporte.tipo_reporte);
        const conPercepcion = reporte.percepcion_probabilidad || reporte.percepcion_severidad;

        const [[ubicaciones], [archivos], matriz] = await Promise.all([
            // Ubicación, si existe
            connection.execute('SELECT * FROM ubicaciones WHERE id_reporte = ?', [reporte.id]),
            // Archivos multimedia
            connection.execute(
                `SELECT * FROM reportes_archivos
                 WHERE id_reporte = ? AND estado = 'completed'
                 ORDER BY orden_display`,
                [reporte.id]
            ),
            conPercepcion ? smsRiesgo.obtenerMatriz(dbPool) : null
        ]);

        // Opinión de quien reportó, con los nombres de la escala configurada
        if (matriz) {
            const nombre = (eje, v) => { const x = matriz[eje].find(n => n.valor === Number(v)); return x ? `${v} · ${x.nombre}` : null; };
            reporte.percepcion_texto = {
                probabilidad: reporte.percepcion_probabilidad ? nombre('probabilidad', reporte.percepcion_probabilidad) : null,
                severidad: reporte.percepcion_severidad ? nombre('severidad', reporte.percepcion_severidad) : null
            };
        }
        
        res.render('reporte_detalle', { 
            reporte,
            ubicacion: ubicaciones[0] || null,
            archivos: archivos || []  // ⭐ NUEVO
        });
        
    } catch (error) {
        console.error('Error obteniendo reporte:', error);
        res.status(500).render('error', { codigo: 500, mensaje: 'Error al cargar el reporte' });
    } finally {
        connection.release();
    }
});

// Página no encontrada (las rutas /api responden JSON)
// ====================================================
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Ruta no encontrada' });
  }
  res.status(404).render('error', { codigo: 404, mensaje: 'La página que buscas no existe o cambió de dirección' });
});

// Manejo de errores global
// =========================
app.use((err, req, res, next) => {
  console.error('Error no registrado:', err);
  
  // Registrar error crítico
  registrarLog('error', 'sistema', 'error_no_manejado', err.message, {
    stack: err.stack,
    ip_address: req.ip
  });
  
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 
      'Error interno del servidor' : 
      err.message
  });
});

// Iniciar servidor
// ================
// (solo al ejecutar "node app.js"; las pruebas importan la app sin abrir el puerto)
if (require.main === module) {
  // Respaldo automático de la base de datos cada 24 h (RESPALDO_AUTOMATICO=0 lo desactiva)
  require('./lib/respaldos').programar();
  app.listen(PORT, () => {
    console.log(`Servidor RSM iniciado en puerto ${PORT}`);
    console.log(`URL base: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
    console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;
      
      
      
