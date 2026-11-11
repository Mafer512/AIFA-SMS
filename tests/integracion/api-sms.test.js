/* Pruebas de integración del módulo SMS (API real + MySQL).
   SOLO se ejecutan contra una base de PRUEBAS (por defecto aifa_rsm_test);
   se niegan a correr contra la base de producción. Todo lo que crean lo borran.
   Preparar la base de pruebas: ver README_SMS.md («Pruebas»).                  */
process.env.DB_NAME = process.env.DB_NAME_PRUEBAS || 'aifa_rsm_test';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');

if (process.env.DB_NAME === 'aifa_rsm') throw new Error('Las pruebas de integración no se ejecutan contra la base de producción');

const app = require('../../app');
const eliminacion = require('../../lib/sms/eliminacion');
const db = app.locals.dbPool;
const SECRETO = process.env.JWT_SECRET || 'secret_key';

const usuarios = {};
const tokens = {};
let repPropio, repAjeno, deptoEditor, matrizOriginal, spiOriginal, zonasOriginal;
const foliosLimpieza = [];   // otros reportes que tocan las pruebas (sus avisos se borran al final)
const inicio = new Date(Date.now() - 1000);
const auth = rol => ({ Authorization: 'Bearer ' + tokens[rol] });

beforeAll(async () => {
    const [[{ base }]] = await db.query('SELECT DATABASE() AS base');
    if (base === 'aifa_rsm') throw new Error('Conectado a producción: se cancelan las pruebas');

    // Área con reportes abiertos asignados como responsable
    const [[propio]] = await db.query(
        `SELECT r.id, r.folio, rd.id_departamento FROM reportes r
         JOIN reporte_departamento rd ON rd.id_reporte = r.id AND rd.es_responsable = 1
         WHERE r.estado NOT IN ('D','E','F') ORDER BY r.id DESC LIMIT 1`);
    repPropio = propio;
    deptoEditor = propio.id_departamento;
    const [[ajeno]] = await db.query(
        `SELECT id, folio FROM reportes WHERE id NOT IN (SELECT id_reporte FROM reporte_departamento WHERE id_departamento = ?) LIMIT 1`, [deptoEditor]);
    repAjeno = ajeno;

    for (const [clave, rol] of [['viewer', 'viewer'], ['editor', 'editor'], ['supervisor', 'supervisor'], ['admin', 'admin']]) {
        const username = `__prueba_${clave}`;
        await db.query('DELETE FROM usuarios_departamento WHERE username = ?', [username]);
        const [r] = await db.query(
            `INSERT INTO usuarios_departamento (id_departamento, username, email, password_hash, nombre, rol, activo)
             VALUES (?, ?, ?, 'sin-acceso', ?, ?, 1)`,
            [deptoEditor, username, `${username}@prueba.local`, `Prueba ${clave}`, rol]);
        usuarios[clave] = r.insertId;
        tokens[clave] = jwt.sign({ id: r.insertId, username, departamento_id: deptoEditor, rol }, SECRETO, { expiresIn: '10m' });
    }
    // El supervisor tiene alcance global aunque su área sea otra
    const [[otro]] = await db.query('SELECT id FROM departamentos WHERE id <> ? AND activo = 1 LIMIT 1', [deptoEditor]);
    await db.query('UPDATE usuarios_departamento SET id_departamento = ? WHERE id = ?', [otro.id, usuarios.supervisor]);

    const leerCfg = async clave => { const [[c]] = await db.query('SELECT valor FROM configuracion_sistema WHERE clave = ?', [clave]); return c ? c.valor : null; };
    matrizOriginal = await leerCfg('sms_matriz_riesgo');
    spiOriginal = await leerCfg('sms_spi');
    zonasOriginal = await leerCfg('sms_zonas');
    // Las evaluaciones exigen matriz validada: se parte de una NO validada
    const m = typeof matrizOriginal === 'string' ? JSON.parse(matrizOriginal) : matrizOriginal;
    await db.query("UPDATE configuracion_sistema SET valor = ? WHERE clave = 'sms_matriz_riesgo'", [JSON.stringify({ ...m, validada: false, validacion: null })]);
});

async function restaurarCfg(clave, valor) {
    if (valor === null) await db.query('DELETE FROM configuracion_sistema WHERE clave = ?', [clave]);
    else await db.query('UPDATE configuracion_sistema SET valor = ? WHERE clave = ?', [typeof valor === 'string' ? valor : JSON.stringify(valor), clave]);
}

afterAll(async () => {
    // Cuentas creadas por las pruebas de usuarios
    const [extra] = await db.query("SELECT id FROM usuarios_departamento WHERE username LIKE '\_\_prueba\_u\_%'");
    if (extra.length) {
        const ex = extra.map(x => x.id);
        await db.query('DELETE FROM logs_sistema WHERE id_usuario IN (?)', [ex]);
        await db.query('DELETE FROM usuarios_departamento WHERE id IN (?)', [ex]);
    }
    await db.query("DELETE FROM logs_sistema WHERE categoria = 'auditoria' AND accion = 'usuario_creado' AND id_usuario IS NULL AND fecha >= ?", [inicio]);
    const ids = Object.values(usuarios);
    if (ids.length) {
        // Si una prueba de eliminación falló a medias, se restaura lo eliminado
        const [pend] = await db.query('SELECT id, datos FROM reportes_eliminados WHERE eliminado_por IN (?) AND restaurado_en IS NULL', [ids]);
        for (const a of pend) {
            const conn = await db.getConnection();
            try { await conn.beginTransaction(); await eliminacion.restaurar(conn, JSON.parse(a.datos)); await conn.commit(); }
            catch (e) { await conn.rollback(); console.error('No se pudo restaurar en la limpieza:', e.message); }
            finally { conn.release(); }
        }
        await db.query('DELETE FROM reportes_eliminados WHERE eliminado_por IN (?)', [ids]);
        await db.query('DELETE FROM acciones_correctivas WHERE creado_por IN (?)', [ids]);
        await db.query('DELETE FROM reporte_compromiso WHERE creado_por IN (?)', [ids]);
        await db.query('DELETE FROM reporte_zona WHERE asignado_por IN (?)', [ids]);
        await db.query("DELETE FROM zonas_aeropuerto WHERE codigo LIKE 'PRUEBA-%'");
        await db.query('DELETE FROM reporte_evaluacion_riesgo WHERE evaluado_por IN (?)', [ids]);
        await db.query('DELETE FROM logs_sistema WHERE id_usuario IN (?)', [ids]);
        await db.query('DELETE FROM notificaciones_lectura WHERE id_usuario IN (?)', [ids]);
        await db.query('DELETE FROM notificaciones WHERE creado_en >= ? AND folio IN (?)', [inicio, [repPropio.folio, repAjeno.folio, ...foliosLimpieza]]);
        await db.query("DELETE FROM logs_sistema WHERE categoria = 'auditoria' AND accion = 'exportacion_excel' AND fecha >= ?", [inicio]);
        await db.query('DELETE FROM usuarios_departamento WHERE id IN (?)', [ids]);
    }
    await restaurarCfg('sms_matriz_riesgo', matrizOriginal);
    await restaurarCfg('sms_spi', spiOriginal);
    await restaurarCfg('sms_zonas', zonasOriginal);
    await db.end();
});

