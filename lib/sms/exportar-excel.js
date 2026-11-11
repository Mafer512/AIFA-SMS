/* ============================================================================
   Módulo SMS · libro de Excel de la vista general de reportes
   ----------------------------------------------------------------------------
   Hojas (según lo que elija la persona; Resumen e Información siempre van):
     Resumen ejecutivo   encabezado institucional, indicadores, resumen,
                         observaciones y contenido del libro
     Datos generales     una fila por reporte, columnas elegidas, tipos reales
     Indicadores         indicadores elegidos + cifras base y cuadre (fórmulas)
     Comparativas        periodo actual vs anterior y evolución mensual (fórmulas)
     Distribuciones      por estatus, área, categoría y nivel de riesgo
     Información de filtros  periodo, filtros, columnas, permisos y notas
   Reglas:
     - Fechas como fechas reales, en la hora "de reloj" de México (como el sistema).
     - Números como números (porcentajes como fracción con formato %).
     - Todo texto que viene de la base de datos o de la persona pasa por
       textoSeguro (no puede convertirse en fórmula).
     - Las fórmulas llevan su resultado calculado y el libro se recalcula al abrirse.
   ========================================================================= */
'use strict';

const ExcelJS = require('exceljs');
const X = require('../../public/js/sms-exportacion');

const C = {
    verde: 'FF056653', verdeClaro: 'FFE1F4F0', verdeTenue: 'FFF0F9F8',
    tinta: 'FF141A1F', texto: 'FF2B343B', gris: 'FF67747E', grisClaro: 'FF8895A0',
    linea: 'FFD4D9DC', lineaTenue: 'FFE5E8EB', fondo: 'FFF3F5F6', blanco: 'FFFFFFFF',
    bueno: 'FF056653', malo: 'FFA9283D', neutro: 'FF4A555E', aviso: 'FF87561F'
};
const FMT = {
    entero: '#,##0', decimal: '#,##0.00', dias: '#,##0.00" días"', pct: '0.0%', texto: '@',
    fecha: 'dd/mm/yyyy', fechahora: 'dd/mm/yyyy hh:mm', mes: 'mmm yyyy',
    pts: '+0.0" pts";-0.0" pts";0.0" pts"', varPct: '+0.0%;-0.0%;0.0%',
    dif: '+#,##0;-#,##0;0', difDias: '+#,##0.00" días";-#,##0.00" días";0.00" días"'
};
const HOJA = {
    resumen: 'Resumen ejecutivo', datos: 'Datos generales', indicadores: 'Indicadores',
    comparativas: 'Comparativas', distribuciones: 'Distribuciones', filtros: 'Información de filtros'
};
const LINEA = { style: 'thin', color: { argb: C.lineaTenue } };
const BORDE_FILA = { bottom: LINEA };

const txt = v => X.textoSeguro(v == null ? '' : String(v));
function letra(n) {
    let s = '';
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}
/** Referencia a otra hoja: 'Datos generales'!A2 */
const ref = (hoja, celda) => `'${hoja.replace(/'/g, "''")}'!${celda}`;
/** En encabezados y pies de impresión el & es un código: se duplica. */
const pieSeguro = t => String(t).replace(/&/g, '&&');

function encabezadoTabla(fila, alto = 30) {
    fila.height = alto;
    fila.eachCell(c => {
        c.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: C.blanco } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.verde } };
        c.alignment = { vertical: 'middle', horizontal: c.alignment && c.alignment.horizontal || 'left', wrapText: true };
        c.border = { bottom: { style: 'thin', color: { argb: C.verde } } };
    });
}
function tituloSeccion(ws, fila, texto, columnas) {
    const r = ws.getRow(fila);
    r.getCell(1).value = texto;
    r.getCell(1).font = { name: 'Calibri', size: 12.5, bold: true, color: { argb: C.verde } };
    r.height = 22;
    for (let i = 1; i <= columnas; i++) r.getCell(i).border = { bottom: { style: 'medium', color: { argb: C.verde } } };
}
function notaGris(celda, texto, cursiva = true) {
    celda.value = txt(texto);
    celda.font = { name: 'Calibri', size: 9.5, italic: cursiva, color: { argb: C.gris } };
    celda.alignment = { vertical: 'top', wrapText: true };
}
/** Alto aproximado de una celda combinada con texto largo (Excel no lo ajusta solo). */
function altoTexto(texto, anchoCaracteres, base = 15) {
    const lineas = String(texto).split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / Math.max(10, anchoCaracteres))), 0);
    return Math.max(base, lineas * 14.5 + 3);
}
function configurarImpresion(ws, titulo, horizontal = true) {
    ws.pageSetup = {
        paperSize: 9, orientation: horizontal ? 'landscape' : 'portrait',
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
    };
    ws.headerFooter = {
        oddFooter: `&L&8S.A.G.A. · AIFA · ${pieSeguro(titulo)}&R&8Página &P de &N`,
        evenFooter: `&L&8S.A.G.A. · AIFA · ${pieSeguro(titulo)}&R&8Página &P de &N`
    };
}
/** Valor de un indicador en su tipo real (porcentaje como fracción). */
function valorIndicador(def, v) {
    if (v == null) return null;
    return def.tipo === 'pct' ? Number(v) / 100 : Number(v);
}
function formatoIndicador(def) { return def.tipo === 'pct' ? FMT.pct : def.tipo === 'dur' ? FMT.dias : FMT.entero; }
function colorTono(tono) { return tono === 'bueno' ? C.bueno : tono === 'malo' ? C.malo : C.neutro; }
function sinDatos(celda) {
    celda.value = 'Sin datos';
    celda.font = { name: 'Calibri', size: 10.5, italic: true, color: { argb: C.grisClaro } };
}

