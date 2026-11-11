const ExcelJS = require('exceljs');
const X = require('../../public/js/sms-exportacion');
const { construirLibro, HOJA } = require('../../lib/sms/exportar-excel');

const ind = {
    total: 2, nuevos: 1, en_atencion: 0, abiertos: 1, resueltos: 1, duplicados: 0, no_requiere: 0, cerrados: 1,
    porcentaje_cerrados: 50, evaluados: 1, pendientes_evaluar: 1, alto_riesgo: 0, con_fecha: 1, abiertos_sin_plazo: 0,
    vencidos: 1, proximos: 0, dias_aviso: 7, cerrados_con_plazo: 1, cerrados_en_plazo: 1, porcentaje_en_plazo: 100,
    acciones_abiertas: 1, acciones_vencidas: 0, acciones_por_verificar: 0,
    dias_promedio_resolucion: 0.25, dias_mediana_resolucion: 0.25, resueltos_con_fecha: 1, resueltos_sin_registro: 0,
    coherencia: { total_igual_abiertos_mas_cerrados: true, abiertos_igual_nuevos_mas_atencion: true, cerrados_igual_suma_de_cierres: true }
};
const fila = (o) => Object.assign({
    id: 1, folio: 'RSM-1', fecha: new Date('2025-10-01T15:30:00Z'), fecha_actualizacion: new Date('2025-10-01T16:00:00Z'),
    tipo_problema: 'FOD', descripcion: 'Objeto en pista', lugar: 'Plataforma', estado: 'A',
    ultimo_seguimiento: '', folio_seguimiento: null, areas_responsables: ['Operaciones'], areas_notificadas: ['Operaciones'],
    riesgo: null, riesgo_inicial: null, acciones: { total: 1, abiertas: 1, por_verificar: 0, vencidas: 0 },
    compromiso: null, zona: null, fecha_resolucion: null, fecha_cierre: null, plazo_reporte: null,
    fecha_vencimiento: new Date('2025-10-05T06:00:00Z'), cerrado_en_plazo: null
}, o);
const filas = [
    fila({ descripcion: '=HYPERLINK("http://malicioso","clic")' }),
    fila({ id: 2, folio: 'RSM-2', estado: 'D', fecha_cierre: new Date('2025-10-01T21:30:00Z'), fecha_vencimiento: null, cerrado_en_plazo: true, descripcion: '-Se retiró' })
];
const comparacion = { automatico: false, dias: 31, actual: { desde: '2025-10-01', hasta: '2025-10-31' }, anterior: { desde: '2025-08-31', hasta: '2025-09-30' }, valores: { actual: ind, anterior: { ...ind, total: 1, vencidos: 0 } } };
const analisis = {
    mensual: [{ mes: '2025-10', recibidos: 2, cerrados: 1, abiertos: 1, resueltos: 1, dias_promedio_resolucion: 0.3 }],
    por_area: [{ id: 1, nombre: 'Operaciones', activo: true, total: 2, cerrados: 1, abiertos: 1 }],
    por_estatus: ['A', 'B', 'C', 'D', 'E', 'F'].map(e => ({ estado: e, n: e === 'A' || e === 'D' ? 1 : 0 })),
    categorias: [{ categoria: '+Categoría con signo', n: 2, cerrados: 1 }],
    riesgo: { niveles: [{ clave: 'alto', nombre: 'Alto', color: '#CF324C', n: 0 }], sin_evaluar: 2, celdas: [] },
    cerrados_sin_fecha: 0
};
function libro(opciones, extra = {}) {
    return construirLibro(Object.assign({
        opciones, filas, indicadores: ind, comparacion, analisis, logo: null,
        matriz: { validada: false, niveles: analisis.riesgo.niveles },
        personales: { 1: { nombre: 'Persona Uno', telefono: '5550000000', area: 'GSO', cargo: 'Técnico' } },
        meta: { generado: new Date('2026-11-10T18:00:00Z'), usuario: null, filtros: { desde: '2025-10-01', hasta: '2025-10-31' },
            filtrosActivos: [{ clave: 'rango', etiqueta: 'Periodo', valor: '…' }, { clave: 'estado', etiqueta: 'Estatus', valor: '=Abiertos' }],
            orden: { campo: 'fecha', dir: 'desc' }, hoy: '2026-11-10', diasAviso: 7, truncado: null }
    }, extra));
}
async function recargar(l) {
    const b = await l.xlsx.writeBuffer();
    const w = new ExcelJS.Workbook();
    await w.xlsx.load(b);
    return w;
}