describe('Indicadores y filtros', () => {
    const casos = [
        {}, { estado: 'A' }, { estado: 'abiertos' }, { estado: 'cerrados' }, { q: 'FOD' },
        { desde: '2025-10-01', hasta: '2025-10-31' }, { riesgo: 'sin_evaluar' }, { vencimiento: 'sin_fecha' }
    ];

    test.each(casos)('el total de indicadores coincide con los resultados de la tabla (%o)', async filtros => {
        const [ind, lista] = await Promise.all([
            request(app).get('/api/sms/indicadores').query(filtros),
            request(app).get('/api/sms/reportes').query({ ...filtros, por_pagina: 10 })
        ]);
        expect(ind.status).toBe(200);
        const i = ind.body.indicadores;
        expect(i.total).toBe(lista.body.paginacion.total);
        expect(i.nuevos + i.en_atencion + i.resueltos + i.cerrados_sin_accion).toBe(i.total);
        // Cuadre explícito y distinción entre Resuelto, Duplicado y No requiere atención
        expect(i.resueltos + i.duplicados + i.no_requiere).toBe(i.cerrados);
        expect(i.abiertos + i.cerrados).toBe(i.total);
        expect(Object.values(i.coherencia).every(Boolean)).toBe(true);
    });

    test('tiempo de resolución: promedio y mediana solo de Resueltos con registro de resolución', async () => {
        const i = (await request(app).get('/api/sms/indicadores')).body.indicadores;
        const [filas] = await db.query(`${require('../../lib/sms/consultas').BASE_CTE}
            SELECT TIMESTAMPDIFF(MINUTE, b.fecha, b.fecha_resolucion) AS m FROM base b WHERE b.estado = 'D' AND b.fecha_resolucion IS NOT NULL`);
        expect(i.resueltos_con_fecha).toBe(filas.length);
        if (filas.length) {
            const prom = filas.reduce((a, f) => a + Math.max(0, Number(f.m)), 0) / filas.length / 1440;
            expect(i.dias_promedio_resolucion).toBeCloseTo(prom, 1);
            expect(i.dias_mediana_resolucion).toBeLessThanOrEqual(Math.max(...filas.map(f => Number(f.m))) / 1440 + 0.01);
        }
    });

    test('los análisis cuentan cada reporte una vez aunque tenga varias áreas', async () => {
        const [ind, des, rec, cal] = await Promise.all([
            request(app).get('/api/sms/indicadores'),
            request(app).get('/api/sms/desempeno-areas'),
            request(app).get('/api/sms/recurrencias'),
            request(app).get('/api/sms/calidad-datos')
        ]);
        const total = ind.body.indicadores.total;
        expect(des.body.total.total).toBe(total);
        expect(des.body.total.abiertos + des.body.total.cerrados).toBe(total);
        expect(rec.body.total).toBe(total);
        expect(cal.body.totales.total).toBe(total);
        expect(cal.body.bloques.map(b => b.clave)).toEqual(expect.arrayContaining(['estatus_distinto', 'sin_responsable', 'abierto_sin_plazo']));
    });

    test('comparativo: el periodo anterior tiene la misma duración y no se traslapa', async () => {
        const r = await request(app).get('/api/sms/comparativo').query({ desde: '2025-10-01', hasta: '2025-10-31' });
        expect(r.status).toBe(200);
        expect(r.body.actual.desde).toBe('2025-10-01');
        expect(r.body.anterior.hasta).toBe('2025-09-30');
        expect(r.body.anterior.desde).toBe('2025-08-31');
        const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM reportes WHERE fecha >= '2025-10-01' AND fecha < '2025-11-01'");
        expect(r.body.actual.recibidos).toBe(Number(n));
        const anio = await request(app).get('/api/sms/comparativo').query({ desde: '2025-10-01', hasta: '2025-10-31', modo: 'anio' });
        expect(anio.body.anterior.desde).toBe('2024-10-01');
    });

    test('variación de las tarjetas: periodo anterior con los mismos filtros y reproducible', async () => {
        const filtros = { desde: '2025-10-01', hasta: '2025-10-31', estado: 'abiertos' };
        const [conComp, previo, sinComp] = await Promise.all([
            request(app).get('/api/sms/indicadores').query({ ...filtros, comparar: '1' }),
            request(app).get('/api/sms/indicadores').query({ ...filtros, desde: '2025-08-31', hasta: '2025-09-30' }),
            request(app).get('/api/sms/indicadores').query(filtros)
        ]);
        expect(conComp.status).toBe(200);
        const c = conComp.body.comparacion;
        expect(c).toMatchObject({ automatico: false, dias: 31, actual: { desde: '2025-10-01', hasta: '2025-10-31' }, anterior: { desde: '2025-08-31', hasta: '2025-09-30' } });
        expect(c.valores.actual).toEqual(conComp.body.indicadores);
        expect(c.valores.anterior).toEqual(previo.body.indicadores);
        // Sin comparar=1 la respuesta no cambia
        expect(sinComp.body.comparacion).toBeUndefined();
        expect(conComp.body.indicadores).toEqual(sinComp.body.indicadores);
    });

    test('variación sin periodo elegido: últimos 30 días frente a los 30 previos', async () => {
        const r = await request(app).get('/api/sms/indicadores').query({ comparar: '1' });
        const c = r.body.comparacion;
        expect(c).toMatchObject({ automatico: true, dias: 30 });
        expect(c.actual.hasta).toBe(require('../../lib/sms/acciones').hoyISO());
        const [actual, anterior] = await Promise.all([
            request(app).get('/api/sms/indicadores').query(c.actual),
            request(app).get('/api/sms/indicadores').query(c.anterior)
        ]);
        expect(c.valores.actual).toEqual(actual.body.indicadores);
        expect(c.valores.anterior).toEqual(anterior.body.indicadores);
        // Las tarjetas siguen mostrando el total sin restricción de fechas
        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM reportes');
        expect(r.body.indicadores.total).toBe(Number(n));
    });

    test.each([{}, { desde: '2025-10-01', hasta: '2025-10-31' }, { estado: 'abiertos' }, { q: 'FOD' }])(
        'series de las gráficas (día, cierre y hora) cuadran con las tarjetas (%o)', async filtros => {
            const [an, ind] = await Promise.all([
                request(app).get('/api/sms/analisis').query(filtros),
                request(app).get('/api/sms/indicadores').query(filtros)
            ]);
            expect(an.status).toBe(200);
            const a = an.body.analisis, i = ind.body.indicadores;
            const suma = (lista, k) => lista.reduce((s, x) => s + x[k], 0);
            expect(suma(a.diario, 'recibidos')).toBe(i.total);
            expect(suma(a.diario, 'nuevos')).toBe(i.nuevos);
            expect(suma(a.diario, 'atencion')).toBe(i.en_atencion);
            expect(suma(a.diario, 'resueltos')).toBe(i.resueltos);
            expect(suma(a.diario, 'sin_accion')).toBe(i.cerrados_sin_accion);
            // Cada cerrado tiene fecha de cierre o se informa aparte
            expect(suma(a.cierres_diarios, 'cerrados') + a.cerrados_sin_fecha).toBe(i.cerrados);
            expect(a.cerrados_sin_fecha).toBeGreaterThanOrEqual(0);
            expect(a.por_hora).toHaveLength(24);
            expect(suma(a.por_hora, 'n')).toBe(i.total);
            a.diario.concat(a.cierres_diarios).forEach(d => expect(d.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/));
            // Días en orden y sin repetir (el navegador agrupa con búsqueda binaria)
            const dias = a.diario.map(d => d.dia);
            expect([...dias].sort()).toEqual(dias);
            expect(new Set(dias).size).toBe(dias.length);
        });

    test('el total coincide con el número de reportes de la base (una fila por reporte)', async () => {
        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM reportes');
        const r = await request(app).get('/api/sms/indicadores');
        expect(r.body.indicadores.total).toBe(Number(n));
    });

    test('los filtros se combinan', async () => {
        const solo = await request(app).get('/api/sms/reportes').query({ estado: 'A', por_pagina: 100 });
        const combinado = await request(app).get('/api/sms/reportes').query({ estado: 'A', area: deptoEditor, por_pagina: 100 });
        expect(combinado.body.paginacion.total).toBeLessThanOrEqual(solo.body.paginacion.total);
        combinado.body.reportes.forEach(r => expect(r.estado).toBe('A'));
        expect(combinado.body.filtros_activos.map(f => f.clave)).toEqual(expect.arrayContaining(['estado', 'area']));
    });

    test('búsqueda por folio', async () => {
        const r = await request(app).get('/api/sms/reportes').query({ folio: repPropio.folio });
        expect(r.body.reportes.map(x => x.folio)).toContain(repPropio.folio);
    });

    test('paginación sin repetir reportes y orden por folio', async () => {
        const p1 = await request(app).get('/api/sms/reportes').query({ por_pagina: 10, pagina: 1, orden: 'folio', dir: 'asc' });
        const p2 = await request(app).get('/api/sms/reportes').query({ por_pagina: 10, pagina: 2, orden: 'folio', dir: 'asc' });
        expect(p1.body.reportes).toHaveLength(10);
        const f1 = p1.body.reportes.map(r => r.folio);
        p2.body.reportes.forEach(r => expect(f1).not.toContain(r.folio));
        const nums = f1.map(f => Number(f.split('-').pop()));
        expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    });

    test('parámetros maliciosos se ignoran sin error', async () => {
        const r = await request(app).get('/api/sms/reportes').query({ orden: 'fecha;DROP TABLE reportes', folio: "x' OR 1=1 --", area: '1 OR 1=1' });
        expect(r.status).toBe(200);
        expect(r.body.filtros).toEqual({});
    });
});

