/* ============================================================================
   Módulo SMS · rutas de monitoreo, análisis, riesgo, acciones correctivas,
   notificaciones, exportación y auditoría.

   Consulta (sin sesión, igual que la vista general existente):
     GET  /api/sms/catalogos
     GET  /api/sms/reportes            tabla con filtros, orden y paginación
     GET  /api/sms/indicadores         tarjetas de indicadores (mismos filtros);
                                       con comparar=1 agrega el periodo anterior
     GET  /api/sms/analisis            datos de las gráficas (mismos filtros)
     GET  /api/sms/reportes/:folio/resumen   vista rápida
     GET  /api/sms/reportes/:folio/gestion   riesgo, acciones y línea de tiempo
     GET  /api/sms/matriz              matriz de riesgo configurada
     GET  /api/sms/exportar.xlsx       Excel personalizable (columnas con datos
                                       personales solo con permiso)
     GET  /vendor/jspdf*.js            bibliotecas del PDF (se arma en el navegador)
     GET  /api/sms/spi                 SPI configurados con sus series mensuales
     GET  /api/sms/spi/config          configuración de SPI
     GET  /api/sms/comparativo         comparación entre periodos
     GET  /api/sms/desempeno-areas     desempeño por área responsable
     GET  /api/sms/recurrencias        categorías y ubicaciones recurrentes
     GET  /api/sms/calidad-datos       revisión de consistencia (solo informa)
     GET  /api/sms/zonas               catálogo de zonas (si el módulo está activo)

   Con sesión (token Bearer) y rol:
     GET   /api/auth/sesion
     GET   /api/sms/reportes/:folio/reportante     personal interno (datos de quien reportó)
     PUT   /api/sms/matriz                         admin
     POST  /api/sms/reportes/:folio/riesgo         supervisor, admin (inicial o residual)
     POST  /api/sms/reportes/:folio/compromiso     editor (su área), supervisor, admin
     PUT   /api/sms/reportes/:folio/zona           editor (su área), supervisor, admin
     POST  /api/sms/reportes/:folio/acciones       editor (su área), supervisor, admin
     PATCH /api/sms/acciones/:id                   reprogramar / editar
     PATCH /api/sms/acciones/:id/estado            transición de estado
     POST  /api/sms/acciones/:id/evidencia         imágenes de la acción
     GET   /api/sms/notificaciones
     POST  /api/sms/notificaciones/leidas
     GET   /api/sms/auditoria                      supervisor, admin
     PUT   /api/sms/spi/config                     admin
     PUT   /api/sms/zonas/config                   admin
     POST  /api/sms/zonas · PATCH /api/sms/zonas/:id   admin
     GET   /api/sms/reportes/:folio/eliminacion   admin (vista previa)
     DELETE /api/sms/reportes/:folio              admin (con copia de respaldo)
     GET   /api/sms/eliminados · POST /api/sms/eliminados/:id/restaurar   admin
   ========================================================================= */
'use strict';

const express = require('express');
const path = require('path');

const riesgo = require('../lib/sms/riesgo');
const acciones = require('../lib/sms/acciones');
const filtrosLib = require('../lib/sms/filtros');
const consultas = require('../lib/sms/consultas');
const notificaciones = require('../lib/sms/notificaciones');
const auditoria = require('../lib/sms/auditoria');
const etapas = require('../lib/sms/etapas');
const spi = require('../lib/sms/spi');
const zonas = require('../lib/sms/zonas');
const eliminacion = require('../lib/sms/eliminacion');
const clasificacion = require('../lib/sms/clasificacion');
const { agruparLugares } = require('../lib/sms/lugares');
const exportarExcel = require('../lib/sms/exportar-excel');
const exportacion = require('../public/js/sms-exportacion');
const { crearAutenticacion, puede, capacidadesDe, puedeGestionarReporte } = require('../lib/sms/permisos');

const ESTADOS_REPORTE = { A: 'Generado', B: 'Enterado', C: 'En atención', D: 'Resuelto', E: 'Duplicado', F: 'No requiere atención' };