describe('Libro de Excel de la vista general', () => {
    test('hojas completas por omisión y archivo válido', async () => {
        const w = await recargar(libro(X.normalizarOpciones({}, {})));
        expect(w.worksheets.map(h => h.name)).toEqual([HOJA.resumen, HOJA.datos, HOJA.indicadores, HOJA.comparativas, HOJA.distribuciones, HOJA.filtros]);
    });

    test('cada sección se puede omitir; Resumen e Información siempre van', async () => {
        const w = await recargar(libro(X.normalizarOpciones({ contenido: '', indicadores: '' }, {})));
        expect(w.worksheets.map(h => h.name)).toEqual([HOJA.resumen, HOJA.filtros]);
    });

    test('datos con tipos reales: fechas de reloj de México, números y encabezado fijo con filtro', async () => {
        const w = await recargar(libro(X.normalizarOpciones({ columnas: 'fecha,estado,descripcion,cierre,dias_cierre,acciones' }, {})));
        const h = w.getWorksheet(HOJA.datos);
        expect(h.getRow(1).values.filter(Boolean)).toEqual(['Folio', 'Fecha del reporte', 'Estatus', 'Descripción', 'Fecha de cierre', 'Días hasta el cierre', 'Acciones totales']);
        const fecha = h.getCell('B2');
        expect(fecha.value).toBeInstanceOf(Date);
        expect(fecha.value.toISOString()).toBe('2025-10-01T09:30:00.000Z');   // 15:30 UTC = 09:30 en México
        expect(fecha.numFmt).toBe('dd/mm/yyyy hh:mm');
        expect(h.getCell('G2').value).toBe(1);
        expect(h.getCell('F3').value.formula).toBe('IF(AND(ISNUMBER(B3),ISNUMBER(E3)),E3-B3,"")');
        expect(h.getCell('F3').value.result).toBeCloseTo(0.25, 6);
        expect(h.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
        expect(h.autoFilter).toBeTruthy();
    });

    test('ningún texto de la base de datos o de los filtros queda como fórmula', async () => {
        const w = await recargar(libro(X.normalizarOpciones({ columnas: 'descripcion' }, {})));
        const h = w.getWorksheet(HOJA.datos);
        expect(h.getCell('B2').value).toBe('\'=HYPERLINK("http://malicioso","clic")');
        expect(h.getCell('B3').value).toBe("'-Se retiró");
        expect(h.getCell('B2').formula).toBeUndefined();
        const dis = w.getWorksheet(HOJA.distribuciones);
        let categoria = null;
        dis.eachRow(r => r.eachCell(c => { if (String(c.value).includes('Categoría con signo')) categoria = c.value; }));
        expect(categoria).toBe("'+Categoría con signo");
        const fil = w.getWorksheet(HOJA.filtros);
        let estatus = null;
        fil.eachRow(r => { if (r.getCell(1).value === 'Filtro · Estatus') estatus = r.getCell(2).value; });
        expect(estatus).toBe("'=Abiertos");
    });

    test('datos personales solo si se pidieron con permiso', async () => {
        const con = await recargar(libro(X.normalizarOpciones({ columnas: 'rep_nombre,rep_tel' }, { puedeDetalle: true })));
        expect(con.getWorksheet(HOJA.datos).getCell('C2').value).toBe('5550000000');
        const op = X.normalizarOpciones({ columnas: 'rep_nombre,rep_tel' }, { puedeDetalle: false });
        const sin = await recargar(libro(op));
        expect(sin.getWorksheet(HOJA.datos).getRow(1).values.filter(Boolean)).toEqual(['Folio']);
        let nota = '';
        sin.getWorksheet(HOJA.filtros).eachRow(r => { if (r.getCell(1).value === 'Columnas omitidas') nota = r.getCell(2).value; });
        expect(nota).toMatch(/Reportante · Teléfono/);
    });

    test('indicadores y comparativas con fórmulas y su resultado', async () => {
        const w = await recargar(libro(X.normalizarOpciones({}, {})));
        const hi = w.getWorksheet(HOJA.indicadores);
        let cerrados = null, cuadre = 0;
        hi.eachRow(r => {
            if (r.getCell(2).value === 'Reportes cerrados') cerrados = r.getCell(3);
            if (String(r.getCell(2).value).startsWith('Cuadre')) { cuadre++; expect(r.getCell(3).value.result).toBe('Correcto'); }
        });
        expect(cerrados.value.formula).toMatch(/^IF\(C\d+=0,"",C\d+\/C\d+\)$/);
        expect(cerrados.value.result).toBe(0.5);
        expect(cerrados.numFmt).toBe('0.0%');
        expect(cuadre).toBe(4);   // 3 de estatus + hoja de datos = total
        const hc = w.getWorksheet(HOJA.comparativas);
        let total = null;
        hc.eachRow(r => { if (r.getCell(1).value === 'Total de reportes') total = r; });
        expect(total.getCell(2).value).toBe(2);
        expect(total.getCell(3).value).toBe(1);
        expect(total.getCell(4).value.formula).toMatch(/B\d+-C\d+/);
        expect(total.getCell(5).value.result).toBe(1);   // +100 %
    });

    test('si se alcanza el tope de filas, el libro lo dice', async () => {
        const w = await recargar(libro(X.normalizarOpciones({}, {}), { meta: { generado: new Date(), filtros: {}, filtrosActivos: [], hoy: '2026-11-10', diasAviso: 7, truncado: { exportados: 2, total: 9 } } }));
        let aviso = '';
        w.getWorksheet(HOJA.filtros).eachRow(r => { if (r.getCell(1).value === 'Aviso') aviso = r.getCell(2).value; });
        expect(aviso).toMatch(/primeros 2 de 9/);
    });
});