describe('Permisos', () => {
    test('sin matriz validada no se registran evaluaciones de riesgo', async () => {
        const r = await request(app).post(`/api/sms/reportes/${repPropio.folio}/riesgo`).set(auth('supervisor'))
            .send({ probabilidad: 3, severidad: 4, justificacion: 'Evaluación de prueba automatizada' });
        expect(r.status).toBe(409);
        expect(r.body.codigo).toBe('matriz_no_validada');
        const g = await request(app).get(`/api/sms/reportes/${repPropio.folio}/gestion`).set(auth('supervisor'));
        expect(g.body.permisos.evaluar_riesgo).toBe(true);
        expect(g.body.permisos.evaluar_habilitado).toBe(false);
    });

    test('la validación de la matriz la firma el servidor con el usuario y la fecha', async () => {
        const actual = (await request(app).get('/api/sms/matriz')).body.matriz;
        const r = await request(app).put('/api/sms/matriz').set(auth('admin'))
            .send({ matriz: { ...actual, validada: true, validacion: { por: 'Alguien más', fecha: '2000-01-01', referencia: 'Acta de prueba' } } });
        expect(r.status).toBe(200);
        expect(r.body.matriz.validada).toBe(true);
        expect(r.body.matriz.validacion.por).toBe('Prueba admin');
        expect(r.body.matriz.validacion.fecha).not.toBe('2000-01-01');
        expect(r.body.matriz.validacion.referencia).toBe('Acta de prueba');
        const [[log]] = await db.query("SELECT accion FROM logs_sistema WHERE categoria = 'auditoria' AND id_usuario = ? ORDER BY id DESC LIMIT 1", [usuarios.admin]);
        expect(log.accion).toBe('matriz_validada');
    });

    test('evaluar riesgo: sin sesión 401, viewer y editor 403, supervisor 200', async () => {
        const cuerpo = { probabilidad: 3, severidad: 4, justificacion: 'Evaluación de prueba automatizada' };
        const url = `/api/sms/reportes/${repPropio.folio}/riesgo`;
        expect((await request(app).post(url).send(cuerpo)).status).toBe(401);
        expect((await request(app).post(url).set(auth('viewer')).send(cuerpo)).status).toBe(403);
        expect((await request(app).post(url).set(auth('editor')).send(cuerpo)).status).toBe(403);
        const ok = await request(app).post(url).set(auth('supervisor')).send(cuerpo);
        expect(ok.status).toBe(200);
        expect(ok.body.evaluacion.indice).toBe('3B');
        expect(ok.body.evaluacion.tipo).toBe('inicial');
    });

    test('riesgo residual: exige medidas de mitigación y conserva el inicial', async () => {
        const url = `/api/sms/reportes/${repPropio.folio}/riesgo`;
        const sinMedidas = await request(app).post(url).set(auth('supervisor')).send({ tipo: 'residual', probabilidad: 2, severidad: 2, justificacion: 'Tras aplicar las medidas' });
        expect(sinMedidas.status).toBe(400);
        const ajenoSinInicial = await request(app).post(`/api/sms/reportes/${repAjeno.folio}/riesgo`).set(auth('supervisor'))
            .send({ tipo: 'residual', probabilidad: 2, severidad: 2, justificacion: 'Tras aplicar las medidas', medidas_mitigacion: 'Barrido diario de la posición' });
        expect(ajenoSinInicial.status).toBe(400);
        const ok = await request(app).post(url).set(auth('supervisor'))
            .send({ tipo: 'residual', probabilidad: 2, severidad: 2, justificacion: 'Tras aplicar las medidas', medidas_mitigacion: 'Barrido diario de la posición' });
        expect(ok.status).toBe(200);
        const g = await request(app).get(`/api/sms/reportes/${repPropio.folio}/gestion`).set(auth('viewer'));
        expect(g.body.riesgo.inicial.indice).toBe('3B');
        expect(g.body.riesgo.residual.indice).toBe('2D');
        expect(g.body.riesgo.residual.medidas_mitigacion).toBe('Barrido diario de la posición');
        expect(g.body.reporte.riesgo.tipo).toBe('residual');
        expect(g.body.reporte.riesgo_inicial.indice).toBe('3B');
    });

    test('un token inválido o de usuario inexistente no da acceso', async () => {
        const falso = jwt.sign({ id: 999999, rol: 'admin' }, SECRETO);
        expect((await request(app).get('/api/auth/sesion').set('Authorization', 'Bearer ' + falso)).status).toBe(401);
        expect((await request(app).get('/api/auth/sesion').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
    });

    test('solo admin configura la matriz y la validación rechaza datos incorrectos', async () => {
        const actual = (await request(app).get('/api/sms/matriz')).body.matriz;
        expect((await request(app).put('/api/sms/matriz').set(auth('supervisor')).send({ matriz: actual })).status).toBe(403);
        const mala = JSON.parse(JSON.stringify(actual));
        mala.niveles[0].color = 'rojo';
        const r = await request(app).put('/api/sms/matriz').set(auth('admin')).send({ matriz: mala });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/#RRGGBB/);
        expect((await request(app).put('/api/sms/matriz').set(auth('admin')).send({ matriz: actual })).status).toBe(200);
    });

    test('el detalle de acciones no se expone sin sesión', async () => {
        const anon = await request(app).get(`/api/sms/reportes/${repPropio.folio}/gestion`);
        expect(anon.body.acciones).toBeNull();
        expect(anon.body.permisos.registrar_accion).toBe(false);
        const viewer = await request(app).get(`/api/sms/reportes/${repPropio.folio}/gestion`).set(auth('viewer'));
        expect(Array.isArray(viewer.body.acciones)).toBe(true);
    });

    const binario = r => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', c => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    const cargarLibro = async res => { const libro = new ExcelJS.Workbook(); await libro.xlsx.load(res.body); return libro; };

    test('la exportación incluye datos personales solo para supervisión', async () => {
        const encabezados = async res => (await cargarLibro(res)).getWorksheet('Datos generales').getRow(1).values.filter(Boolean);
        const anon = await binario(request(app).get('/api/sms/exportar.xlsx').query({ estado: 'A' }));
        expect(anon.status).toBe(200);
        expect(await encabezados(anon)).not.toContain('Teléfono');
        const sup = await binario(request(app).get('/api/sms/exportar.xlsx').query({ estado: 'A' }).set(auth('supervisor')));
        expect(await encabezados(sup)).toContain('Teléfono');
        // Pedirlas sin permiso no las incluye: se informa en la hoja de filtros
        const viewer = await binario(request(app).get('/api/sms/exportar.xlsx').query({ estado: 'A', columnas: 'fecha,rep_tel' }).set(auth('viewer')));
        const lv = await cargarLibro(viewer);
        expect(lv.getWorksheet('Datos generales').getRow(1).values.filter(Boolean)).toEqual(['Folio', 'Fecha del reporte']);
        const omitidas = [];
        lv.getWorksheet('Información de filtros').eachRow(r => { if (r.getCell(1).value === 'Columnas omitidas') omitidas.push(r.getCell(2).value); });
        expect(omitidas[0]).toMatch(/Teléfono/);
    });

    test('la exportación respeta filtros, opciones y trae todas las filas (sin paginación)', async () => {
        const filtros = { estado: 'abiertos' };
        const tabla = await request(app).get('/api/sms/reportes').query({ ...filtros, por_pagina: 10 });
        const res = await binario(request(app).get('/api/sms/exportar.xlsx')
            .query({ ...filtros, columnas: 'fecha,estado', indicadores: 'total,vencidos', contenido: 'detalle', titulo: 'Prueba de exportación' }));
        expect(res.status).toBe(200);
        const libro = await cargarLibro(res);
        expect(libro.worksheets.map(h => h.name)).toEqual(['Resumen ejecutivo', 'Datos generales', 'Indicadores', 'Información de filtros']);
        const datos = libro.getWorksheet('Datos generales');
        expect(datos.rowCount - 1).toBe(tabla.body.paginacion.total);
        datos.eachRow((r, n) => { if (n > 1) expect(['D', 'E', 'F']).not.toContain(String(r.getCell(3).value).charAt(0)); });
        expect(libro.getWorksheet('Resumen ejecutivo').getCell('A2').value).toBe('Prueba de exportación');
        // Fecha como fecha real con la hora que muestra el sistema (México)
        const primera = tabla.body.reportes[0];
        const celda = datos.getCell('B2').value;
        expect(celda).toBeInstanceOf(Date);
        const horaMx = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(primera.fecha));
        expect(celda.toISOString().slice(11, 16)).toBe(horaMx);
    });

    test('las bibliotecas del PDF se sirven y no se expone otro archivo', async () => {
        const js = await request(app).get('/vendor/jspdf.umd.min.js');
        expect(js.status).toBe(200);
        expect(js.headers['content-type']).toMatch(/javascript/);
        expect((await request(app).get('/vendor/jspdf.plugin.autotable.min.js')).status).toBe(200);
        expect((await request(app).get('/vendor/..%2Fpackage.json')).status).toBe(404);
        expect((await request(app).get('/vendor/package.json')).status).toBe(404);
    });
});

describe('Acciones correctivas y cambios de estatus', () => {
    let idAccion;

    test('el editor no registra acciones en reportes de otra área', async () => {
        const r = await request(app).post(`/api/sms/reportes/${repAjeno.folio}/acciones`).set(auth('editor'))
            .send({ tipo: 'correctiva', descripcion: 'Acción de prueba', id_departamento_responsable: deptoEditor, fecha_compromiso: '2099-01-01' });
        expect(r.status).toBe(403);
    });

    test('flujo completo: registrar, concluir, verificar', async () => {
        const nueva = await request(app).post(`/api/sms/reportes/${repPropio.folio}/acciones`).set(auth('editor'))
            .send({ tipo: 'correctiva', descripcion: 'Acción de prueba automatizada', id_departamento_responsable: deptoEditor, fecha_compromiso: '2099-01-01' });
        expect(nueva.status).toBe(201);
        idAccion = nueva.body.id;

        const url = `/api/sms/acciones/${idAccion}/estado`;
        expect((await request(app).patch(url).set(auth('viewer')).send({ estado: 'en_proceso' })).status).toBe(403);
        expect((await request(app).patch(url).set(auth('editor')).send({ estado: 'verificada' })).status).toBe(400);
        expect((await request(app).patch(url).set(auth('editor')).send({ estado: 'completada', comentario: 'Hecho' })).status).toBe(200);
        expect((await request(app).patch(url).set(auth('editor')).send({ estado: 'verificada' })).status).toBe(403);
        const verif = await request(app).patch(url).set(auth('supervisor')).send({ estado: 'verificada', comentario: 'Efectiva' });
        expect(verif.status).toBe(200);
        const [[a]] = await db.query('SELECT estado, efectividad, verificado_por FROM acciones_correctivas WHERE id = ?', [idAccion]);
        expect(a).toEqual({ estado: 'verificada', efectividad: 'efectiva', verificado_por: usuarios.supervisor });
    });

    test('cada cambio queda en la bitácora con su autor', async () => {
        const [filas] = await db.query(
            `SELECT accion, id_usuario FROM logs_sistema WHERE categoria = 'auditoria' AND id_reporte = ? AND fecha >= ? AND id_usuario IN (?) ORDER BY id`,
            [repPropio.id, inicio, Object.values(usuarios)]);
        const acciones = filas.map(f => f.accion);
        expect(acciones).toEqual(expect.arrayContaining(['riesgo_evaluado', 'accion_registrada', 'accion_completada', 'accion_verificada']));
        expect(filas.find(f => f.accion === 'accion_verificada').id_usuario).toBe(usuarios.supervisor);
    });

    test('supervisión recibe el aviso de acción por verificar; el área no', async () => {
        const sup = await request(app).get('/api/sms/notificaciones').set(auth('supervisor'));
        expect(sup.body.eventos.some(e => e.tipo === 'validacion_pendiente' && e.folio === repPropio.folio)).toBe(true);
        const edi = await request(app).get('/api/sms/notificaciones').set(auth('editor'));
        expect(edi.body.eventos.some(e => e.tipo === 'validacion_pendiente')).toBe(false);
    });

    test('no se puede marcar Resuelto con una acción abierta', async () => {
        const abierta = await request(app).post(`/api/sms/reportes/${repPropio.folio}/acciones`).set(auth('supervisor'))
            .send({ tipo: 'preventiva', descripcion: 'Otra acción de prueba', responsable_nombre: 'Responsable de prueba', fecha_compromiso: '2099-01-01' });
        expect(abierta.status).toBe(201);
        const r = await request(app).post('/api/seguimiento/crear')
            .send({ id_reporte: repPropio.id, id_departamento: deptoEditor, estado: 'D', descripcion: 'Intento de cierre' });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/No se puede marcar como Resuelto/);
    });

    test('cancelar exige motivo', async () => {
        const [[a]] = await db.query("SELECT id FROM acciones_correctivas WHERE creado_por = ? AND estado = 'pendiente' LIMIT 1", [usuarios.supervisor]);
        expect((await request(app).patch(`/api/sms/acciones/${a.id}/estado`).set(auth('supervisor')).send({ estado: 'cancelada' })).status).toBe(400);
        expect((await request(app).patch(`/api/sms/acciones/${a.id}/estado`).set(auth('supervisor')).send({ estado: 'cancelada', comentario: 'Prueba' })).status).toBe(200);
    });
});