/**
 * @param {object} d
 *   opciones      salida de SMSExportacion.normalizarOpciones (formato xlsx)
 *   filas         filas de consultas.todasLasFilas (mapearFila)
 *   indicadores   consultas.indicadores
 *   comparacion   consultas.comparacionIndicadores (o null)
 *   analisis      consultas.analisis (o null si no se pidió)
 *   matriz        { validada, niveles }
 *   personales    { [id]: { nombre, telefono, area, cargo } } (solo con permiso)
 *   meta          { generado, usuario, filtros, filtrosActivos, orden, hoy, diasAviso, totalFilas, truncado }
 *   logo          { buffer, ancho, alto } o null
 * @returns {ExcelJS.Workbook}
 */
function construirLibro(d) {
    const op = d.opciones;
    const ind = d.indicadores;
    const comp = d.comparacion || null;
    const ana = d.analisis || null;
    const meta = d.meta;
    const filas = d.filas || [];
    const conDatos = op.contenido.detalle;
    const conComparativas = op.contenido.comparativo && Boolean(comp || (ana && ana.mensual && ana.mensual.length));
    const conDistribuciones = op.contenido.tablas && Boolean(ana);
    const defs = op.indicadores.map(k => X.INDICADOR[k]);
    const periodo = X.periodoConsultado(meta.filtros);
    const nc = X.nombresComparacion(comp);
    const generado = meta.generado || new Date();
    const textoFiltros = (meta.filtrosActivos || []).filter(f => f.clave !== 'rango' && f.clave !== 'fecha');

    const libro = new ExcelJS.Workbook();
    libro.creator = 'S.A.G.A. · AIFA';
    libro.lastModifiedBy = 'S.A.G.A. · AIFA';
    libro.company = 'Aeropuerto Internacional Felipe Ángeles';
    libro.title = op.titulo;
    libro.subject = 'Seguridad operacional · SMS';
    libro.created = generado;
    libro.modified = generado;
    libro.calcProperties.fullCalcOnLoad = true;

    // Se crean en el orden de las pestañas; se llenan después
    const wsRes = libro.addWorksheet(HOJA.resumen, { views: [{ showGridLines: false }], properties: { tabColor: { argb: C.verde } } });
    const wsDat = conDatos ? libro.addWorksheet(HOJA.datos) : null;
    const wsInd = defs.length ? libro.addWorksheet(HOJA.indicadores, { views: [{ showGridLines: false }] }) : null;
    const wsCom = conComparativas ? libro.addWorksheet(HOJA.comparativas, { views: [{ showGridLines: false }] }) : null;
    const wsDis = conDistribuciones ? libro.addWorksheet(HOJA.distribuciones, { views: [{ showGridLines: false }] }) : null;
    const wsFil = libro.addWorksheet(HOJA.filtros, { views: [{ showGridLines: false }] });

    // --------------------------------------------------------- Datos generales
    let rangoDatos = null;   // filas de datos en la hoja (para fórmulas de otras hojas)
    if (wsDat) {
        const cols = op.columnas.map(k => X.COLUMNA[k]);
        const ctx = { hoy: meta.hoy, diasAviso: meta.diasAviso, personales: d.personales || {} };
        const pos = {};
        cols.forEach((c, i) => { pos[c.k] = i + 1; });
        const formatoCol = c => c.tipo === 'fecha' ? FMT.fecha : c.tipo === 'fechahora' ? FMT.fechahora
            : c.tipo === 'entero' ? FMT.entero : c.tipo === 'decimal' ? FMT.decimal : FMT.texto;
        wsDat.columns = cols.map(c => ({
            header: c.t, key: c.k, width: c.ancho,
            style: { numFmt: formatoCol(c), alignment: { vertical: 'top', wrapText: c.tipo === 'largo' || (c.tipo === 'texto' && c.ancho >= 22) } }
        }));
        const formulaDias = pos.dias_cierre && pos.fecha && pos.cierre;
        filas.forEach((f, i) => {
            const n = i + 2;
            const valores = cols.map(c => {
                const v = c.v(f, ctx);
                if (c.tipo === 'fecha' || c.tipo === 'fechahora') return X.fechaExcel(v, c.tipo === 'fecha');
                if (c.tipo === 'entero' || c.tipo === 'decimal') {
                    if (c.k === 'dias_cierre' && formulaDias) {
                        const a = letra(pos.fecha) + n, b = letra(pos.cierre) + n;
                        return { formula: `IF(AND(ISNUMBER(${a}),ISNUMBER(${b})),${b}-${a},"")`, result: v == null ? '' : v };
                    }
                    return v == null ? null : Number(v);
                }
                return txt(v);
            });
            wsDat.addRow(valores);
        });
        encabezadoTabla(wsDat.getRow(1));
        wsDat.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: true }];
        wsDat.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, filas.length + 1), column: cols.length } };
        configurarImpresion(wsDat, op.titulo, true);
        wsDat.pageSetup.printTitlesRow = '1:1';
        rangoDatos = filas.length ? { desde: 2, hasta: filas.length + 1 } : null;
    }

    // ------------------------------------------------------------- Indicadores
    if (wsInd) {
        wsInd.columns = [{ width: 24 }, { width: 34 }, { width: 16 }, { width: 38 }, { width: 70 }];
        wsInd.getCell('A1').value = 'Indicadores';
        wsInd.getCell('A1').font = { name: 'Calibri', size: 15, bold: true, color: { argb: C.verde } };
        notaGris(wsInd.getCell('A2'), 'Con los filtros del documento · ' + periodo.texto + '. Los porcentajes se calculan con fórmula sobre las cifras base.');
        wsInd.mergeCells('A2:E2');

        // Posiciones de las cifras base (se escriben más abajo) para las fórmulas
        const BASE = [
            ['total', 'Total de reportes'], ['abiertos', 'Abiertos'], ['nuevos', '   Nuevos (A · Generado)'],
            ['en_atencion', '   En atención (B · Enterado y C · En atención)'], ['cerrados', 'Cerrados'],
            ['resueltos', '   Resueltos (D)'], ['duplicados', '   Duplicados (E)'], ['no_requiere', '   No requiere atención (F)'],
            ['evaluados', 'Con evaluación de riesgo'], ['pendientes_evaluar', 'Abiertos pendientes de evaluar'], ['alto_riesgo', 'Alto riesgo'],
            ['con_fecha', 'Abiertos con plazo (fecha compromiso o plazo por riesgo)'], ['vencidos', 'Vencidos'], ['proximos', `Próximos a vencer (${ind.dias_aviso} días)`],
            ['abiertos_sin_plazo', 'Abiertos sin plazo'], ['cerrados_con_plazo', 'Cerrados que tenían plazo'], ['cerrados_en_plazo', 'Cerrados en plazo'],
            ['resueltos_con_fecha', 'Resueltos con fecha de resolución'], ['dias_promedio_resolucion', 'Tiempo de resolución · promedio'],
            ['dias_mediana_resolucion', 'Tiempo de resolución · mediana'], ['acciones_abiertas', 'Acciones correctivas abiertas'],
            ['acciones_vencidas', 'Acciones correctivas vencidas'], ['acciones_por_verificar', 'Acciones por verificar']
        ];
        const inicioSel = 5;
        const inicioBase = inicioSel + defs.length + 3;   // título + encabezado de la sección base
        const filaBase = {};
        BASE.forEach(([k], i) => { filaBase[k] = inicioBase + 1 + i; });
        const B = k => 'C' + filaBase[k];

        tituloSeccion(wsInd, inicioSel - 1, 'Indicadores elegidos', 5);
        const h1 = wsInd.getRow(inicioSel);
        h1.values = ['Grupo', 'Indicador', 'Valor', 'Detalle', 'Cómo se calcula'];
        h1.getCell(3).alignment = { horizontal: 'right' };
        encabezadoTabla(h1, 24);
        const grupoNombre = {};
        X.GRUPOS_INDICADORES.forEach(g => { grupoNombre[g.k] = g.t; });
        defs.forEach((def, i) => {
            const r = wsInd.getRow(inicioSel + 1 + i);
            r.getCell(1).value = grupoNombre[def.grupo];
            r.getCell(2).value = def.t;
            r.getCell(2).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: C.tinta } };
            const v = def.v(ind);
            const c = r.getCell(3);
            if (v == null) sinDatos(c);
            else if (def.k === 'cerrados') c.value = { formula: `IF(${B('total')}=0,"",${B('cerrados')}/${B('total')})`, result: ind.total ? ind.cerrados / ind.total : '' };
            else if (def.k === 'enplazo') c.value = { formula: `IF(${B('cerrados_con_plazo')}=0,"",${B('cerrados_en_plazo')}/${B('cerrados_con_plazo')})`, result: ind.cerrados_con_plazo ? ind.cerrados_en_plazo / ind.cerrados_con_plazo : '' };
            else if (def.k === 'sinaccion') c.value = { formula: `${B('duplicados')}+${B('no_requiere')}`, result: v };
            else c.value = valorIndicador(def, v);
            c.numFmt = formatoIndicador(def);
            r.getCell(4).value = txt(def.det(ind));
            r.getCell(5).value = def.como;
            [1, 4, 5].forEach(n => { r.getCell(n).font = { name: 'Calibri', size: 10, color: { argb: n === 1 ? C.gris : C.texto } }; });
            r.eachCell({ includeEmpty: true }, x => { x.alignment = Object.assign({ vertical: 'top', wrapText: true }, x === c ? { horizontal: 'right' } : {}); x.border = BORDE_FILA; });
            r.height = altoTexto(def.como, 70, 18);
        });

        tituloSeccion(wsInd, inicioBase - 1, 'Cifras base y cuadre', 5);
        const h2 = wsInd.getRow(inicioBase);
        h2.values = ['', 'Concepto', 'Valor', 'Nota'];
        encabezadoTabla(h2, 22);
        BASE.forEach(([k, t], i) => {
            const r = wsInd.getRow(inicioBase + 1 + i);
            r.getCell(2).value = t;
            const c = r.getCell(3);
            const v = ind[k];
            if (v == null) sinDatos(c);
            else { c.value = Number(v); c.numFmt = k.startsWith('dias_') ? FMT.dias : FMT.entero; }
            if (k === 'dias_promedio_resolucion' || k === 'dias_mediana_resolucion') r.getCell(4).value = 'Solo reportes Resueltos con fecha de resolución';
            r.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; x.font = x.font || { name: 'Calibri', size: 10.5 }; });
            r.getCell(4).font = { name: 'Calibri', size: 9.5, color: { argb: C.gris } };
        });
        let f = inicioBase + 1 + BASE.length;
        const cuadre = (titulo, formula, ok) => {
            const r = wsInd.getRow(f++);
            r.getCell(2).value = titulo;
            r.getCell(2).font = { name: 'Calibri', size: 10.5, bold: true };
            r.getCell(3).value = { formula, result: ok ? 'Correcto' : 'Revisar' };
            r.getCell(3).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: ok ? C.bueno : C.malo } };
            r.getCell(3).alignment = { horizontal: 'right' };
            r.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; });
            return r;
        };
        const co = ind.coherencia || {};
        cuadre('Cuadre: total = abiertos + cerrados', `IF(${B('total')}=${B('abiertos')}+${B('cerrados')},"Correcto","Revisar")`, co.total_igual_abiertos_mas_cerrados);
        cuadre('Cuadre: abiertos = nuevos + en atención', `IF(${B('abiertos')}=${B('nuevos')}+${B('en_atencion')},"Correcto","Revisar")`, co.abiertos_igual_nuevos_mas_atencion);
        cuadre('Cuadre: cerrados = resueltos + duplicados + no requiere', `IF(${B('cerrados')}=${B('resueltos')}+${B('duplicados')}+${B('no_requiere')},"Correcto","Revisar")`, co.cerrados_igual_suma_de_cierres);
        if (rangoDatos && !meta.truncado) {
            const rango = ref(HOJA.datos, `A${rangoDatos.desde}:A${rangoDatos.hasta}`);
            const enHoja = f;
            const r1 = wsInd.getRow(f++);
            r1.getCell(2).value = `Reportes en la hoja «${HOJA.datos}»`;
            r1.getCell(3).value = { formula: `COUNTA(${rango})`, result: filas.length };
            r1.getCell(3).numFmt = FMT.entero;
            r1.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; });
            cuadre(`Cuadre: hoja «${HOJA.datos}» = total`, `IF(C${enHoja}=${B('total')},"Correcto","Revisar")`, filas.length === ind.total);
            const r2 = wsInd.getRow(f++);
            r2.getCell(2).value = `Visibles con el filtro aplicado en «${HOJA.datos}»`;
            r2.getCell(3).value = { formula: `SUBTOTAL(103,${rango})`, result: filas.length };
            r2.getCell(3).numFmt = FMT.entero;
            r2.getCell(4).value = 'Se actualiza al filtrar esa hoja';
            r2.getCell(4).font = { name: 'Calibri', size: 9.5, color: { argb: C.gris } };
            r2.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; });
        }
        wsInd.views = [{ state: 'frozen', ySplit: inicioSel, showGridLines: false }];
        configurarImpresion(wsInd, op.titulo, true);
    }

    // ------------------------------------------------------------ Comparativas
    if (wsCom) {
        wsCom.columns = [{ width: 36 }, { width: 22 }, { width: 22 }, { width: 16 }, { width: 14 }, { width: 22 }, { width: 18 }];
        wsCom.getCell('A1').value = 'Comparativas';
        wsCom.getCell('A1').font = { name: 'Calibri', size: 15, bold: true, color: { argb: C.verde } };
        let f = 3;
        if (comp) {
            tituloSeccion(wsCom, f, 'Periodo actual frente al anterior', 6);
            f++;
            notaGris(wsCom.getCell('A' + f), nc.nota + ' Mismos filtros; el estatus es el vigente hoy. Diferencia y variación se calculan con fórmula.');
            wsCom.mergeCells(`A${f}:F${f}`);
            wsCom.getRow(f).height = 30;
            f++;
            const h = wsCom.getRow(f);
            h.values = ['Indicador', `${nc.actual}\n${nc.rangoActual}`, `${nc.anterior}\n${nc.rangoAnterior}`, 'Diferencia', 'Variación %', 'Lectura'];
            [2, 3, 4, 5].forEach(n => { h.getCell(n).alignment = { horizontal: 'right' }; });
            encabezadoTabla(h, 34);
            const inicio = f + 1;
            defs.forEach((def, i) => {
                const n = inicio + i;
                const r = wsCom.getRow(n);
                const va = X.variacion(def, comp);
                r.getCell(1).value = def.t;
                r.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: C.tinta } };
                [[2, va.act], [3, va.ant]].forEach(([k, v]) => {
                    const c = r.getCell(k);
                    if (v == null) sinDatos(c); else { c.value = valorIndicador(def, v); c.numFmt = formatoIndicador(def); }
                });
                const ok = va.act != null && va.ant != null;
                const both = `AND(ISNUMBER(B${n}),ISNUMBER(C${n}))`;
                if (def.tipo === 'pct') {
                    r.getCell(4).value = { formula: `IF(${both},(B${n}-C${n})*100,"")`, result: ok ? va.dif : '' };
                    r.getCell(4).numFmt = FMT.pts;
                    r.getCell(5).value = '—';
                    r.getCell(5).font = { name: 'Calibri', size: 10.5, color: { argb: C.grisClaro } };
                } else {
                    r.getCell(4).value = { formula: `IF(${both},B${n}-C${n},"")`, result: ok ? va.dif : '' };
                    r.getCell(4).numFmt = def.tipo === 'dur' ? FMT.difDias : FMT.dif;
                    r.getCell(5).value = { formula: `IF(AND(${both},C${n}<>0),(B${n}-C${n})/C${n},"")`, result: ok && va.ant ? va.dif / va.ant : '' };
                    r.getCell(5).numFmt = FMT.varPct;
                }
                r.getCell(6).value = va.lectura;
                r.getCell(6).font = { name: 'Calibri', size: 10.5, bold: va.tono === 'bueno' || va.tono === 'malo', color: { argb: va.tono === 'nd' ? C.grisClaro : colorTono(va.tono) } };
                [2, 3, 4, 5].forEach(k => { r.getCell(k).alignment = { horizontal: 'right' }; });
                r.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; });
            });
            f = inicio + defs.length + 2;
        }
        const mensual = ana && ana.mensual ? ana.mensual : [];
        if (mensual.length) {
            tituloSeccion(wsCom, f, 'Evolución mensual', 7);
            f++;
            notaGris(wsCom.getCell('A' + f), 'Reportes recibidos en cada mes y su estatus vigente. Abiertos y % cerrado se calculan con fórmula.');
            wsCom.mergeCells(`A${f}:G${f}`);
            f++;
            const h = wsCom.getRow(f);
            h.values = ['Mes', 'Recibidos', 'Ya cerrados', 'Siguen abiertos', '% cerrado', 'Resueltos en el mes', 'Días promedio de resolución'];
            [2, 3, 4, 5, 6, 7].forEach(n => { h.getCell(n).alignment = { horizontal: 'right' }; });
            encabezadoTabla(h, 34);
            const ini = f + 1;
            mensual.forEach((m, i) => {
                const n = ini + i;
                const p = String(m.mes).split('-');
                const r = wsCom.getRow(n);
                r.getCell(1).value = new Date(Date.UTC(+p[0], +p[1] - 1, 1));
                r.getCell(1).numFmt = FMT.mes;
                r.getCell(1).alignment = { horizontal: 'left' };
                r.getCell(2).value = m.recibidos;
                r.getCell(3).value = m.cerrados;
                r.getCell(4).value = { formula: `B${n}-C${n}`, result: m.recibidos - m.cerrados };
                r.getCell(5).value = { formula: `IF(B${n}=0,"",C${n}/B${n})`, result: m.recibidos ? m.cerrados / m.recibidos : '' };
                r.getCell(6).value = m.resueltos;
                if (m.dias_promedio_resolucion == null) r.getCell(7).value = null; else r.getCell(7).value = m.dias_promedio_resolucion;
                [2, 3, 4, 6].forEach(k => { r.getCell(k).numFmt = FMT.entero; });
                r.getCell(5).numFmt = FMT.pct;
                r.getCell(7).numFmt = FMT.dias;
                r.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; });
            });
            const fin = ini + mensual.length - 1;
            const t = wsCom.getRow(fin + 1);
            const suma = k => mensual.reduce((s, m) => s + (m[k] || 0), 0);
            t.getCell(1).value = 'Total';
            t.getCell(2).value = { formula: `SUM(B${ini}:B${fin})`, result: suma('recibidos') };
            t.getCell(3).value = { formula: `SUM(C${ini}:C${fin})`, result: suma('cerrados') };
            t.getCell(4).value = { formula: `SUM(D${ini}:D${fin})`, result: suma('recibidos') - suma('cerrados') };
            t.getCell(5).value = { formula: `IF(B${fin + 1}=0,"",C${fin + 1}/B${fin + 1})`, result: suma('recibidos') ? suma('cerrados') / suma('recibidos') : '' };
            t.getCell(6).value = { formula: `SUM(F${ini}:F${fin})`, result: suma('resueltos') };
            [2, 3, 4, 6].forEach(k => { t.getCell(k).numFmt = FMT.entero; });
            t.getCell(5).numFmt = FMT.pct;
            t.eachCell({ includeEmpty: true }, x => {
                x.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: C.tinta } };
                x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.verdeTenue } };
                x.border = { top: { style: 'thin', color: { argb: C.verde } } };
            });
        }
        configurarImpresion(wsCom, op.titulo, true);
    }

    // ---------------------------------------------------------- Distribuciones
    if (wsDis) {
        wsDis.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
        wsDis.getCell('A1').value = 'Distribuciones';
        wsDis.getCell('A1').font = { name: 'Calibri', size: 15, bold: true, color: { argb: C.verde } };
        let f = 3;
        const bloque = (titulo, nota, encabezados, filasB, formulas) => {
            tituloSeccion(wsDis, f, titulo, encabezados.length);
            f++;
            if (nota) { notaGris(wsDis.getCell('A' + f), nota); wsDis.mergeCells(`A${f}:${letra(encabezados.length)}${f}`); f++; }
            const h = wsDis.getRow(f);
            h.values = encabezados;
            for (let k = 2; k <= encabezados.length; k++) h.getCell(k).alignment = { horizontal: 'right' };
            encabezadoTabla(h, 24);
            const ini = f + 1;
            filasB.forEach((vals, i) => {
                const n = ini + i;
                const r = wsDis.getRow(n);
                vals.forEach((v, k) => { r.getCell(k + 1).value = k === 0 ? txt(v) : v; if (k > 0) r.getCell(k + 1).numFmt = FMT.entero; });
                if (formulas) formulas(r, n, ini, ini + filasB.length - 1);
                r.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; });
            });
            f = ini + filasB.length;
            return { ini, fin: ini + filasB.length - 1 };
        };
        // Fila de total con SUMA; el % de la fila total es 100 % cuando hay datos
        const totalRow = (ini, fin, total) => {
            const t = wsDis.getRow(f);
            t.getCell(1).value = 'Total';
            t.getCell(2).value = { formula: `SUM(B${ini}:B${fin})`, result: total };
            t.getCell(2).numFmt = FMT.entero;
            t.getCell(3).value = { formula: `IF(B${f}=0,"",SUM(C${ini}:C${fin}))`, result: total ? 1 : '' };
            t.getCell(3).numFmt = FMT.pct;
            t.eachCell({ includeEmpty: true }, x => {
                x.font = { name: 'Calibri', size: 10.5, bold: true };
                x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.verdeTenue } };
                x.border = { top: { style: 'thin', color: { argb: C.verde } } };
            });
            f++;
        };
        // Estatus (suma = total)
        const est = ana.por_estatus.map(e => [e.estado + ' · ' + X.ESTADOS[e.estado], e.n]);
        const totalEst = ana.por_estatus.reduce((s, e) => s + e.n, 0);
        let r = bloque('Por estatus', 'Estatus vigente de cada reporte; cada reporte cuenta una vez.', ['Estatus', 'Reportes', '% del total'], est, (row, n, ini, fin) => {
            row.getCell(3).value = { formula: `IF(SUM(B$${ini}:B$${fin})=0,"",B${n}/SUM(B$${ini}:B$${fin}))`, result: totalEst ? row.getCell(2).value / totalEst : '' };
            row.getCell(3).numFmt = FMT.pct;
        });
        totalRow(r.ini, r.fin, totalEst);
        f += 1;
        // Áreas
        if (ana.por_area.length) {
            r = bloque('Por área', 'Áreas notificadas o responsables (las 15 con más reportes). Un reporte con varias áreas cuenta en cada una, por eso la suma puede superar el total.',
                ['Área', 'Abiertos', 'Cerrados', 'Total', '% cerrado'],
                ana.por_area.map(a => [a.nombre + (a.activo ? '' : ' (inactiva)'), a.abiertos, a.cerrados]),
                (row, n) => {
                    row.getCell(4).value = { formula: `B${n}+C${n}`, result: row.getCell(2).value + row.getCell(3).value };
                    row.getCell(4).numFmt = FMT.entero;
                    const tot = row.getCell(2).value + row.getCell(3).value;
                    row.getCell(5).value = { formula: `IF(D${n}=0,"",C${n}/D${n})`, result: tot ? row.getCell(3).value / tot : '' };
                    row.getCell(5).numFmt = FMT.pct;
                });
            f += 1;
        }
        // Categorías
        if (ana.categorias.length) {
            r = bloque('Por categoría', 'Las 10 categorías con más reportes.', ['Categoría', 'Reportes', 'Cerrados', '% cerrado'],
                ana.categorias.map(c => [c.categoria, c.n, c.cerrados]),
                (row, n) => {
                    row.getCell(4).value = { formula: `IF(B${n}=0,"",C${n}/B${n})`, result: row.getCell(2).value ? row.getCell(3).value / row.getCell(2).value : '' };
                    row.getCell(4).numFmt = FMT.pct;
                });
            f += 1;
        }
        // Nivel de riesgo
        const niveles = ana.riesgo.niveles.map(n => [n.nombre, n.n]).concat([['Sin evaluar', ana.riesgo.sin_evaluar]]);
        const totalNiv = niveles.reduce((s, x) => s + x[1], 0);
        r = bloque('Por nivel de riesgo', d.matriz && d.matriz.validada ? 'Riesgo vigente según la matriz validada.' : 'Riesgo vigente. La matriz tiene los criterios del Manual SMS (numeral 5.3), pendientes de confirmar en el sistema.',
            ['Nivel', 'Reportes', '% del total'], niveles, (row, n, ini, fin) => {
                row.getCell(3).value = { formula: `IF(SUM(B$${ini}:B$${fin})=0,"",B${n}/SUM(B$${ini}:B$${fin}))`, result: totalNiv ? row.getCell(2).value / totalNiv : '' };
                row.getCell(3).numFmt = FMT.pct;
            });
        totalRow(r.ini, r.fin, totalNiv);
        configurarImpresion(wsDis, op.titulo, false);
    }

    // ------------------------------------------------------- Resumen ejecutivo
    {
        const ws = wsRes;
        ws.columns = [{ width: 38 }, { width: 18 }, { width: 20 }, { width: 22 }, { width: 46 }];
        const ANCHO = 38 + 18 + 20 + 22 + 46;
        let f = 1;
        if (d.logo) {
            const id = libro.addImage({ buffer: d.logo.buffer, extension: 'png' });
            ws.addImage(id, { tl: { col: 0, row: 0.15 }, ext: { width: d.logo.ancho, height: d.logo.alto }, editAs: 'oneCell' });
            ws.getRow(1).height = Math.round(d.logo.alto * 0.75) + 10;
        } else {
            ws.getCell('A1').value = 'Aeropuerto Internacional Felipe Ángeles';
            ws.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.texto } };
        }
        const t = ws.getCell('A2');
        t.value = txt(op.titulo);
        t.font = { name: 'Calibri', size: 18, bold: true, color: { argb: C.verde } };
        ws.mergeCells('A2:E2');
        ws.getRow(2).height = 28;
        const s = ws.getCell('A3');
        s.value = 'S.A.G.A. · Sistema de Administración y Gestión Aeroportuaria · Seguridad operacional (SMS)';
        s.font = { name: 'Calibri', size: 10, color: { argb: C.gris } };
        ws.mergeCells('A3:E3');
        for (let i = 1; i <= 5; i++) ws.getRow(3).getCell(i).border = { bottom: { style: 'medium', color: { argb: C.verde } } };
        f = 5;
        const dato = (etq, valor, fmt) => {
            const r = ws.getRow(f);
            r.getCell(1).value = etq;
            r.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.gris } };
            const c = r.getCell(2);
            c.value = valor;
            if (fmt) c.numFmt = fmt;
            c.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
            c.font = { name: 'Calibri', size: 10.5, color: { argb: C.tinta } };
            ws.mergeCells(`B${f}:E${f}`);
            if (typeof valor === 'string') r.height = altoTexto(valor, ANCHO - 38);
            f++;
        };
        dato('Generado el', X.fechaExcel(generado), FMT.fechahora);
        dato('Generado por', meta.usuario ? txt(meta.usuario.nombre + (meta.usuario.departamento ? ' · ' + meta.usuario.departamento : '')) : 'Sin sesión (consulta pública)');
        dato('Periodo consultado', periodo.texto);
        if (nc) dato('Comparado con', `${nc.rangoAnterior} · ${nc.nota}`);
        dato('Filtros aplicados', textoFiltros.length ? txt(textoFiltros.map(x => `${x.etiqueta}: ${x.valor}`).join(' · ')) : 'Ninguno además del periodo (todos los reportes)');
        dato('Reportes incluidos', ind.total, FMT.entero);

        if (defs.length) {
            f++;
            tituloSeccion(ws, f++, 'Indicadores clave', 5);
            const h = ws.getRow(f++);
            h.values = ['Indicador', 'Valor', nc ? 'Variación' : '', nc ? 'Lectura' : '', 'Detalle'];
            h.getCell(2).alignment = { horizontal: 'right' };
            h.getCell(3).alignment = { horizontal: 'right' };
            encabezadoTabla(h, 22);
            defs.forEach(def => {
                const r = ws.getRow(f++);
                const v = def.v(ind);
                r.getCell(1).value = def.t;
                r.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: C.tinta } };
                const c = r.getCell(2);
                if (v == null) sinDatos(c); else { c.value = valorIndicador(def, v); c.numFmt = formatoIndicador(def); c.font = { name: 'Calibri', size: 12, bold: true, color: { argb: C.tinta } }; }
                c.alignment = { horizontal: 'right', vertical: 'middle' };
                if (nc) {
                    const va = X.variacion(def, comp);
                    r.getCell(3).value = va.texto + (comp.automatico && va.estado !== 'nd' ? ' (últ. ' + comp.dias + ' d)' : '');
                    r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
                    r.getCell(3).font = { name: 'Calibri', size: 10.5, bold: va.estado === 'cambio', color: { argb: va.tono === 'nd' ? C.grisClaro : colorTono(va.tono) } };
                    r.getCell(4).value = va.lectura;
                    r.getCell(4).font = { name: 'Calibri', size: 10, color: { argb: va.tono === 'nd' ? C.grisClaro : colorTono(va.tono) } };
                }
                r.getCell(5).value = txt(def.det(ind));
                r.getCell(5).font = { name: 'Calibri', size: 10, color: { argb: C.gris } };
                r.height = 19;
                r.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; if (!x.alignment) x.alignment = { vertical: 'middle' }; });
            });
            if (nc) {
                notaGris(ws.getCell('A' + f), 'Variación: ' + nc.nota + ' Los porcentajes cambian en puntos (pts).' +
                    (wsCom ? ' Cifras de ambos periodos, con fórmulas, en la hoja «' + HOJA.comparativas + '».' : ''));
                ws.mergeCells(`A${f}:E${f}`);
                ws.getRow(f).height = 28;
                f++;
            }
        }

        f++;
        tituloSeccion(ws, f++, 'Resumen', 5);
        X.resumenEjecutivo(ind, comp).forEach(p => {
            const c = ws.getCell('A' + f);
            c.value = txt('•  ' + p);
            c.font = { name: 'Calibri', size: 10.5, color: { argb: C.texto } };
            c.alignment = { vertical: 'top', wrapText: true };
            ws.mergeCells(`A${f}:E${f}`);
            ws.getRow(f).height = altoTexto(p, ANCHO);
            f++;
        });

        const obs = op.contenido.observaciones ? X.observaciones(ind, {
            matrizValidada: d.matriz ? d.matriz.validada : undefined,
            cerradosSinFecha: ana ? ana.cerrados_sin_fecha : 0,
            truncado: meta.truncado
        }) : [];
        if (obs.length || op.notas) {
            f++;
            tituloSeccion(ws, f++, 'Observaciones', 5);
            const NOMBRE = { alerta: 'Alerta', aviso: 'Atención', info: 'Nota' };
            obs.forEach(o => {
                const r = ws.getRow(f);
                r.getCell(1).value = NOMBRE[o.tipo];
                r.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: o.tipo === 'alerta' ? C.malo : o.tipo === 'aviso' ? C.aviso : C.gris } };
                r.getCell(1).alignment = { vertical: 'top' };
                r.getCell(2).value = txt(o.texto);
                r.getCell(2).font = { name: 'Calibri', size: 10.5, color: { argb: C.texto } };
                r.getCell(2).alignment = { vertical: 'top', wrapText: true };
                ws.mergeCells(`B${f}:E${f}`);
                r.height = altoTexto(o.texto, ANCHO - 38);
                f++;
            });
            if (op.notas) {
                const r = ws.getRow(f);
                r.getCell(1).value = 'Notas de quien elabora';
                r.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.verde } };
                r.getCell(1).alignment = { vertical: 'top', wrapText: true };
                r.getCell(2).value = txt(op.notas);
                r.getCell(2).font = { name: 'Calibri', size: 10.5, color: { argb: C.tinta } };
                r.getCell(2).alignment = { vertical: 'top', wrapText: true };
                r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.fondo } };
                ws.mergeCells(`B${f}:E${f}`);
                r.height = altoTexto(op.notas, ANCHO - 38);
                f++;
            }
        }

        f++;
        tituloSeccion(ws, f++, 'Contenido del libro', 5);
        const hojas = [
            [wsDat, HOJA.datos, `Una fila por reporte (${X.numero(filas.length)}) con las columnas elegidas. Con filtros y encabezado fijo.`],
            [wsInd, HOJA.indicadores, 'Indicadores elegidos, cifras base y cuadre, con fórmulas.'],
            [wsCom, HOJA.comparativas, 'Periodo actual frente al anterior y evolución mensual, con fórmulas.'],
            [wsDis, HOJA.distribuciones, 'Reportes por estatus, área, categoría y nivel de riesgo.'],
            [wsFil, HOJA.filtros, 'Periodo, filtros, columnas, permisos y notas metodológicas.']
        ].filter(x => x[0]);
        hojas.forEach(([, nombre, desc]) => {
            const r = ws.getRow(f++);
            r.getCell(1).value = { text: nombre, hyperlink: `#${ref(nombre, 'A1')}` };
            r.getCell(1).font = { name: 'Calibri', size: 10.5, color: { argb: C.verde }, underline: true };
            r.getCell(2).value = desc;
            r.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: C.gris } };
            ws.mergeCells(`B${f - 1}:E${f - 1}`);
        });
        configurarImpresion(ws, op.titulo, false);
    }

    // -------------------------------------------------- Información de filtros
    {
        const ws = wsFil;
        ws.columns = [{ width: 36 }, { width: 100 }];
        ws.getCell('A1').value = 'Información de filtros';
        ws.getCell('A1').font = { name: 'Calibri', size: 15, bold: true, color: { argb: C.verde } };
        const h = ws.getRow(3);
        h.values = ['Campo', 'Valor'];
        encabezadoTabla(h, 22);
        let f = 4;
        const fila = (k, v, fmt) => {
            const r = ws.getRow(f++);
            r.getCell(1).value = k;
            r.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: C.texto } };
            r.getCell(1).alignment = { vertical: 'top' };
            r.getCell(2).value = v;
            if (fmt) r.getCell(2).numFmt = fmt;
            r.getCell(2).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
            if (typeof v === 'string') r.height = altoTexto(v, 100);
            r.eachCell({ includeEmpty: true }, x => { x.border = BORDE_FILA; });
        };
        const ordenTxt = X.ordenTexto(meta.orden);
        fila('Documento', txt(op.titulo));
        fila('Generado el', X.fechaExcel(generado), FMT.fechahora);
        fila('Generado por', meta.usuario ? txt(`${meta.usuario.nombre} (${meta.usuario.rol})`) : 'Sin sesión (consulta pública)');
        fila('Periodo consultado', periodo.texto);
        if (nc) {
            fila('Periodo de comparación', `${nc.rangoAnterior} (${nc.anterior})`);
            fila('Criterio de comparación', nc.nota);
        }
        if (textoFiltros.length) textoFiltros.forEach(x => fila(`Filtro · ${x.etiqueta}`, txt(x.valor)));
        else fila('Otros filtros', 'Ninguno (todos los reportes del periodo)');
        fila('Reportes que cumplen los filtros', ind.total, FMT.entero);
        if (conDatos) {
            fila('Reportes en «' + HOJA.datos + '»', filas.length, FMT.entero);
            if (meta.truncado) fila('Aviso', `Tope de seguridad: se exportaron los primeros ${X.numero(meta.truncado.exportados)} de ${X.numero(meta.truncado.total)} reportes. Acota el periodo o los filtros para obtener el resto.`);
            if (ordenTxt) fila('Orden del listado', ordenTxt.charAt(0).toUpperCase() + ordenTxt.slice(1));
            fila('Columnas incluidas', op.columnas.map(k => X.COLUMNA[k].t).join(' · '));
        }
        if (op.columnasOmitidas.length) fila('Columnas omitidas', op.columnasOmitidas.join(' · ') + ' (contienen datos personales; requieren rol de supervisión o administración)');
        fila('Indicadores incluidos', defs.length ? defs.map(x => x.t).join(' · ') : 'Ninguno');
        fila('Hojas del libro', libro.worksheets.map(w => w.name).join(' · '));
        fila('Zona horaria', 'Hora del centro de México (America/Mexico_City), igual que en el sistema.');
        fila('Protección de fórmulas', 'Los textos que empiezan con =, +, - o @ se guardan con un apóstrofo inicial para que no se ejecuten como fórmula.');
        fila('Fuente de los datos', 'Base de datos del SMS de S.A.G.A.; mismas consultas que la vista general de reportes.');
        X.NOTAS_METODO.forEach((n, i) => fila(i ? '' : 'Notas metodológicas', n));
        configurarImpresion(ws, op.titulo, false);
    }

    return libro;
}

module.exports = { construirLibro, HOJA, FMT, letra };