module.exports = function crearRutasSMS({ dbPool, secreto, upload, validateImageFiles, handleMulterError, storageService }) {
    const router = express.Router();
    const auth = crearAutenticacion({ dbPool, secreto });

    // ------------------------------------------------------------------ util
    const envolver = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

    function errorCliente(res, error, codigo = 400) {
        return res.status(codigo).json({ success: false, error: error.message || String(error), errores: error.errores });
    }

    async function contexto(req) {
        const matriz = await riesgo.obtenerMatriz(dbPool);
        const filtros = filtrosLib.leerFiltros(req.query, { nivelesRiesgo: matriz.niveles.map(n => n.clave) });
        return { matriz, filtros };
    }

    async function catalogoDepartamentos() {
        const [filas] = await dbPool.query('SELECT id, nombre, activo FROM departamentos ORDER BY activo DESC, orden_display, nombre');
        return filas;
    }

    async function reportePorFolio(db, folio) {
        const [filas] = await db.query('SELECT id, folio FROM reportes WHERE folio = ? LIMIT 1', [String(folio || '').slice(0, 50)]);
        return filas[0] || null;
    }

    async function filaBase(db, idReporte) {
        const [filas] = await db.query(`${consultas.BASE_CTE} SELECT b.* FROM base b WHERE b.id = ?`, [idReporte]);
        return filas.length ? consultas.mapearFila(filas[0]) : null;
    }

    async function departamentosDelReporte(db, idReporte) {
        const [filas] = await db.query(
            'SELECT id_departamento FROM reporte_departamento WHERE id_reporte = ?', [idReporte]);
        return filas.map(f => f.id_departamento);
    }

    async function catalogoZonas() {
        const cfg = await zonas.obtenerConfig(dbPool);
        return { habilitado: cfg.habilitado, zonas: cfg.habilitado ? await zonas.listar(dbPool, { soloActivas: false }) : [] };
    }

    /** Nombres de los catálogos para describir los filtros activos. */
    function nombresFiltros({ deps, matriz, z }) {
        return {
            departamentos: Object.fromEntries(deps.map(d => [d.id, d.nombre])),
            niveles: Object.fromEntries(matriz.niveles.map(n => [n.clave, n.nombre])),
            zonas: Object.fromEntries(z.zonas.map(x => [x.id, x.nombre]))
        };
    }

    /** Filtros sin fechas: los análisis por periodo aplican sus propios rangos. */
    function sinFechas(filtros) {
        const f = { ...filtros };
        delete f.desde; delete f.hasta; delete f.fecha;
        return f;
    }

    // -------------------------------------------------------------- páginas
    router.get('/reportes/analisis', (req, res) => res.render('reportes_analisis'));
    router.get('/reportes/ejecutivo', (req, res) => res.render('reporte_ejecutivo'));
    router.get('/admin/matriz-riesgo', (req, res) => res.render('matriz_riesgo'));
    router.get('/admin/auditoria', (req, res) => res.render('auditoria'));
    router.get('/admin/spi', (req, res) => res.render('spi_config'));
    router.get('/admin/zonas', (req, res) => res.render('zonas_config'));
    router.get('/notificaciones', (req, res) => res.render('notificaciones'));
    router.get('/admin/eliminados', (req, res) => res.render('reportes_eliminados'));
    router.get('/manual', (req, res) => res.render('manual'));

    // -------------------------------------------------------------- sesión
    router.get('/api/auth/sesion', auth.requiere(), (req, res) => {
        res.json({ success: true, usuario: req.usuario, capacidades: capacidadesDe(req.usuario) });
    });

    // ----------------------------------------------------------- catálogos
    router.get('/api/sms/catalogos', envolver(async (req, res) => {
        const matriz = await riesgo.obtenerMatriz(dbPool);
        const [categorias] = await dbPool.query(
            `SELECT nombre FROM (
                 SELECT DISTINCT tipo_problema AS nombre FROM reportes WHERE tipo_problema IS NOT NULL AND tipo_problema <> ''
                 UNION
                 SELECT nombre FROM tipos_problemas WHERE activo = 1
             ) t ORDER BY nombre`);
        const [departamentos, z] = await Promise.all([catalogoDepartamentos(), catalogoZonas()]);
        res.json({
            success: true,
            departamentos: departamentos.map(d => ({ id: d.id, nombre: d.nombre, activo: Boolean(d.activo) })),
            categorias: categorias.map(c => c.nombre),
            tipos_reporte: clasificacion.TIPOS_REPORTE,
            grupos_reporte: clasificacion.GRUPOS_REPORTE,
            estados: ESTADOS_REPORTE,
            niveles: matriz.niveles,
            matriz_validada: matriz.validada,
            dias_aviso: matriz.alertas.dias_aviso_vencimiento,
            zonas_habilitado: z.habilitado,
            zonas: z.zonas.map(x => ({ id: x.id, codigo: x.codigo, nombre: x.nombre, tipo: x.tipo, activo: x.activo }))
        });
    }));

    // ------------------------------------------------- tabla de reportes
    router.get('/api/sms/reportes', envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        const orden = filtrosLib.leerOrden(req.query);
        const pagina = filtrosLib.leerPagina(req.query);
        const [{ reportes, total }, deps, z, conteoTipos] = await Promise.all([
            consultas.listarReportes(dbPool, { filtros, orden, pagina, matriz }),
            catalogoDepartamentos(),
            catalogoZonas(),
            // Complementario: si falla, la tabla se muestra sin los atajos por tipo.
            // No depende de la página ni del orden: con conteo=0 se omite (la vista ya lo tiene)
            req.query.conteo === '0' ? undefined : consultas.conteoTipos(dbPool, { filtros, matriz })
                .catch(err => { console.error('Error al contar reportes por tipo:', err); return null; })
        ]);
        res.json({
            success: true,
            reportes,
            paginacion: {
                total,
                pagina: pagina.pagina,
                por_pagina: pagina.porPagina,
                paginas: Math.max(1, Math.ceil(total / pagina.porPagina))
            },
            orden,
            filtros,
            filtros_activos: filtrosLib.describirFiltros(filtros, nombresFiltros({ deps, matriz, z })),
            conteo_tipos: conteoTipos,
            dias_aviso: matriz.alertas.dias_aviso_vencimiento,
            hoy: acciones.hoyISO()
        });
    }));

    router.get('/api/sms/indicadores', envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        const principal = consultas.indicadores(dbPool, { filtros, matriz });
        if (req.query.comparar !== '1') return res.json({ success: true, indicadores: await principal });
        // La variación es complementaria: si falla, las tarjetas se muestran sin ella
        const comparacion = consultas.comparacionIndicadores(dbPool, { filtros, matriz, hoy: acciones.hoyISO(), principal })
            .catch(err => { console.error('Error al calcular la variación de indicadores:', err); return null; });
        const [indicadores, comp] = await Promise.all([principal, comparacion]);
        res.json({ success: true, indicadores, comparacion: comp });
    }));

    router.get('/api/sms/analisis', envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        const [datos, ind] = await Promise.all([
            consultas.analisis(dbPool, { filtros, matriz }),
            consultas.indicadores(dbPool, { filtros, matriz })
        ]);
        res.json({
            success: true,
            analisis: datos,
            indicadores: ind,
            matriz: { probabilidad: matriz.probabilidad, severidad: matriz.severidad, niveles: matriz.niveles, celdas: matriz.celdas, validada: matriz.validada }
        });
    }));

    // ---------------------------------------------------------- vista rápida
    router.get('/api/sms/reportes/:folio/resumen', envolver(async (req, res) => {
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        const fila = await filaBase(dbPool, rep.id);
        const [areas] = await dbPool.query(
            `SELECT d.id, d.nombre, rd.es_responsable,
                    (SELECT s.estado FROM seguimiento s WHERE s.id_reporte = rd.id_reporte AND s.id_departamento = d.id
                     ORDER BY s.fecha DESC, s.id DESC LIMIT 1) AS estado,
                    (SELECT MAX(s.fecha) FROM seguimiento s WHERE s.id_reporte = rd.id_reporte AND s.id_departamento = d.id) AS ultima
             FROM reporte_departamento rd JOIN departamentos d ON d.id = rd.id_departamento
             WHERE rd.id_reporte = ?
             ORDER BY rd.es_responsable DESC, d.nombre`, [rep.id]);
        const [todos] = await dbPool.query(
            `SELECT s.id, s.folio_seguimiento, s.estado, s.descripcion, s.fecha, d.nombre AS departamento
             FROM seguimiento s LEFT JOIN departamentos d ON d.id = s.id_departamento
             WHERE s.id_reporte = ? ORDER BY s.fecha DESC, s.id DESC`, [rep.id]);
        const movs = todos.slice(0, 5);
        const matriz = await riesgo.obtenerMatriz(dbPool);
        const [[{ evidencias }]] = await dbPool.query(
            `SELECT COUNT(*) AS evidencias FROM reportes_archivos WHERE id_reporte = ? AND (estado IS NULL OR estado <> 'deleted')`, [rep.id]);
        const [[{ movimientos }]] = await dbPool.query('SELECT COUNT(*) AS movimientos FROM seguimiento WHERE id_reporte = ?', [rep.id]);
        res.json({
            success: true,
            reporte: fila,
            areas: areas.map(a => ({ ...a, es_responsable: Boolean(a.es_responsable) })),
            seguimientos: movs,
            evidencias: Number(evidencias),
            movimientos: Number(movimientos),
            etapas: etapas.calcularEtapas({ fechaReporte: fila.fecha, estadoActual: fila.estado, seguimientos: todos }),
            semaforo: etapas.semaforo({ estado: fila.estado, fechaVencimiento: fila.fecha_vencimiento, plazoReporte: fila.plazo_reporte, fechaCierre: fila.fecha_cierre },
                acciones.hoyISO(), matriz.alertas.dias_aviso_vencimiento)
        });
    }));

    // ------------------------------------------ gestión del reporte (detalle)
    router.get('/api/sms/reportes/:folio/gestion', auth.opcional, envolver(async (req, res) => {
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        const u = req.usuario;
        const matriz = await riesgo.obtenerMatriz(dbPool);
        const fila = await filaBase(dbPool, rep.id);

        const [evaluaciones] = await dbPool.query(
            `SELECT id, tipo, probabilidad, severidad, indice, nivel, nivel_nombre, prioridad, plazo_dias, fecha_limite,
                    justificacion, medidas_mitigacion, evaluado_por_nombre, fecha
             FROM reporte_evaluacion_riesgo WHERE id_reporte = ? ORDER BY fecha DESC, id DESC`, [rep.id]);
        const [compromisos] = await dbPool.query(
            `SELECT c.id, c.fecha_compromiso, c.responsable_nombre, c.id_departamento_responsable, d.nombre AS departamento,
                    c.motivo, c.creado_por_nombre, c.creado_en
             FROM reporte_compromiso c LEFT JOIN departamentos d ON d.id = c.id_departamento_responsable
             WHERE c.id_reporte = ? ORDER BY c.creado_en DESC, c.id DESC`, [rep.id]);
        const [areasReporte] = await dbPool.query(
            `SELECT d.id, d.nombre, rd.es_responsable FROM reporte_departamento rd JOIN departamentos d ON d.id = rd.id_departamento
             WHERE rd.id_reporte = ? ORDER BY rd.es_responsable DESC, d.nombre`, [rep.id]);
        const zcfg = await zonas.obtenerConfig(dbPool);

        const [listaAcciones] = await dbPool.query(
            `SELECT a.*, d.nombre AS departamento_responsable
             FROM acciones_correctivas a LEFT JOIN departamentos d ON d.id = a.id_departamento_responsable
             WHERE a.id_reporte = ? ORDER BY a.estado = 'cancelada', a.fecha_compromiso, a.id`, [rep.id]);

        const gestionable = await puedeGestionarReporte(dbPool, u, rep.id);
        const interno = puede(u, 'ver_interno');
        const hoy = acciones.hoyISO();
        const diasAviso = matriz.alertas.dias_aviso_vencimiento;

        let accionesSalida = null;
        if (interno) {
            const ids = listaAcciones.map(a => a.id);
            let archivos = [];
            if (ids.length) {
                [archivos] = await dbPool.query(
                    `SELECT id, id_accion, ruta_original, ruta_thumbnail, ruta_optimizada, nombre_original, fecha_subida
                     FROM acciones_correctivas_archivos WHERE id_accion IN (?) ORDER BY id`, [ids]);
            }
            accionesSalida = listaAcciones.map(a => {
                const propia = puede(u, 'alcance_global') || (gestionable && (!a.id_departamento_responsable || a.id_departamento_responsable === u.id_departamento));
                const destinos = Object.keys(acciones.TRANSICIONES[a.estado] || {}).filter(dest => {
                    const cap = acciones.TRANSICIONES[a.estado][dest];
                    return puede(u, cap) && (cap === 'actualizar_accion' ? propia : true);
                });
                return {
                    ...a,
                    estado_nombre: acciones.ESTADOS[a.estado].nombre,
                    tipo_nombre: acciones.TIPOS[a.tipo],
                    vencimiento: acciones.ESTADOS[a.estado].abierta ? acciones.estadoVencimiento(a.fecha_compromiso, hoy, diasAviso) : null,
                    evidencias: archivos.filter(f => f.id_accion === a.id),
                    transiciones: destinos,
                    editable: propia && acciones.ESTADOS[a.estado].abierta && puede(u, 'actualizar_accion')
                };
            });
        }

        const eventos = interno ? await auditoria.eventosDeReporte(dbPool, rep.id) : [];
        const [seguimientos] = await dbPool.query(
            `SELECT s.id, s.folio_seguimiento, s.estado, s.descripcion, s.fecha, s.fecha_evento, s.tipo_accion,
                    d.nombre AS departamento, s.id_usuario,
                    ${interno ? "TRIM(CONCAT(COALESCE(us.nombre,''), ' ', COALESCE(us.apellidos,'')))" : 'NULL'} AS usuario
             FROM seguimiento s
             LEFT JOIN departamentos d ON d.id = s.id_departamento
             LEFT JOIN usuarios_departamento us ON us.id = s.id_usuario
             WHERE s.id_reporte = ? ORDER BY s.fecha ASC, s.id ASC`, [rep.id]);

        // Riesgo inicial vigente y residual posterior a él (si se reevaluó el inicial, el residual anterior ya no aplica)
        const inicial = evaluaciones.find(e => e.tipo === 'inicial') || null;
        const residual = inicial ? evaluaciones.find(e => e.tipo === 'residual' && new Date(e.fecha) >= new Date(inicial.fecha)) || null : null;
        const cerrado = etapas.CERRADOS.includes(fila.estado);
        const propiaArea = u && areasReporte.some(a => a.id === u.id_departamento);
        const puedeCompromiso = puede(u, 'asignar_compromiso') && !cerrado && (puede(u, 'alcance_global') || propiaArea);
        const puedeZona = zcfg.habilitado && puede(u, 'asignar_zona') && (puede(u, 'alcance_global') || propiaArea);

        res.json({
            success: true,
            reporte: fila,
            matriz: { probabilidad: matriz.probabilidad, severidad: matriz.severidad, niveles: matriz.niveles, celdas: matriz.celdas, validada: matriz.validada, validacion: matriz.validacion, nota: matriz.nota, consecuencias: matriz.consecuencias },
            riesgo: {
                vigente: evaluaciones[0] || null,
                inicial,
                residual,
                historial: interno ? evaluaciones : []
            },
            etapas: etapas.calcularEtapas({ fechaReporte: fila.fecha, estadoActual: fila.estado, seguimientos }),
            semaforo: etapas.semaforo({ estado: fila.estado, fechaVencimiento: fila.fecha_vencimiento, plazoReporte: fila.plazo_reporte, fechaCierre: fila.fecha_cierre }, hoy, diasAviso),
            compromiso: {
                vigente: compromisos[0] || null,
                historial: interno ? compromisos : []
            },
            areas: areasReporte.map(a => ({ id: a.id, nombre: a.nombre, es_responsable: Boolean(a.es_responsable) })),
            zonas: {
                habilitado: zcfg.habilitado,
                asignada: fila.zona,
                catalogo: puedeZona ? (await zonas.listar(dbPool, { soloActivas: true })).map(z => ({ id: z.id, codigo: z.codigo, nombre: z.nombre, tipo: z.tipo })) : []
            },
            acciones: accionesSalida,
            acciones_resumen: fila.acciones,
            cierre: acciones.evaluarCierre(listaAcciones),
            seguimientos,
            eventos: eventos.map(e => ({
                id: e.id, accion: e.accion, descripcion: e.descripcion, fecha: e.fecha,
                usuario: e.datos.usuario_nombre || null, departamento: e.datos.departamento || null, datos: e.datos
            })),
            sesion: u ? { nombre: u.nombre, rol: u.rol, departamento: u.departamento } : null,
            permisos: {
                interno,
                evaluar_riesgo: puede(u, 'evaluar_riesgo'),
                // Solo con criterios validados institucionalmente
                evaluar_habilitado: puede(u, 'evaluar_riesgo') && matriz.validada,
                registrar_accion: puede(u, 'registrar_accion') && gestionable,
                verificar_accion: puede(u, 'verificar_accion'),
                cancelar_accion: puede(u, 'cancelar_accion'),
                asignar_compromiso: puedeCompromiso,
                asignar_compromiso_global: puede(u, 'alcance_global'),
                asignar_zona: puedeZona,
                eliminar_reporte: puede(u, 'eliminar_reporte')
            },
            usuario_departamento: u ? u.id_departamento : null,
            dias_aviso: diasAviso
        });
    }));

    // -------------------------------------- datos de quien reportó (con sesión)
    // Nombre, teléfono, gerencia y cargo NO se muestran en las páginas públicas
    // del reporte: solo al personal con sesión.
    router.get('/api/sms/reportes/:folio/reportante', auth.requiere('ver_interno'), envolver(async (req, res) => {
        const [filas] = await dbPool.query(
            'SELECT nombre, telefono, area, cargo FROM reportes WHERE folio = ? LIMIT 1', [String(req.params.folio || '').slice(0, 50)]);
        if (!filas.length) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, reportante: filas[0] });
    }));

    // ------------------------------------------------------- matriz de riesgo
    router.get('/api/sms/matriz', envolver(async (req, res) => {
        res.json({ success: true, matriz: await riesgo.obtenerMatriz(dbPool), referencia: riesgo.MATRIZ_REFERENCIA });
    }));

    router.put('/api/sms/matriz', auth.requiere('configurar_matriz'), envolver(async (req, res) => {
        let anterior;
        let guardada;
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            anterior = await riesgo.obtenerMatriz(conn);
            const entrada = (req.body && req.body.matriz) || {};
            const candidata = riesgo.validarMatriz(entrada);
            // La validación institucional la firma el servidor: quién y cuándo.
            // Cualquier cambio de criterios con la casilla marcada se registra como nueva validación.
            const contenido = m => JSON.stringify([m.probabilidad, m.severidad, m.niveles, m.celdas, m.alertas, m.consecuencias || []]);
            const referencia = entrada.validacion && entrada.validacion.referencia ? String(entrada.validacion.referencia).trim().slice(0, 300) : null;
            let nuevaValidacion = false;
            if (candidata.validada) {
                nuevaValidacion = !anterior.validada || contenido(anterior) !== contenido(candidata);
                candidata.validacion = nuevaValidacion
                    ? { por: req.usuario.nombre, fecha: new Date().toISOString(), referencia }
                    : { ...(anterior.validacion || {}), referencia: referencia || (anterior.validacion || {}).referencia || null };
            }
            guardada = await riesgo.guardarMatriz(conn, candidata);
            await auditoria.auditar(conn, {
                accion: nuevaValidacion ? 'matriz_validada' : (anterior.validada && !guardada.validada ? 'matriz_validacion_retirada' : 'matriz_actualizada'),
                descripcion: nuevaValidacion
                    ? `Matriz de riesgo validada institucionalmente${referencia ? ' · ' + referencia : ''}`
                    : (anterior.validada && !guardada.validada ? 'Se retiró la validación de la matriz de riesgo' : 'Se actualizó la configuración de la matriz de riesgo'),
                usuario: req.usuario, req,
                datos: { antes: anterior, despues: guardada }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            return errorCliente(res, e);
        } finally {
            conn.release();
        }
        res.json({ success: true, matriz: guardada });
    }));

    // ---------------------------------------------------- evaluación de riesgo
    // tipo = inicial (peligro identificado) | residual (tras medidas de mitigación).
    // Solo se permite con una matriz validada institucionalmente.
    router.post('/api/sms/reportes/:folio/riesgo', auth.requiere('evaluar_riesgo'), envolver(async (req, res) => {
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        const matriz = await riesgo.obtenerMatriz(dbPool);
        if (!matriz.validada) {
            return res.status(409).json({
                success: false, codigo: 'matriz_no_validada',
                error: 'La matriz de riesgo aún no está validada institucionalmente. Un administrador debe validarla antes de registrar evaluaciones.'
            });
        }
        const b = req.body || {};
        const tipo = b.tipo === 'residual' ? 'residual' : 'inicial';
        let r;
        try {
            r = riesgo.clasificar(matriz, b.probabilidad, b.severidad);
        } catch (e) {
            return errorCliente(res, e);
        }
        const justificacion = String(b.justificacion || '').trim();
        if (justificacion.length < 10) return errorCliente(res, new Error('Justifica la evaluación (mínimo 10 caracteres)'));
        if (justificacion.length > 2000) return errorCliente(res, new Error('La justificación admite máximo 2000 caracteres'));
        const medidas = String(b.medidas_mitigacion || '').trim();
        if (medidas.length > 4000) return errorCliente(res, new Error('Las medidas de mitigación admiten máximo 4000 caracteres'));
        if (tipo === 'residual') {
            if (medidas.length < 10) return errorCliente(res, new Error('Describe las medidas de mitigación aplicadas (mínimo 10 caracteres)'));
            const [ini] = await dbPool.query("SELECT id FROM reporte_evaluacion_riesgo WHERE id_reporte = ? AND tipo = 'inicial' LIMIT 1", [rep.id]);
            if (!ini.length) return errorCliente(res, new Error('Registra primero la evaluación del riesgo inicial'));
        }
        // El plazo de atención lo fija el riesgo inicial; el residual no lo modifica
        const plazo = tipo === 'inicial' ? r.plazo_dias : null;

        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            const [ins] = await conn.query(
                `INSERT INTO reporte_evaluacion_riesgo
                    (id_reporte, tipo, probabilidad, severidad, indice, nivel, nivel_nombre, prioridad, plazo_dias, fecha_limite,
                     justificacion, medidas_mitigacion, version_matriz, evaluado_por, evaluado_por_nombre)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, DATE_ADD(CURDATE(), INTERVAL ? DAY)), ?, ?, ?, ?, ?)`,
                [rep.id, tipo, r.probabilidad, r.severidad, r.indice, r.nivel, r.nivel_nombre, r.prioridad, plazo,
                 plazo, plazo || 0, justificacion, medidas || null, matriz.version, req.usuario.id, req.usuario.nombre]);
            await auditoria.auditar(conn, {
                accion: tipo === 'inicial' ? 'riesgo_evaluado' : 'riesgo_residual_evaluado',
                descripcion: `Riesgo ${tipo} ${r.indice} · ${r.nivel_nombre}`,
                usuario: req.usuario, idReporte: rep.id, req,
                datos: { id_evaluacion: ins.insertId, tipo, ...r, justificacion, medidas_mitigacion: medidas || null, version_matriz: matriz.version }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        await notificaciones.notificar(dbPool, {
            tipo: 'riesgo_evaluado',
            titulo: `${rep.folio}: riesgo ${tipo} ${r.indice} (${r.nivel_nombre})`,
            mensaje: r.prioridad,
            idReporte: rep.id, folio: rep.folio,
            departamentos: await departamentosDelReporte(dbPool, rep.id),
            supervision: false
        });
        res.json({ success: true, evaluacion: { ...r, tipo } });
    }));

    // ------------------------------------------- compromiso de atención (plazo)
    router.post('/api/sms/reportes/:folio/compromiso', auth.requiere('asignar_compromiso'), envolver(async (req, res) => {
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        const u = req.usuario;
        const areasRep = await departamentosDelReporte(dbPool, rep.id);
        const global = puede(u, 'alcance_global');
        if (!global && !areasRep.includes(u.id_departamento)) {
            return res.status(403).json({ success: false, error: 'Tu área no está asignada a este reporte' });
        }
        const fila = await filaBase(dbPool, rep.id);
        if (etapas.CERRADOS.includes(fila.estado)) return errorCliente(res, new Error('El reporte está cerrado; no se le asignan fechas compromiso'));

        const b = req.body || {};
        const fecha = acciones.fechaISO(b.fecha_compromiso);
        if (!fecha) return errorCliente(res, new Error('Indica una fecha compromiso válida'));
        if (fecha < acciones.hoyISO()) return errorCliente(res, new Error('La fecha compromiso debe ser hoy o posterior'));
        const idArea = b.id_departamento_responsable ? Number(b.id_departamento_responsable) : null;
        if (idArea !== null && !areasRep.includes(idArea)) return errorCliente(res, new Error('El área responsable debe ser una de las áreas asociadas al reporte'));
        if (!global && idArea !== u.id_departamento) return errorCliente(res, new Error('Solo puedes registrar compromisos de tu propia área'));
        const responsable = String(b.responsable_nombre || '').trim().slice(0, 200) || null;
        const motivo = String(b.motivo || '').trim().slice(0, 1000);
        const [previos] = await dbPool.query(
            'SELECT fecha_compromiso, id_departamento_responsable, responsable_nombre FROM reporte_compromiso WHERE id_reporte = ? ORDER BY creado_en DESC, id DESC LIMIT 1', [rep.id]);
        const anterior = previos[0] || null;
        if (anterior && motivo.length < 5) return errorCliente(res, new Error('Indica el motivo del cambio (mínimo 5 caracteres)'));

        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            const [ins] = await conn.query(
                `INSERT INTO reporte_compromiso (id_reporte, id_departamento_responsable, responsable_nombre, fecha_compromiso, motivo, creado_por, creado_por_nombre)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [rep.id, idArea, responsable, fecha, motivo || null, u.id, u.nombre]);
            const antes = anterior ? acciones.hoyISO(anterior.fecha_compromiso) : null;
            await auditoria.auditar(conn, {
                accion: anterior ? 'compromiso_reprogramado' : 'compromiso_asignado',
                descripcion: anterior ? `Fecha compromiso: ${antes} → ${fecha}. ${motivo}` : `Fecha compromiso asignada: ${fecha}`,
                usuario: u, idReporte: rep.id, req,
                datos: {
                    id_compromiso: ins.insertId,
                    antes: anterior ? { ...anterior, fecha_compromiso: antes } : null,
                    despues: { fecha_compromiso: fecha, id_departamento_responsable: idArea, responsable_nombre: responsable },
                    motivo: motivo || null
                }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        await notificaciones.notificar(dbPool, {
            tipo: 'compromiso',
            titulo: `${rep.folio}: fecha compromiso ${fecha}`,
            mensaje: [responsable ? `Responsable: ${responsable}` : null, motivo || null].filter(Boolean).join('. ') || null,
            idReporte: rep.id, folio: rep.folio,
            departamentos: idArea ? [idArea] : areasRep,
            supervision: !global
        });
        res.status(201).json({ success: true, fecha_compromiso: fecha });
    }));

    // ------------------------------------------------ zona del hallazgo (opcional)
    router.put('/api/sms/reportes/:folio/zona', auth.requiere('asignar_zona'), envolver(async (req, res) => {
        const cfg = await zonas.obtenerConfig(dbPool);
        if (!cfg.habilitado) return res.status(409).json({ success: false, error: 'El módulo de zonas no está habilitado' });
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        const u = req.usuario;
        if (!puede(u, 'alcance_global') && !(await departamentosDelReporte(dbPool, rep.id)).includes(u.id_departamento)) {
            return res.status(403).json({ success: false, error: 'Tu área no está asignada a este reporte' });
        }
        const b = req.body || {};
        const idZona = b.id_zona ? Number(b.id_zona) : null;
        const nota = String(b.nota || '').trim().slice(0, 300) || null;
        let zona = null;
        if (idZona) {
            const [z] = await dbPool.query('SELECT id, nombre FROM zonas_aeropuerto WHERE id = ? AND activo = 1', [idZona]);
            if (!z.length) return errorCliente(res, new Error('La zona no existe o está inactiva'));
            zona = z[0];
        }
        const [prev] = await dbPool.query(
            'SELECT rz.id_zona, z.nombre FROM reporte_zona rz JOIN zonas_aeropuerto z ON z.id = rz.id_zona WHERE rz.id_reporte = ?', [rep.id]);
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            if (zona) {
                await conn.query(
                    `INSERT INTO reporte_zona (id_reporte, id_zona, nota, asignado_por, asignado_por_nombre) VALUES (?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE id_zona = VALUES(id_zona), nota = VALUES(nota), asignado_por = VALUES(asignado_por),
                                             asignado_por_nombre = VALUES(asignado_por_nombre), asignado_en = CURRENT_TIMESTAMP`,
                    [rep.id, zona.id, nota, u.id, u.nombre]);
            } else {
                await conn.query('DELETE FROM reporte_zona WHERE id_reporte = ?', [rep.id]);
            }
            await auditoria.auditar(conn, {
                accion: zona ? 'zona_asignada' : 'zona_retirada',
                descripcion: zona ? `Zona: ${prev.length ? prev[0].nombre + ' → ' : ''}${zona.nombre}` : 'Se retiró la zona asignada',
                usuario: u, idReporte: rep.id, req,
                datos: { antes: prev[0] || null, despues: zona, nota }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        res.json({ success: true, zona });
    }));

    // ------------------------------------------------- acciones correctivas
    async function cargarAccion(db, id) {
        const [filas] = await db.query(
            `SELECT a.*, r.folio FROM acciones_correctivas a JOIN reportes r ON r.id = a.id_reporte WHERE a.id = ? LIMIT 1`, [id]);
        return filas[0] || null;
    }

    async function puedeOperarAccion(usuario, accion) {
        if (puede(usuario, 'alcance_global')) return true;
        if (!(await puedeGestionarReporte(dbPool, usuario, accion.id_reporte))) return false;
        return !accion.id_departamento_responsable || accion.id_departamento_responsable === usuario.id_departamento;
    }

    router.post('/api/sms/reportes/:folio/acciones', auth.requiere('registrar_accion'), envolver(async (req, res) => {
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        if (!(await puedeGestionarReporte(dbPool, req.usuario, rep.id))) {
            return res.status(403).json({ success: false, error: 'Tu área no está asignada a este reporte' });
        }
        let datos;
        try {
            datos = acciones.validarNuevaAccion(req.body || {});
            if (datos.id_departamento_responsable) {
                const [d] = await dbPool.query('SELECT id FROM departamentos WHERE id = ?', [datos.id_departamento_responsable]);
                if (!d.length) throw new Error('El área responsable no existe');
            }
            // Un editor solo asigna acciones a su propia área
            if (!puede(req.usuario, 'alcance_global') && datos.id_departamento_responsable && datos.id_departamento_responsable !== req.usuario.id_departamento) {
                throw new Error('Solo puedes asignar acciones a tu propia área');
            }
        } catch (e) {
            return errorCliente(res, e);
        }
        const fila = await filaBase(dbPool, rep.id);
        if (['D', 'E', 'F'].includes(fila.estado)) {
            return errorCliente(res, new Error('El reporte está cerrado; no se pueden registrar acciones nuevas'));
        }

        const conn = await dbPool.getConnection();
        let id;
        try {
            await conn.beginTransaction();
            const [ins] = await conn.query(
                `INSERT INTO acciones_correctivas
                    (id_reporte, tipo, descripcion, id_departamento_responsable, responsable_nombre, fecha_asignacion,
                     fecha_compromiso, observaciones, creado_por, creado_por_nombre)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [rep.id, datos.tipo, datos.descripcion, datos.id_departamento_responsable, datos.responsable_nombre,
                 datos.fecha_asignacion, datos.fecha_compromiso, datos.observaciones, req.usuario.id, req.usuario.nombre]);
            id = ins.insertId;
            await auditoria.auditar(conn, {
                accion: 'accion_registrada',
                descripcion: `Acción ${acciones.TIPOS[datos.tipo].toLowerCase()} registrada (compromiso ${datos.fecha_compromiso})`,
                usuario: req.usuario, idReporte: rep.id, req,
                datos: { id_accion: id, ...datos }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        if (datos.id_departamento_responsable) {
            await notificaciones.notificar(dbPool, {
                tipo: 'accion_asignada',
                titulo: `${rep.folio}: acción ${acciones.TIPOS[datos.tipo].toLowerCase()} asignada`,
                mensaje: `Compromiso: ${datos.fecha_compromiso}. ${datos.descripcion.slice(0, 200)}`,
                idReporte: rep.id, folio: rep.folio,
                departamentos: [datos.id_departamento_responsable],
                supervision: false
            });
        }
        res.status(201).json({ success: true, id });
    }));

    // Reprogramar / editar datos de una acción abierta
    router.patch('/api/sms/acciones/:id', auth.requiere('actualizar_accion'), envolver(async (req, res) => {
        const accion = await cargarAccion(dbPool, Number(req.params.id));
        if (!accion) return res.status(404).json({ success: false, error: 'Acción no encontrada' });
        if (!(await puedeOperarAccion(req.usuario, accion))) return res.status(403).json({ success: false, error: 'No puedes modificar esta acción' });
        if (!acciones.ESTADOS[accion.estado].abierta) return errorCliente(res, new Error('Solo se pueden editar acciones pendientes o en proceso'));

        const cambios = {};
        const b = req.body || {};
        if (b.fecha_compromiso !== undefined) {
            const f = acciones.fechaISO(b.fecha_compromiso);
            if (!f) return errorCliente(res, new Error('Fecha compromiso no válida'));
            const asign = acciones.hoyISO(accion.fecha_asignacion);
            if (f < asign) return errorCliente(res, new Error('La fecha compromiso no puede ser anterior a la de asignación'));
            cambios.fecha_compromiso = f;
        }
        if (b.observaciones !== undefined) cambios.observaciones = String(b.observaciones || '').trim().slice(0, 2000) || null;
        if (b.responsable_nombre !== undefined) cambios.responsable_nombre = String(b.responsable_nombre || '').trim().slice(0, 200) || null;
        if (b.descripcion !== undefined) {
            const d = String(b.descripcion || '').trim();
            if (d.length < 5 || d.length > 2000) return errorCliente(res, new Error('La descripción debe tener entre 5 y 2000 caracteres'));
            cambios.descripcion = d;
        }
        if (!Object.keys(cambios).length) return errorCliente(res, new Error('No hay cambios que guardar'));
        const motivo = String(b.motivo || '').trim();
        if (cambios.fecha_compromiso && !motivo) return errorCliente(res, new Error('Indica el motivo de la reprogramación'));

        const antes = {};
        for (const k of Object.keys(cambios)) antes[k] = k === 'fecha_compromiso' ? acciones.hoyISO(accion[k]) : accion[k];
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('UPDATE acciones_correctivas SET ? WHERE id = ?', [cambios, accion.id]);
            await auditoria.auditar(conn, {
                accion: cambios.fecha_compromiso ? 'accion_reprogramada' : 'accion_editada',
                descripcion: cambios.fecha_compromiso
                    ? `Fecha compromiso: ${antes.fecha_compromiso} → ${cambios.fecha_compromiso}. ${motivo}`
                    : 'Se editaron los datos de la acción',
                usuario: req.usuario, idReporte: accion.id_reporte, req,
                datos: { id_accion: accion.id, antes, despues: cambios, motivo }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        res.json({ success: true });
    }));

    router.patch('/api/sms/acciones/:id/estado', auth.requiere('ver_interno'), envolver(async (req, res) => {
        const accion = await cargarAccion(dbPool, Number(req.params.id));
        if (!accion) return res.status(404).json({ success: false, error: 'Acción no encontrada' });
        const nuevo = String((req.body || {}).estado || '');
        const comentario = String((req.body || {}).comentario || '').trim().slice(0, 2000);
        let capacidad;
        try {
            capacidad = acciones.validarTransicion(accion.estado, nuevo, { comentario });
        } catch (e) {
            return errorCliente(res, e);
        }
        if (!puede(req.usuario, capacidad)) return res.status(403).json({ success: false, error: 'Tu rol no puede realizar este cambio' });
        if (capacidad === 'actualizar_accion' && !(await puedeOperarAccion(req.usuario, accion))) {
            return res.status(403).json({ success: false, error: 'No puedes modificar esta acción' });
        }

        const cambios = { estado: nuevo };
        let nuevaFecha = null;
        if (nuevo === 'completada') {
            cambios.fecha_cumplimiento = new Date();
            if (comentario) cambios.observaciones = comentario;
        }
        if (accion.estado === 'completada' && nuevo === 'verificada') {
            Object.assign(cambios, { efectividad: 'efectiva', verificacion_comentario: comentario || null, verificado_por: req.usuario.id, verificado_por_nombre: req.usuario.nombre, fecha_verificacion: new Date() });
        }
        if (accion.estado === 'completada' && nuevo === 'en_proceso') {
            Object.assign(cambios, { efectividad: 'no_efectiva', verificacion_comentario: comentario, verificado_por: req.usuario.id, verificado_por_nombre: req.usuario.nombre, fecha_verificacion: new Date(), fecha_cumplimiento: null });
            if (req.body.fecha_compromiso) {
                nuevaFecha = acciones.fechaISO(req.body.fecha_compromiso);
                if (!nuevaFecha || nuevaFecha < acciones.hoyISO()) return errorCliente(res, new Error('La nueva fecha compromiso debe ser hoy o posterior'));
                cambios.fecha_compromiso = nuevaFecha;
            }
        }
        if (nuevo === 'cancelada') cambios.verificacion_comentario = comentario;

        const etiquetas = {
            en_proceso: accion.estado === 'completada' ? 'Verificación: no efectiva, se reabre' : 'Acción en proceso',
            completada: 'Acción concluida, pendiente de verificar su efectividad',
            verificada: 'Efectividad verificada',
            cancelada: 'Acción cancelada'
        };
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            const [upd] = await conn.query('UPDATE acciones_correctivas SET ? WHERE id = ? AND estado = ?', [cambios, accion.id, accion.estado]);
            if (!upd.affectedRows) throw Object.assign(new Error('La acción cambió mientras la editabas. Recarga e intenta de nuevo.'), { conflicto: true });
            await auditoria.auditar(conn, {
                accion: `accion_${nuevo === 'en_proceso' && accion.estado === 'completada' ? 'reabierta' : nuevo}`,
                descripcion: etiquetas[nuevo] + (comentario ? `. ${comentario}` : ''),
                usuario: req.usuario, idReporte: accion.id_reporte, req,
                datos: { id_accion: accion.id, estado_anterior: accion.estado, estado_nuevo: nuevo, comentario, nueva_fecha_compromiso: nuevaFecha }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            if (e.conflicto) return errorCliente(res, e, 409);
            throw e;
        } finally {
            conn.release();
        }

        if (nuevo === 'completada') {
            await notificaciones.notificar(dbPool, {
                tipo: 'validacion_pendiente',
                titulo: `${accion.folio}: acción por verificar`,
                mensaje: accion.descripcion.slice(0, 200),
                idReporte: accion.id_reporte, folio: accion.folio, supervision: true
            });
        } else if (accion.estado === 'completada' && nuevo === 'en_proceso' && accion.id_departamento_responsable) {
            await notificaciones.notificar(dbPool, {
                tipo: 'accion_reabierta',
                titulo: `${accion.folio}: acción reabierta (no efectiva)`,
                mensaje: comentario.slice(0, 300),
                idReporte: accion.id_reporte, folio: accion.folio,
                departamentos: [accion.id_departamento_responsable], supervision: false
            });
        }
        res.json({ success: true, estado: nuevo });
    }));

    router.post('/api/sms/acciones/:id/evidencia', auth.requiere('actualizar_accion'),
        upload.array('evidencia', 3), handleMulterError, validateImageFiles, envolver(async (req, res) => {
            const accion = await cargarAccion(dbPool, Number(req.params.id));
            if (!accion) return res.status(404).json({ success: false, error: 'Acción no encontrada' });
            if (!(await puedeOperarAccion(req.usuario, accion))) return res.status(403).json({ success: false, error: 'No puedes modificar esta acción' });
            if (['verificada', 'cancelada'].includes(accion.estado)) return errorCliente(res, new Error('La acción ya está cerrada'));
            const archivos = req.files || [];
            if (!archivos.length) return errorCliente(res, new Error('Adjunta al menos una imagen'));
            const [[{ n }]] = await dbPool.query('SELECT COUNT(*) AS n FROM acciones_correctivas_archivos WHERE id_accion = ?', [accion.id]);
            if (Number(n) + archivos.length > 6) return errorCliente(res, new Error('Cada acción admite máximo 6 imágenes'));

            const guardados = [];
            for (let i = 0; i < archivos.length; i++) {
                const f = archivos[i];
                const r = await storageService.uploadImageSeguimiento(f.buffer, f.originalname, f.mimetype, accion.folio, `${accion.folio}-AC${accion.id}`, Number(n) + i + 1);
                const [ins] = await dbPool.query(
                    `INSERT INTO acciones_correctivas_archivos (id_accion, ruta_original, ruta_thumbnail, ruta_optimizada, nombre_original, mime_type, tamano_bytes, subido_por)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [accion.id, r.ruta_original, r.ruta_thumbnail, r.ruta_optimizada, r.nombre_original, r.tipo_mime, r.tamano_bytes_original, req.usuario.id]);
                guardados.push({ id: ins.insertId, ruta_thumbnail: r.ruta_thumbnail, ruta_optimizada: r.ruta_optimizada });
            }
            await auditoria.auditar(dbPool, {
                accion: 'accion_evidencia',
                descripcion: `${guardados.length} imagen(es) agregada(s) como evidencia`,
                usuario: req.usuario, idReporte: accion.id_reporte, req,
                datos: { id_accion: accion.id, archivos: guardados.map(g => g.id) }
            });
            res.status(201).json({ success: true, archivos: guardados });
        }));

    // ------------------------------------------------------ análisis avanzado
    /** Meses a mostrar: los del filtro de fechas o los últimos 12 con registros. */
    function mesesAnalisis(filtros, filas, listaAcciones) {
        if (filtros.desde || filtros.hasta || filtros.fecha) {
            const d = (filtros.fecha || filtros.desde || filtros.hasta).slice(0, 7);
            const h = (filtros.fecha || filtros.hasta || acciones.hoyISO()).slice(0, 7);
            return consultas.mesesEntre(d, h).slice(-24);
        }
        const fechas = [];
        for (const f of filas) for (const k of ['fecha', 'fecha_cierre', 'fecha_resolucion']) { const m = spi.mesDe(f[k]); if (m) fechas.push(m); }
        for (const a of listaAcciones) for (const k of ['fecha_cumplimiento', 'fecha_verificacion']) { const m = spi.mesDe(a[k]); if (m) fechas.push(m); }
        const fin = fechas.length ? fechas.sort()[fechas.length - 1] : spi.mesDe(new Date());
        const [y, m] = fin.split('-').map(Number);
        const ini = new Date(y, m - 12, 1);
        return consultas.mesesEntre(spi.mesDe(ini), fin);
    }

    router.get('/api/sms/spi/config', envolver(async (req, res) => {
        const cfg = await spi.obtenerConfig(dbPool);
        res.json({
            success: true,
            config: cfg,
            metricas: Object.fromEntries(Object.entries(spi.METRICAS).map(([k, v]) => [k, { nombre: v.nombre, unidad: v.unidad, formato: v.formato, direccion: v.direccion, descripcion: v.descripcion }]))
        });
    }));

    router.put('/api/sms/spi/config', auth.requiere('configurar_spi'), envolver(async (req, res) => {
        const [cats] = await dbPool.query(
            `SELECT nombre FROM (SELECT DISTINCT tipo_problema AS nombre FROM reportes WHERE tipo_problema IS NOT NULL AND tipo_problema <> ''
             UNION SELECT nombre FROM tipos_problemas) t`);
        let cfg;
        const anterior = await spi.obtenerConfig(dbPool);
        try {
            cfg = spi.validarConfig((req.body && req.body.config) || {}, { categorias: cats.map(c => c.nombre) });
        } catch (e) {
            return errorCliente(res, e);
        }
        const contenido = c => JSON.stringify([c.indicadores, c.umbral_recurrencia, c.ventana_recurrencia_dias]);
        if (cfg.validado) {
            const nueva = !anterior.validado || contenido(anterior) !== contenido(cfg);
            cfg.validado_por = nueva ? req.usuario.nombre : anterior.validado_por;
            cfg.fecha_validacion = nueva ? new Date().toISOString() : anterior.fecha_validacion;
        } else {
            cfg.validado_por = null;
            cfg.fecha_validacion = null;
        }
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            await spi.guardarConfig(conn, cfg);
            await auditoria.auditar(conn, {
                accion: 'spi_actualizados',
                descripcion: `Configuración de SPI actualizada (${cfg.indicadores.length} indicador(es)${cfg.validado ? ', validada' : ''})`,
                usuario: req.usuario, req,
                datos: { antes: anterior, despues: cfg }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        res.json({ success: true, config: cfg });
    }));

    router.get('/api/sms/spi', envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        const cfg = await spi.obtenerConfig(dbPool);
        const filas = await consultas.filasAnalisis(dbPool, { filtros: sinFechas(filtros), matriz });
        const lista = await consultas.accionesDeReportes(dbPool, filas.map(f => f.id));
        const meses = mesesAnalisis(filtros, filas, lista);
        const nivelesAltos = consultas.opcionesMatriz(matriz).nivelesAltos;
        // Catálogo completo (sin metas) para la vista previa de la configuración
        const catalogo = req.query.catalogo === '1'
            ? Object.keys(spi.METRICAS).map(k => ({ metrica: k, serie: meses.map(mes => ({ mes, ...spi.valorMensual(k, mes, { filas, acciones: lista, nivelesAltos }) })) }))
            : undefined;
        res.json({
            success: true,
            meses,
            indicadores: spi.calcularSPI(cfg, { filas, acciones: lista, meses, nivelesAltos }),
            configurados: cfg.indicadores.length,
            validado: cfg.validado,
            validado_por: cfg.validado_por,
            fecha_validacion: cfg.fecha_validacion,
            catalogo
        });
    }));

    router.get('/api/sms/comparativo', envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        const modo = req.query.modo === 'anio' ? 'anio' : 'anterior';
        const filas = await consultas.filasAnalisis(dbPool, { filtros: sinFechas(filtros), matriz });
        const lista = await consultas.accionesDeReportes(dbPool, filas.map(f => f.id));
        let desde = filtros.fecha || filtros.desde || null;
        let hasta = filtros.fecha || filtros.hasta || null;
        let automatico = false;
        if (!desde || !hasta) {
            // Sin rango: el último mes con reportes completo frente al mes anterior
            automatico = true;
            const ultimo = filas.length ? spi.mesDe(filas[filas.length - 1].fecha) : spi.mesDe(new Date());
            const [y, m] = ultimo.split('-').map(Number);
            desde = desde || `${ultimo}-01`;
            hasta = hasta || `${ultimo}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
        }
        let previo = spi.periodoComparacion(desde, hasta, modo);
        if (automatico && modo === 'anterior') {
            // Mes calendario anterior completo
            const [y, m] = desde.split('-').map(Number);
            const ini = new Date(y, m - 2, 1);
            const fin = new Date(y, m - 1, 0);
            previo = { desde: spi.diaDe(ini), hasta: spi.diaDe(fin) };
        }
        const op = { nivelesAltos: consultas.opcionesMatriz(matriz).nivelesAltos };
        res.json({
            success: true,
            modo,
            automatico,
            actual: spi.resumenPeriodo(filas, lista, desde, hasta, op),
            anterior: spi.resumenPeriodo(filas, lista, previo.desde, previo.hasta, op)
        });
    }));

    router.get('/api/sms/desempeno-areas', envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        res.json({ success: true, ...(await consultas.desempenoAreas(dbPool, { filtros, matriz })) });
    }));

    router.get('/api/sms/recurrencias', envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        const [cfg, zcfg, filas] = await Promise.all([
            spi.obtenerConfig(dbPool),
            zonas.obtenerConfig(dbPool),
            consultas.filasAnalisis(dbPool, { filtros, matriz })
        ]);
        const umbral = cfg.umbral_recurrencia;
        const ventana = cfg.ventana_recurrencia_dias;
        const fin = filtros.fecha || filtros.hasta || (filas.length ? spi.diaDe(filas[filas.length - 1].fecha) : acciones.hoyISO());
        const iniD = new Date(fin + 'T00:00:00Z');
        iniD.setUTCDate(iniD.getUTCDate() - (ventana - 1));
        const ini = iniD.toISOString().slice(0, 10);
        const resumenGrupo = g => {
            const enVentana = g.filas.filter(f => spi.enRango(f.fecha, ini, fin));
            const cats = {};
            g.filas.forEach(f => { cats[f.tipo_problema] = (cats[f.tipo_problema] || 0) + 1; });
            return {
                etiqueta: g.etiqueta,
                n: g.n,
                en_ventana: enVentana.length,
                abiertos: g.filas.filter(f => !etapas.CERRADOS.includes(f.estado)).length,
                ultima: g.filas.reduce((m, f) => { const d = spi.diaDe(f.fecha); return d > m ? d : m; }, ''),
                recurrente: enVentana.length >= umbral,
                textos: g.textos,
                categorias: Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nombre, n]) => ({ nombre, n })),
                folios: g.filas.slice(-6).reverse().map(f => f.folio)
            };
        };
        const lugares = agruparLugares(filas).map(resumenGrupo)
            .sort((a, b) => b.en_ventana - a.en_ventana || b.n - a.n);
        let porZona = null;
        if (zcfg.habilitado) {
            const mapa = new Map();
            filas.filter(f => f.id_zona).forEach(f => {
                if (!mapa.has(f.id_zona)) mapa.set(f.id_zona, { etiqueta: f.zona_nombre, n: 0, textos: [], filas: [] });
                const g = mapa.get(f.id_zona); g.n++; g.filas.push(f);
            });
            porZona = {
                grupos: [...mapa.values()].map(resumenGrupo).sort((a, b) => b.en_ventana - a.en_ventana || b.n - a.n),
                sin_zona: filas.filter(f => !f.id_zona).length
            };
        }
        res.json({
            success: true,
            umbral,
            ventana_dias: ventana,
            ventana: { desde: ini, hasta: fin },
            total: filas.length,
            categorias: spi.categoriasRecurrentes(filas, { umbral, ventanaDias: ventana, hasta: fin }).slice(0, 15),
            lugares: lugares.slice(0, 15),
            lugares_total: lugares.length,
            sin_lugar: filas.length - lugares.reduce((s, g) => s + g.n, 0),
            zonas: porZona
        });
    }));

    router.get('/api/sms/calidad-datos', envolver(async (req, res) => {
        const matriz = await riesgo.obtenerMatriz(dbPool);
        const [bloques, ind] = await Promise.all([
            consultas.calidadDatos(dbPool),
            consultas.indicadores(dbPool, { filtros: {}, matriz })
        ]);
        res.json({ success: true, bloques, coherencia: ind.coherencia, totales: {
            total: ind.total, abiertos: ind.abiertos, nuevos: ind.nuevos, en_atencion: ind.en_atencion,
            cerrados: ind.cerrados, resueltos: ind.resueltos, duplicados: ind.duplicados, no_requiere: ind.no_requiere
        } });
    }));

    // ---------------------------------------------------------- zonas (opcional)
    router.get('/api/sms/zonas', envolver(async (req, res) => {
        const cfg = await zonas.obtenerConfig(dbPool);
        res.json({ success: true, habilitado: cfg.habilitado, tipos: zonas.TIPOS, zonas: await zonas.listar(dbPool) });
    }));

    router.put('/api/sms/zonas/config', auth.requiere('configurar_zonas'), envolver(async (req, res) => {
        const antes = await zonas.obtenerConfig(dbPool);
        const cfg = await zonas.guardarConfig(dbPool, { habilitado: req.body && req.body.habilitado });
        await auditoria.auditar(dbPool, {
            accion: 'zonas_configuradas',
            descripcion: `Módulo de zonas ${cfg.habilitado ? 'habilitado' : 'deshabilitado'}`,
            usuario: req.usuario, req, datos: { antes, despues: cfg }
        });
        res.json({ success: true, ...cfg });
    }));

    router.post('/api/sms/zonas', auth.requiere('configurar_zonas'), envolver(async (req, res) => {
        let z;
        try { z = zonas.validarZona(req.body || {}); } catch (e) { return errorCliente(res, e); }
        try {
            const [ins] = await dbPool.query('INSERT INTO zonas_aeropuerto SET ?', [{ ...z, activo: z.activo ? 1 : 0 }]);
            await auditoria.auditar(dbPool, { accion: 'zona_creada', descripcion: `Zona ${z.codigo} · ${z.nombre}`, usuario: req.usuario, req, datos: { id: ins.insertId, ...z } });
            res.status(201).json({ success: true, id: ins.insertId });
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return errorCliente(res, new Error(`Ya existe una zona con el código ${z.codigo}`), 409);
            throw e;
        }
    }));

    router.patch('/api/sms/zonas/:id', auth.requiere('configurar_zonas'), envolver(async (req, res) => {
        const id = Number(req.params.id);
        const [prev] = await dbPool.query('SELECT * FROM zonas_aeropuerto WHERE id = ?', [id]);
        if (!prev.length) return res.status(404).json({ success: false, error: 'Zona no encontrada' });
        let z;
        try { z = zonas.validarZona({ ...prev[0], activo: Boolean(prev[0].activo), ...(req.body || {}) }); } catch (e) { return errorCliente(res, e); }
        try {
            await dbPool.query('UPDATE zonas_aeropuerto SET ? WHERE id = ?', [{ ...z, activo: z.activo ? 1 : 0 }, id]);
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return errorCliente(res, new Error(`Ya existe una zona con el código ${z.codigo}`), 409);
            throw e;
        }
        await auditoria.auditar(dbPool, { accion: 'zona_actualizada', descripcion: `Zona ${z.codigo} · ${z.nombre}${z.activo ? '' : ' (inactiva)'}`, usuario: req.usuario, req, datos: { id, antes: prev[0], despues: z } });
        res.json({ success: true });
    }));

    // ------------------------------------------- eliminación de reportes (admin)
    // Copia completa en reportes_eliminados + eliminación en cascada + bitácora.
    // Se puede restaurar. El folio no se vuelve a asignar.
    router.get('/api/sms/reportes/:folio/eliminacion', auth.requiere('eliminar_reporte'), envolver(async (req, res) => {
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        const copia = await eliminacion.capturar(dbPool, rep.id);
        const fila = await filaBase(dbPool, rep.id);
        res.json({ success: true, folio: rep.folio, tipo_problema: fila.tipo_problema, estado: fila.estado, fecha: fila.fecha, resumen: eliminacion.resumen(copia) });
    }));

    router.delete('/api/sms/reportes/:folio', auth.requiere('eliminar_reporte'), envolver(async (req, res) => {
        const rep = await reportePorFolio(dbPool, req.params.folio);
        if (!rep) return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        const b = req.body || {};
        const motivo = String(b.motivo || '').trim();
        if (motivo.length < 10) return errorCliente(res, new Error('Indica el motivo de la eliminación (mínimo 10 caracteres)'));
        if (motivo.length > 1000) return errorCliente(res, new Error('El motivo admite máximo 1000 caracteres'));
        if (String(b.confirmacion || '').trim().toUpperCase() !== rep.folio.toUpperCase()) {
            return errorCliente(res, new Error(`Escribe el folio ${rep.folio} para confirmar`));
        }
        const fila = await filaBase(dbPool, rep.id);
        const conn = await dbPool.getConnection();
        let resumen;
        try {
            await conn.beginTransaction();
            const copia = await eliminacion.capturar(conn, rep.id);
            resumen = eliminacion.resumen(copia);
            const original = copia.tablas.reportes[0];
            await conn.query(
                `INSERT INTO reportes_eliminados
                    (id_reporte, folio, tipo_problema, fecha_reporte, estado, resumen, datos, motivo, eliminado_por, eliminado_por_nombre)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [rep.id, rep.folio, String(original.tipo_problema || '').slice(0, 150), original.fecha, fila.estado,
                 JSON.stringify(resumen), JSON.stringify(copia), motivo, req.usuario.id, req.usuario.nombre]);
            await conn.query('DELETE FROM reportes WHERE id = ?', [rep.id]);
            await auditoria.auditar(conn, {
                accion: 'reporte_eliminado',
                descripcion: `Reporte ${rep.folio} eliminado. Motivo: ${motivo}`,
                usuario: req.usuario, idReporte: rep.id, req,
                datos: { folio: rep.folio, estado: fila.estado, tipo_problema: original.tipo_problema, resumen, motivo }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
        res.json({ success: true, folio: rep.folio, resumen });
    }));

    router.get('/api/sms/eliminados', auth.requiere('eliminar_reporte'), envolver(async (req, res) => {
        const [filas] = await dbPool.query(
            `SELECT id, id_reporte, folio, tipo_problema, fecha_reporte, estado, resumen, motivo,
                    eliminado_por_nombre, eliminado_en, restaurado_por_nombre, restaurado_en
             FROM reportes_eliminados ORDER BY eliminado_en DESC, id DESC LIMIT 500`);
        res.json({
            success: true,
            eliminados: filas.map(f => ({ ...f, resumen: typeof f.resumen === 'string' ? JSON.parse(f.resumen) : (f.resumen || {}) }))
        });
    }));

    router.post('/api/sms/eliminados/:id/restaurar', auth.requiere('eliminar_reporte'), envolver(async (req, res) => {
        const [[arch]] = await dbPool.query('SELECT * FROM reportes_eliminados WHERE id = ?', [Number(req.params.id)]);
        if (!arch) return res.status(404).json({ success: false, error: 'Registro no encontrado' });
        if (arch.restaurado_en) return errorCliente(res, new Error('Este reporte ya se restauró'), 409);
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            await eliminacion.restaurar(conn, JSON.parse(arch.datos));
            await conn.query('UPDATE reportes_eliminados SET restaurado_por = ?, restaurado_por_nombre = ?, restaurado_en = CURRENT_TIMESTAMP WHERE id = ?',
                [req.usuario.id, req.usuario.nombre, arch.id]);
            await auditoria.auditar(conn, {
                accion: 'reporte_restaurado',
                descripcion: `Reporte ${arch.folio} restaurado (eliminado el ${new Date(arch.eliminado_en).toLocaleDateString('es-MX')})`,
                usuario: req.usuario, idReporte: arch.id_reporte, req,
                datos: { folio: arch.folio, id_archivo: arch.id }
            });
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            if (e.status) return errorCliente(res, e, e.status);
            throw e;
        } finally {
            conn.release();
        }
        res.json({ success: true, folio: arch.folio });
    }));

    // ---------------------------------------------------------- notificaciones
    router.get('/api/sms/notificaciones', auth.requiere(), envolver(async (req, res) => {
        const matriz = await riesgo.obtenerMatriz(dbPool);
        const limite = Math.max(1, Math.min(100, parseInt(req.query.limite, 10) || 30));
        const offset = Math.max(0, Math.min(100000, parseInt(req.query.offset, 10) || 0));
        const dias = Math.max(1, Math.min(365, parseInt(req.query.dias, 10) || 60));
        const tipo = /^[a-z_]{1,40}$/.test(String(req.query.tipo || '')) ? req.query.tipo : null;
        const [ev, al] = await Promise.all([
            notificaciones.listarEventos(dbPool, req.usuario, { limite, offset, dias, tipo, soloNoLeidas: req.query.no_leidas === '1' }),
            notificaciones.alertasVigentes(dbPool, req.usuario, matriz)
        ]);
        res.json({ success: true, ...ev, alertas: al, tipos: notificaciones.TIPOS });
    }));

    router.post('/api/sms/notificaciones/leidas', auth.requiere(), envolver(async (req, res) => {
        const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : null;
        const n = await notificaciones.marcarLeidas(dbPool, req.usuario, ids);
        res.json({ success: true, marcadas: n });
    }));

    // --------------------------------------------------------------- auditoría
    router.get('/api/sms/auditoria', auth.requiere('ver_auditoria'), envolver(async (req, res) => {
        const pagina = Math.max(1, Math.min(100000, parseInt(req.query.pagina, 10) || 1));
        const accion = /^[a-z_]{1,60}$/.test(String(req.query.accion || '')) ? req.query.accion : null;
        const folio = /^[A-Za-z0-9-]{1,50}$/.test(String(req.query.folio || '')) ? String(req.query.folio).toUpperCase() : null;
        const fechaOk = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;
        const datos = await auditoria.listar(dbPool, { pagina, porPagina: 50, accion, folio, desde: fechaOk(req.query.desde), hasta: fechaOk(req.query.hasta) });
        res.json({ success: true, ...datos, pagina, por_pagina: 50 });
    }));

    // --------------------------------------------------------------- exportación
    // Bibliotecas del PDF: el documento se arma en el navegador y solo se piden al exportar
    const ARCHIVOS_VENDOR = {
        'jspdf.umd.min.js': () => path.join(path.dirname(require.resolve('jspdf')), 'jspdf.umd.min.js'),
        'jspdf.plugin.autotable.min.js': () => path.join(path.dirname(require.resolve('jspdf-autotable')), 'jspdf.plugin.autotable.min.js')
    };
    router.get('/vendor/:archivo', (req, res, next) => {
        const ruta = ARCHIVOS_VENDOR[req.params.archivo];
        if (!ruta) return next();
        res.type('application/javascript');
        res.sendFile(ruta(), { maxAge: '7d' });
    });

    // Logotipo institucional para el Excel (el mismo SVG del encabezado del sistema)
    let promesaLogo = null;
    function logoExcel() {
        if (!promesaLogo) {
            promesaLogo = (async () => {
                const sharp = require('sharp');
                const svg = path.join(__dirname, '..', 'public', 'img', 'aifa-horizontal-positivo.svg');
                const buffer = await sharp(svg, { density: 288 }).resize({ height: 76 }).png().toBuffer();
                const m = await sharp(buffer).metadata();
                return { buffer, ancho: Math.round(m.width / 2), alto: Math.round(m.height / 2) };
            })().catch(err => { console.error('No se pudo preparar el logotipo para Excel:', err.message); return null; });
        }
        return promesaLogo;
    }

    /**
     * Excel de la vista general. Opciones (todas opcionales; sin ellas se
     * exporta todo, como antes): titulo, indicadores, columnas, contenido
     * (comparativo,tablas,detalle,observaciones), notas. Filtros y orden: los
     * mismos parámetros que /api/sms/reportes. Las columnas con datos personales
     * solo salen con el permiso exportar_detalle (supervisión o administración).
     */
    router.get('/api/sms/exportar.xlsx', auth.opcional, envolver(async (req, res) => {
        const { matriz, filtros } = await contexto(req);
        const orden = filtrosLib.leerOrden(req.query);
        const detalle = puede(req.usuario, 'exportar_detalle');
        const opciones = exportacion.normalizarOpciones({ ...req.query, formato: 'xlsx' }, { puedeDetalle: detalle });
        const hoy = acciones.hoyISO();
        const LIMITE = exportacion.LIMITE_FILAS;
        const principal = consultas.indicadores(dbPool, { filtros, matriz });
        const conAnalisis = opciones.contenido.comparativo || opciones.contenido.tablas || opciones.contenido.observaciones;
        const [filasConsulta, ind, comp, ana, deps, z, logo] = await Promise.all([
            opciones.contenido.detalle ? consultas.todasLasFilas(dbPool, { filtros, orden, matriz, limite: LIMITE + 1 }) : [],
            principal,
            opciones.indicadores.length || opciones.contenido.comparativo
                ? consultas.comparacionIndicadores(dbPool, { filtros, matriz, hoy, principal })
                    .catch(err => { console.error('Error al calcular la comparación para Excel:', err); return null; })
                : null,
            conAnalisis ? consultas.analisis(dbPool, { filtros, matriz }) : null,
            catalogoDepartamentos(),
            catalogoZonas(),
            logoExcel()
        ]);
        // Nunca se corta en silencio: si se alcanza el tope, el libro lo dice
        const truncado = filasConsulta.length > LIMITE ? { exportados: LIMITE, total: ind.total } : null;
        const filas = truncado ? filasConsulta.slice(0, LIMITE) : filasConsulta;
        const conPersonales = opciones.columnas.some(k => exportacion.COLUMNA[k].restringida);
        const personales = {};
        if (conPersonales && filas.length) {
            for (let i = 0; i < filas.length; i += 2000) {
                const ids = filas.slice(i, i + 2000).map(f => f.id);
                const [p] = await dbPool.query('SELECT id, nombre, telefono, area, cargo FROM reportes WHERE id IN (?)', [ids]);
                p.forEach(x => { personales[x.id] = x; });
            }
        }
        const filtrosActivos = filtrosLib.describirFiltros(filtros, nombresFiltros({ deps, matriz, z }));

        const libro = exportarExcel.construirLibro({
            opciones, filas, indicadores: ind, comparacion: comp, analisis: ana, personales, logo,
            matriz: { validada: matriz.validada, niveles: matriz.niveles },
            meta: {
                generado: new Date(), usuario: req.usuario || null, filtros, filtrosActivos, orden, hoy,
                diasAviso: matriz.alertas.dias_aviso_vencimiento, truncado
            }
        });

        await auditoria.auditar(dbPool, {
            accion: 'exportacion_excel',
            descripcion: `Exportación a Excel de ${filas.length} reporte(s)`,
            usuario: req.usuario || null, req,
            datos: { filtros, registros: filas.length, detalle: conPersonales, columnas: opciones.columnas, hojas: libro.worksheets.map(w => w.name) }
        }).catch(() => {});

        const nombre = `reportes-sms-aifa-${hoy}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
        res.setHeader('Cache-Control', 'no-store');
        await libro.xlsx.write(res);
        res.end();
    }));

    // ----------------------------------------------------------- errores JSON
    router.use('/api/sms', (err, req, res, next) => {
        console.error('Error en módulo SMS:', err);
        res.status(500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message });
    });

    return router;
};