describe('Compromiso de atención y semáforo', () => {
    test('el editor asigna fecha compromiso de su área; no en reportes ajenos', async () => {
        const ajeno = await request(app).post(`/api/sms/reportes/${repAjeno.folio}/compromiso`).set(auth('editor'))
            .send({ fecha_compromiso: '2099-01-10', id_departamento_responsable: deptoEditor });
        expect(ajeno.status).toBe(403);
        expect((await request(app).post(`/api/sms/reportes/${repPropio.folio}/compromiso`).set(auth('viewer')).send({ fecha_compromiso: '2099-01-10' })).status).toBe(403);
        const pasada = await request(app).post(`/api/sms/reportes/${repPropio.folio}/compromiso`).set(auth('editor'))
            .send({ fecha_compromiso: '2000-01-01', id_departamento_responsable: deptoEditor });
        expect(pasada.status).toBe(400);
        const ok = await request(app).post(`/api/sms/reportes/${repPropio.folio}/compromiso`).set(auth('editor'))
            .send({ fecha_compromiso: '2099-01-10', id_departamento_responsable: deptoEditor, responsable_nombre: 'Responsable de prueba' });
        expect(ok.status).toBe(201);
    });

    test('reprogramar exige motivo y queda en el historial y la bitácora', async () => {
        const url = `/api/sms/reportes/${repPropio.folio}/compromiso`;
        expect((await request(app).post(url).set(auth('supervisor')).send({ fecha_compromiso: '2099-02-01', id_departamento_responsable: deptoEditor })).status).toBe(400);
        expect((await request(app).post(url).set(auth('supervisor')).send({ fecha_compromiso: '2099-02-01', id_departamento_responsable: deptoEditor, motivo: 'Se requiere material' })).status).toBe(201);
        const g = await request(app).get(`/api/sms/reportes/${repPropio.folio}/gestion`).set(auth('viewer'));
        expect(g.body.compromiso.historial.length).toBeGreaterThanOrEqual(2);
        expect(g.body.compromiso.vigente.motivo).toBe('Se requiere material');
        const [filas] = await db.query("SELECT accion FROM logs_sistema WHERE categoria = 'auditoria' AND id_reporte = ? AND accion LIKE 'compromiso_%' AND fecha >= ?", [repPropio.id, inicio]);
        expect(filas.map(f => f.accion)).toEqual(expect.arrayContaining(['compromiso_asignado', 'compromiso_reprogramado']));
    });

    // No depende de la fecha de hoy ni de las acciones que ya tenga el reporte en la
    // base de pruebas: el resultado esperado se calcula aparte con los mismos criterios.
    test('la fecha compromiso define el plazo y el semáforo del reporte', async () => {
        // AAAA-MM-DD: los DATE llegan como instante (zona del proceso, como mysql2) y los calculados con LEAST ya como texto
        const dia = v => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toLocaleDateString('en-CA'));
        const r = await request(app).get('/api/sms/reportes').query({ folio: repPropio.folio });
        const fila = r.body.reportes.find(x => x.folio === repPropio.folio);
        expect(fila.compromiso.area).toBeTruthy();
        expect(dia(fila.compromiso.fecha)).toBe('2099-02-01');   // la reprogramada en la prueba anterior

        // Plazo del reporte: la fecha compromiso, salvo que el riesgo inicial tenga un límite anterior
        const [[lim]] = await db.query(
            "SELECT DATE_FORMAT(MIN(fecha_limite), '%Y-%m-%d') AS d FROM reporte_evaluacion_riesgo WHERE id_reporte = ? AND tipo = 'inicial'", [repPropio.id]);
        const plazo = [dia(fila.compromiso.fecha), lim.d].filter(Boolean).sort()[0];
        expect(dia(fila.plazo_reporte)).toBe(plazo);

        // Vencimiento: lo primero entre el plazo y la fecha compromiso de las acciones abiertas
        const [[acc]] = await db.query(
            "SELECT DATE_FORMAT(MIN(fecha_compromiso), '%Y-%m-%d') AS d FROM acciones_correctivas WHERE id_reporte = ? AND estado IN ('pendiente','en_proceso')", [repPropio.id]);
        const vence = [plazo, acc.d].filter(Boolean).sort()[0];
        expect(dia(fila.fecha_vencimiento)).toBe(vence);

        // Semáforo según los días que faltan respecto de hoy (en la base) y los días de aviso
        const [[dif]] = await db.query('SELECT DATEDIFF(?, CURDATE()) AS d', [vence]);
        const esperado = dif.d < 0 ? 'vencido' : dif.d <= r.body.dias_aviso ? 'proximo' : 'en_tiempo';
        const g = await request(app).get(`/api/sms/reportes/${repPropio.folio}/gestion`);
        expect(g.body.semaforo).toBe(esperado);
        expect(g.body.etapas).toHaveLength(4);

        // El filtro de plazo lo encuentra solo en su categoría
        const FILTRO = { vencido: 'vencidos', proximo: 'proximos', en_tiempo: 'en_tiempo' };
        for (const [estado, valor] of Object.entries(FILTRO)) {
            const f = await request(app).get('/api/sms/reportes').query({ vencimiento: valor, folio: repPropio.folio });
            const folios = f.body.reportes.map(x => x.folio);
            if (estado === esperado) expect(folios).toContain(repPropio.folio);
            else expect(folios).not.toContain(repPropio.folio);
        }
    });
});

describe('Zonas (módulo opcional)', () => {
    let idZona;
    test('con el módulo apagado no se asignan zonas', async () => {
        await db.query("DELETE FROM configuracion_sistema WHERE clave = 'sms_zonas'");
        const r = await request(app).put(`/api/sms/reportes/${repPropio.folio}/zona`).set(auth('supervisor')).send({ id_zona: 1 });
        expect(r.status).toBe(409);
    });
    test('solo admin configura; el editor asigna en reportes de su área; se puede filtrar', async () => {
        expect((await request(app).put('/api/sms/zonas/config').set(auth('supervisor')).send({ habilitado: true })).status).toBe(403);
        expect((await request(app).put('/api/sms/zonas/config').set(auth('admin')).send({ habilitado: true })).status).toBe(200);
        expect((await request(app).post('/api/sms/zonas').set(auth('admin')).send({ codigo: 'prueba-1', nombre: '' })).status).toBe(400);
        const z = await request(app).post('/api/sms/zonas').set(auth('admin')).send({ codigo: 'prueba-1', nombre: 'Zona de prueba', tipo: 'Plataforma' });
        expect(z.status).toBe(201);
        idZona = z.body.id;
        expect((await request(app).post('/api/sms/zonas').set(auth('admin')).send({ codigo: 'PRUEBA-1', nombre: 'Duplicada' })).status).toBe(409);
        expect((await request(app).put(`/api/sms/reportes/${repAjeno.folio}/zona`).set(auth('editor')).send({ id_zona: idZona })).status).toBe(403);
        expect((await request(app).put(`/api/sms/reportes/${repPropio.folio}/zona`).set(auth('editor')).send({ id_zona: idZona })).status).toBe(200);
        const f = await request(app).get('/api/sms/reportes').query({ zona: idZona });
        expect(f.body.reportes.map(x => x.folio)).toEqual([repPropio.folio]);
        expect(f.body.filtros_activos.find(a => a.clave === 'zona').valor).toBe('Zona de prueba');
        expect((await request(app).put(`/api/sms/reportes/${repPropio.folio}/zona`).set(auth('editor')).send({ id_zona: null })).status).toBe(200);
    });
});

describe('SPI, notificaciones y bitácora', () => {
    test('solo admin configura SPI; la validación rechaza alertas sin meta', async () => {
        const base = { indicadores: [{ nombre: 'Cierre en plazo', metrica: 'porcentaje_en_plazo', direccion: 'mayor', meta: 90, alerta: 70 }] };
        expect((await request(app).put('/api/sms/spi/config').set(auth('supervisor')).send({ config: base })).status).toBe(403);
        const mala = await request(app).put('/api/sms/spi/config').set(auth('admin'))
            .send({ config: { indicadores: [{ nombre: 'X', metrica: 'recibidos', direccion: 'menor', alerta: 5 }] } });
        expect(mala.status).toBe(400);
        const ok = await request(app).put('/api/sms/spi/config').set(auth('admin')).send({ config: { ...base, validado: true } });
        expect(ok.status).toBe(200);
        expect(ok.body.config.validado_por).toBe('Prueba admin');
        const spi = await request(app).get('/api/sms/spi');
        expect(spi.body.indicadores).toHaveLength(1);
        expect(spi.body.indicadores[0].serie.length).toBe(spi.body.meses.length);
    });

    test('quien evalúa riesgo ve los reportes pendientes de evaluar; el área no', async () => {
        const sup = await request(app).get('/api/sms/notificaciones').set(auth('supervisor'));
        expect(typeof sup.body.alertas.por_evaluar_total).toBe('number');
        const edi = await request(app).get('/api/sms/notificaciones').set(auth('editor'));
        expect(edi.body.alertas.por_evaluar).toEqual([]);
        const pag = await request(app).get('/api/sms/notificaciones').query({ limite: 1, no_leidas: '1' }).set(auth('supervisor'));
        expect(pag.body.eventos.length).toBeLessThanOrEqual(1);
        expect(typeof pag.body.total).toBe('number');
    });

    test('la bitácora se filtra por folio y solo la ve supervisión', async () => {
        expect((await request(app).get('/api/sms/auditoria').set(auth('editor'))).status).toBe(403);
        const r = await request(app).get('/api/sms/auditoria').query({ folio: repPropio.folio }).set(auth('supervisor'));
        expect(r.status).toBe(200);
        expect(r.body.registros.length).toBeGreaterThan(0);
        r.body.registros.forEach(x => expect(x.folio).toBe(repPropio.folio));
    });
});

describe('Eliminación de reportes (con copia y restauración)', () => {
    let objetivo;
    beforeAll(async () => {
        const [[r]] = await db.query(
            `SELECT r.id, r.folio FROM reportes r
             WHERE r.id NOT IN (?) AND EXISTS (SELECT 1 FROM seguimiento s WHERE s.id_reporte = r.id)
             ORDER BY r.id LIMIT 1`, [[repPropio.id, repAjeno.id]]);
        objetivo = r;
    });

    test('solo admin; exige motivo y escribir el folio', async () => {
        const url = '/api/sms/reportes/' + objetivo.folio;
        const cuerpo = { motivo: 'Reporte capturado por error en prueba', confirmacion: objetivo.folio };
        expect((await request(app).delete(url).send(cuerpo)).status).toBe(401);
        expect((await request(app).delete(url).set(auth('editor')).send(cuerpo)).status).toBe(403);
        expect((await request(app).delete(url).set(auth('supervisor')).send(cuerpo)).status).toBe(403);
        expect((await request(app).delete(url).set(auth('admin')).send({ ...cuerpo, motivo: 'corto' })).status).toBe(400);
        expect((await request(app).delete(url).set(auth('admin')).send({ ...cuerpo, confirmacion: 'RSM-0' })).status).toBe(400);
        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM reportes WHERE id = ?', [objetivo.id]);
        expect(Number(n)).toBe(1);
    });

    test('elimina con copia, desaparece de las cifras y se restaura idéntico', async () => {
        const antes = await eliminacion.capturar(db, objetivo.id);
        const totalAntes = (await request(app).get('/api/sms/indicadores')).body.indicadores.total;
        const vista = await request(app).get('/api/sms/reportes/' + objetivo.folio + '/eliminacion').set(auth('admin'));
        expect(vista.status).toBe(200);
        expect(vista.body.resumen.seguimiento.n).toBe(antes.tablas.seguimiento.length);

        const del = await request(app).delete('/api/sms/reportes/' + objetivo.folio).set(auth('admin'))
            .send({ motivo: 'Reporte capturado por error en prueba', confirmacion: objetivo.folio.toLowerCase() });
        expect(del.status).toBe(200);
        expect((await request(app).get('/api/sms/indicadores')).body.indicadores.total).toBe(totalAntes - 1);
        expect((await request(app).get('/api/sms/reportes/' + objetivo.folio + '/gestion')).status).toBe(404);
        const [[{ seg }]] = await db.query('SELECT COUNT(*) AS seg FROM seguimiento WHERE id_reporte = ?', [objetivo.id]);
        expect(Number(seg)).toBe(0);

        const lista = await request(app).get('/api/sms/eliminados').set(auth('admin'));
        const arch = lista.body.eliminados.find(x => x.folio === objetivo.folio && !x.restaurado_en);
        expect(arch).toBeTruthy();
        expect(arch.eliminado_por_nombre).toBe('Prueba admin');
        expect((await request(app).get('/api/sms/eliminados').set(auth('supervisor'))).status).toBe(403);

        const aud = await request(app).get('/api/sms/auditoria').query({ folio: objetivo.folio, accion: 'reporte_eliminado' }).set(auth('supervisor'));
        expect(aud.body.registros.length).toBeGreaterThan(0);
        expect(Boolean(aud.body.registros[0].reporte_eliminado)).toBe(true);

        expect((await request(app).post('/api/sms/eliminados/' + arch.id + '/restaurar').set(auth('supervisor'))).status).toBe(403);
        expect((await request(app).post('/api/sms/eliminados/' + arch.id + '/restaurar').set(auth('admin'))).status).toBe(200);
        expect((await request(app).post('/api/sms/eliminados/' + arch.id + '/restaurar').set(auth('admin'))).status).toBe(409);
        const despues = await eliminacion.capturar(db, objetivo.id);
        expect(despues.tablas).toEqual(antes.tablas);
        expect((await request(app).get('/api/sms/indicadores')).body.indicadores.total).toBe(totalAntes);
    });
});

describe('Usuarios y permisos', () => {
    const PASS = 'Zx91-Lmn-Q7wt';
    const login = (username, password) => request(app).post('/api/auth/login').send({ username, password });
    let tokenNuevoAdmin, idEditor;

    test('configuración inicial: solo local, con el código del servidor', async () => {
        const datos = { nombre: 'Config', apellidos: 'Inicial', username: '__prueba_u_admin', email: '__prueba_u_admin@prueba.local', id_departamento: deptoEditor, password: PASS, confirmacion: PASS };
        const info = await request(app).get('/api/auth/configuracion-inicial');
        expect(info.body.disponible).toBe(true);
        const proxy = await request(app).get('/api/auth/configuracion-inicial').set('X-Forwarded-For', '203.0.113.9');
        expect(proxy.body.disponible).toBe(false);
        expect((await request(app).post('/api/auth/configuracion-inicial').set('X-Forwarded-For', '203.0.113.9')
            .send({ ...datos, codigo: app.locals.codigoConfiguracion() })).status).toBe(403);
        expect((await request(app).post('/api/auth/configuracion-inicial').send({ ...datos, codigo: 'AAAAA-BBBBB' })).status).toBe(403);
        const codigo = app.locals.codigoConfiguracion();
        const ok = await request(app).post('/api/auth/configuracion-inicial').send({ ...datos, codigo: codigo.toLowerCase() });
        expect(ok.status).toBe(201);
        expect(app.locals.codigoConfiguracion()).not.toBe(codigo); // el código cambia tras usarse
        const [[u]] = await db.query('SELECT rol, activo FROM usuarios_departamento WHERE username = ?', ['__prueba_u_admin']);
        expect(u).toEqual({ rol: 'admin', activo: 1 });
    });

    test('se puede iniciar sesión con usuario o con correo', async () => {
        const porUsuario = await login('__prueba_u_admin', PASS);
        expect(porUsuario.status).toBe(200);
        const porCorreo = await login('__PRUEBA_U_ADMIN@prueba.local', PASS);
        expect(porCorreo.status).toBe(200);
        tokenNuevoAdmin = porCorreo.body.token;
        expect((await login('__prueba_u_admin', 'otraCosa123')).status).toBe(401);
        await db.query("UPDATE usuarios_departamento SET intentos_login_fallidos = 0 WHERE username = '__prueba_u_admin'");
    });

    test('solo admin gestiona usuarios; se genera contraseña temporal', async () => {
        const nuevo = { nombre: 'Editora', apellidos: 'De Prueba', username: '__prueba_u_editor', email: '__prueba_u_editor@prueba.local', rol: 'editor', id_departamento: deptoEditor };
        expect((await request(app).get('/api/usuarios').set(auth('supervisor'))).status).toBe(403);
        expect((await request(app).post('/api/usuarios').set(auth('editor')).send(nuevo)).status).toBe(403);
        const r = await request(app).post('/api/usuarios').set('Authorization', 'Bearer ' + tokenNuevoAdmin).send(nuevo);
        expect(r.status).toBe(201);
        expect(r.body.password).toHaveLength(14);
        idEditor = r.body.id;
        const dup = await request(app).post('/api/usuarios').set('Authorization', 'Bearer ' + tokenNuevoAdmin).send(nuevo);
        expect(dup.status).toBe(409);
        const sesion = await login('__prueba_u_editor', r.body.password);
        expect(sesion.body.usuario.debe_cambiar_password).toBe(true);
        expect(sesion.body.usuario.rol).toBe('editor');

        // Cambia su contraseña temporal
        const t = { Authorization: 'Bearer ' + sesion.body.token };
        expect((await request(app).put('/api/mi-cuenta/password').set(t).send({ actual: 'mala', nueva: PASS, confirmacion: PASS })).status).toBe(400);
        expect((await request(app).put('/api/mi-cuenta/password').set(t).send({ actual: r.body.password, nueva: 'corta', confirmacion: 'corta' })).status).toBe(400);
        expect((await request(app).put('/api/mi-cuenta/password').set(t).send({ actual: r.body.password, nueva: PASS, confirmacion: PASS })).status).toBe(200);
        expect((await request(app).get('/api/mi-cuenta').set(t)).body.usuario.debe_cambiar_password).toBe(false);
    });

    test('desactivar impide el acceso; protecciones del último admin y de la propia cuenta', async () => {
        const a = { Authorization: 'Bearer ' + tokenNuevoAdmin };
        const [[yo]] = await db.query("SELECT id FROM usuarios_departamento WHERE username = '__prueba_u_admin'");
        expect((await request(app).patch('/api/usuarios/' + yo.id).set(a).send({ activo: false })).status).toBe(400);
        expect((await request(app).patch('/api/usuarios/' + yo.id).set(a).send({ rol: 'viewer' })).status).toBe(400);
        expect((await request(app).patch('/api/usuarios/' + idEditor).set(a).send({ activo: false })).status).toBe(200);
        expect((await login('__prueba_u_editor', PASS)).status).toBe(401);
        expect((await request(app).patch('/api/usuarios/' + idEditor).set(a).send({ activo: true, rol: 'supervisor' })).status).toBe(200);
        const r = await request(app).post('/api/usuarios/' + idEditor + '/restablecer').set(a).send({});
        expect(r.status).toBe(200);
        expect((await login('__prueba_u_editor', r.body.password)).body.usuario.rol).toBe('supervisor');
        const [filas] = await db.query("SELECT accion FROM logs_sistema WHERE categoria = 'auditoria' AND accion IN ('usuario_creado','usuario_desactivado','usuario_reactivado','password_restablecida','password_cambiada') AND fecha >= ?", [inicio]);
        expect(filas.map(f => f.accion)).toEqual(expect.arrayContaining(['usuario_creado', 'usuario_desactivado', 'usuario_reactivado', 'password_restablecida', 'password_cambiada']));
    });
});

describe('Cierre como Duplicado o No requiere atención (panel del área)', () => {
    const crear = cuerpo => request(app).post('/api/seguimiento/crear')
        .send({ id_reporte: repPropio.id, id_departamento: deptoEditor, ...cuerpo });

    test('Duplicado exige un folio original válido y distinto', async () => {
        expect((await crear({ estado: 'E' })).status).toBe(400);
        expect((await crear({ estado: 'E', folio_original: repPropio.folio })).body.error).toMatch(/distinto/);
        expect((await crear({ estado: 'E', folio_original: 'RSM-999999' })).body.error).toMatch(/No existe/);
    });

    test('No requiere atención exige el motivo', async () => {
        const r = await crear({ estado: 'F', descripcion: 'corto' });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/no requiere atención/i);
    });

    // Se usa un reporte abierto SIN acciones pendientes o por verificar (el reporte
    // principal de pruebas trae una acción pendiente en la base y nunca podría cerrarse).
    test('no se cierra con acciones abiertas; sin ellas queda como "Duplicado de …"', async () => {
        const [[libre]] = await db.query(
            `SELECT r.id, r.folio, r.estado, rd.id_departamento FROM reportes r
             JOIN reporte_departamento rd ON rd.id_reporte = r.id AND rd.es_responsable = 1
             WHERE r.estado NOT IN ('D','E','F') AND r.id NOT IN (?, ?)
               AND NOT EXISTS (SELECT 1 FROM seguimiento s WHERE s.id_reporte = r.id AND s.estado IN ('D','E','F'))
               AND NOT EXISTS (SELECT 1 FROM acciones_correctivas a WHERE a.id_reporte = r.id AND a.estado IN ('pendiente','en_proceso','completada'))
             ORDER BY r.id DESC LIMIT 1`, [repPropio.id, repAjeno.id]);
        expect(libre).toBeTruthy();
        foliosLimpieza.push(libre.folio);
        const cerrar = cuerpo => request(app).post('/api/seguimiento/crear').send({ id_reporte: libre.id, id_departamento: libre.id_departamento, ...cuerpo });

        const abierta = await request(app).post('/api/sms/reportes/' + libre.folio + '/acciones').set(auth('supervisor'))
            .send({ tipo: 'preventiva', descripcion: 'Acción abierta de prueba', responsable_nombre: 'Prueba', fecha_compromiso: '2099-01-01' });
        expect(abierta.status).toBe(201);
        let folioSeg = null;
        try {
            const bloqueado = await cerrar({ estado: 'E', folio_original: repAjeno.folio });
            expect(bloqueado.status).toBe(400);
            expect(bloqueado.body.error).toMatch(/No se puede marcar como Duplicado: hay 1 acción/);
            expect((await request(app).patch('/api/sms/acciones/' + abierta.body.id + '/estado').set(auth('supervisor'))
                .send({ estado: 'cancelada', comentario: 'Prueba de cierre' })).status).toBe(200);

            const ok = await cerrar({ estado: 'E', folio_original: repAjeno.folio.toLowerCase(), descripcion: 'Mismo FOD' });
            expect(ok.status).toBe(200);
            folioSeg = ok.body.folio;
            const [[s]] = await db.query('SELECT estado, descripcion FROM seguimiento WHERE folio_seguimiento = ?', [folioSeg]);
            expect(s.estado).toBe('E');
            expect(s.descripcion).toBe('Duplicado de ' + repAjeno.folio + '. Mismo FOD');
            const fila = (await request(app).get('/api/sms/reportes').query({ folio: libre.folio })).body.reportes.find(x => x.folio === libre.folio);
            expect(fila.estado).toBe('E');
        } finally {
            // Deja el reporte como estaba (la acción y los avisos los borra la limpieza general)
            if (folioSeg) await db.query('DELETE FROM seguimiento WHERE folio_seguimiento = ?', [folioSeg]);
            await db.query('UPDATE reportes SET estado = ? WHERE id = ?', [libre.estado, libre.id]);
        }
    });
});

describe('Clasificación del reporte y datos de quien reporta', () => {
    let folio = null, idReporte = null, folioCfg = null;

    beforeAll(async () => {
        const [[cfg]] = await db.query("SELECT valor FROM configuracion_sistema WHERE clave = 'ultimo_folio_rsm'");
        folioCfg = cfg ? cfg.valor : null;
    });

    afterAll(async () => {
        if (idReporte) {
            // El aviso de "nuevo reporte" se registra sin esperar; se da un momento antes de limpiar
            await new Promise(r => setTimeout(r, 300));
            await db.query('DELETE FROM notificaciones WHERE folio = ?', [folio]);
            await db.query('DELETE FROM reportes WHERE id = ?', [idReporte]);
        }
        if (folioCfg !== null) await db.query("UPDATE configuracion_sistema SET valor = ? WHERE clave = 'ultimo_folio_rsm'", [folioCfg]);
    });

    const base = async () => {
        const [[d]] = await db.query('SELECT codigo FROM departamentos WHERE id = ?', [deptoEditor]);
        const [[t]] = await db.query('SELECT id FROM tipos_problemas WHERE activo = 1 ORDER BY id LIMIT 1');
        return {
            id_tipo_problema: t.id, descripcion: 'Reporte de prueba de clasificación', lugar: 'Posición de prueba',
            departamentos_responsables: [d.codigo], nombre: 'Persona de Prueba', telefono: '5550000000', area: 'Área de prueba', cargo: 'Cargo de prueba'
        };
    };

    test('rechaza un tipo de reporte o una escala inválidos', async () => {
        const b = await base();
        expect((await request(app).post('/api/reportes').send({ ...b, tipo_reporte: 'inventado' })).status).toBe(400);
        expect((await request(app).post('/api/reportes').send({ ...b, tipo_reporte: 'incidente', percepcion_severidad: 9 })).status).toBe(400);
    });

    test('guarda la clasificación y los datos operacionales', async () => {
        const r = await request(app).post('/api/reportes').send({
            ...(await base()), tipo_reporte: 'casi_accidente', percepcion_probabilidad: 3, percepcion_severidad: 4,
            sugerencia_prevencion: 'Señalizar la ruta', vuelo: 'vb123', matricula: 'xa-abc',
            posicion: '601', gse_tipo: 'Tractor de equipaje', gse_numero: 't-01',
            // La parte involucrada se quitó: si llega, se ignora
            id_parte_involucrada: 1, parte_involucrada_otra: 'Aerolínea X'
        });
        expect(r.status).toBe(200);
        folio = r.body.folio; idReporte = r.body.id;
        const fila = (await request(app).get('/api/sms/reportes').query({ folio })).body.reportes.find(x => x.folio === folio);
        expect(fila).toMatchObject({
            tipo_reporte: 'casi_accidente', tipo_reporte_nombre: 'Casi accidente', vuelo: 'VB123', matricula: 'XA-ABC', posicion: '601',
            gse: { tipo: 'Tractor de equipaje', numero: 'T-01' }, percepcion: { probabilidad: 3, severidad: 4 }, sugerencia_prevencion: 'Señalizar la ruta'
        });
        expect(fila).not.toHaveProperty('parte');
        const [[guardado]] = await db.query('SELECT id_parte_involucrada, parte_involucrada_otra FROM reportes WHERE id = ?', [idReporte]);
        expect(guardado).toEqual({ id_parte_involucrada: null, parte_involucrada_otra: null });
        expect((await request(app).get('/api/sms/reportes').query({ folio, tipo: 'casi_accidente' })).body.paginacion.total).toBe(1);
        expect((await request(app).get('/api/sms/reportes').query({ folio, tipo: 'accidente' })).body.paginacion.total).toBe(0);
    });

    test('el conteo por tipo ignora el filtro de tipo y se omite con conteo=0', async () => {
        const con = (await request(app).get('/api/sms/reportes').query({ folio, tipo: 'accidente' })).body.conteo_tipos;
        expect(con.find(t => t.clave === 'casi_accidente')).toEqual({ clave: 'casi_accidente', nombre: 'Casi accidente', grupo: 'obligatorio', n: 1 });
        expect(con.reduce((s, t) => s + t.n, 0)).toBe(1);
        const sin = (await request(app).get('/api/sms/reportes').query({ folio, conteo: '0' })).body;
        expect(sin).not.toHaveProperty('conteo_tipos');
        expect(sin.paginacion.total).toBe(1);
    });

    test('el análisis cuenta los reportes por tipo', async () => {
        const a = (await request(app).get('/api/sms/analisis')).body.analisis;
        const ind = (await request(app).get('/api/sms/indicadores')).body.indicadores;
        expect(a.por_tipo_reporte.map(t => t.clave)).toEqual(['condicion_insegura', 'acto_inseguro', 'buena_practica', 'casi_accidente', 'incidente', 'accidente', 'sin_clasificar']);
        expect(a.por_tipo_reporte.reduce((s, t) => s + t.n, 0)).toBe(ind.total);
        expect(a).not.toHaveProperty('por_parte');
    });

    test('los datos de quien reporta no salen sin sesión', async () => {
        const pagina = await request(app).get('/reportes/' + folio);
        expect(pagina.status).toBe(200);
        expect(pagina.text).toContain('Casi accidente');
        expect(pagina.text).not.toContain('Persona de Prueba');
        expect(pagina.text).not.toContain('5550000000');
        const historial = await request(app).get('/reportes/' + folio + '/historial');
        expect(historial.status).toBe(200);
        expect(historial.text).not.toContain('Persona de Prueba');
        const lista = (await request(app).get('/api/reportes')).body.reportes.find(x => x.folio === folio);
        expect(lista).toBeTruthy();
        ['nombre', 'telefono', 'area', 'cargo', 'ip_address', 'user_agent'].forEach(k => expect(lista).not.toHaveProperty(k));
        const delArea = (await request(app).get('/api/departamento/' + deptoEditor + '/reportes')).body.reportes.find(x => x.folio === folio);
        expect(delArea).not.toHaveProperty('telefono');

        expect((await request(app).get('/api/sms/reportes/' + folio + '/reportante')).status).toBe(401);
        const conSesion = await request(app).get('/api/sms/reportes/' + folio + '/reportante').set(auth('viewer'));
        expect(conSesion.status).toBe(200);
        expect(conSesion.body.reportante).toEqual({ nombre: 'Persona de Prueba', telefono: '5550000000', area: 'Área de prueba', cargo: 'Cargo de prueba' });
    });

    test('el formulario muestra el aviso y los tipos, sin parte involucrada', async () => {
        const r = await request(app).get('/reportes-rapidos');
        expect(r.status).toBe(200);
        expect(r.text).toContain('Tu reporte es confidencial');
        expect(r.text).toContain('numeral 1.4 del Manual SMS');
        expect(r.text).toContain('value="buena_practica"');
        expect(r.text).not.toContain('id_parte_involucrada');
    });

    test('el catálogo de partes involucradas ya no existe', async () => {
        expect((await request(app).get('/api/sms/partes')).status).toBe(404);
        expect((await request(app).post('/api/sms/partes').set(auth('admin')).send({ nombre: 'PRUEBA', tipo: 'Aerolínea' })).status).toBe(404);
        expect((await request(app).get('/admin/partes')).status).toBe(404);
        expect((await request(app).get('/api/sms/catalogos')).body).not.toHaveProperty('partes');
    });
});
