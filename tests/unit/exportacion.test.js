const X = require('../../public/js/sms-exportacion');

const ind = {
    total: 10, nuevos: 3, en_atencion: 2, abiertos: 5, resueltos: 3, duplicados: 1, no_requiere: 1, cerrados: 5,
    porcentaje_cerrados: 50, evaluados: 4, pendientes_evaluar: 2, alto_riesgo: 1, con_fecha: 3, abiertos_sin_plazo: 2,
    vencidos: 1, proximos: 1, dias_aviso: 7, cerrados_con_plazo: 2, cerrados_en_plazo: 1, porcentaje_en_plazo: 50,
    acciones_abiertas: 0, acciones_vencidas: 0, acciones_por_verificar: 0,
    dias_promedio_resolucion: 2.5, dias_mediana_resolucion: 1.5, resueltos_con_fecha: 3, resueltos_sin_registro: 0,
    coherencia: { total_igual_abiertos_mas_cerrados: true, abiertos_igual_nuevos_mas_atencion: true, cerrados_igual_suma_de_cierres: true }
};
const comp = (actual, anterior) => ({ automatico: false, dias: 31, actual: { desde: '2025-10-01', hasta: '2025-10-31' }, anterior: { desde: '2025-08-31', hasta: '2025-09-30' }, valores: { actual, anterior } });

describe('Opciones de exportación', () => {
    test('sin opciones se exporta todo (compatibilidad con la URL anterior)', () => {
        const o = X.normalizarOpciones({}, {});
        expect(o.formato).toBe('xlsx');
        expect(o.indicadores).toHaveLength(X.INDICADORES.length);
        expect(Object.values(o.contenido).every(Boolean)).toBe(true);
        expect(o.columnas[0]).toBe('folio');
        expect(o.columnas).not.toContain('rep_tel');
        expect(o.titulo).toBe(X.TITULO);
    });

    test('las columnas con datos personales requieren permiso y nunca van al PDF', () => {
        expect(X.normalizarOpciones({}, { puedeDetalle: true }).columnas).toContain('rep_tel');
        const sinPermiso = X.normalizarOpciones({ columnas: 'fecha,rep_tel,rep_nombre' }, { puedeDetalle: false });
        expect(sinPermiso.columnas).toEqual(['folio', 'fecha']);
        expect(sinPermiso.columnasOmitidas).toEqual(['Teléfono', 'Reportante']);
        const pdf = X.normalizarOpciones({ formato: 'pdf', columnas: 'rep_tel,estado' }, { puedeDetalle: true });
        expect(pdf.columnas).toEqual(['folio', 'estado']);
    });

    test('valores desconocidos se ignoran; folio va siempre primero y en el orden del catálogo', () => {
        const o = X.normalizarOpciones({ columnas: 'estado,inexistente,fecha,fecha', indicadores: 'vencidos,xx', contenido: 'detalle,otra', orientacion: 'diagonal' }, {});
        expect(o.columnas).toEqual(['folio', 'fecha', 'estado']);
        expect(o.indicadores).toEqual(['vencidos']);
        expect(o.contenido).toEqual({ comparativo: false, tablas: false, detalle: true, observaciones: false });
        expect(o.orientacion).toBe('auto');
        expect(o.graficas).toEqual([]);
    });

    test('título y notas se limpian y se acotan', () => {
        const o = X.normalizarOpciones({ titulo: '  Informe\u0007 de\nprueba ', notas: 'a'.repeat(5000) }, {});
        expect(o.titulo).toBe('Informe de prueba');
        expect(o.notas).toHaveLength(X.MAX_NOTAS);
    });

    test('orientación automática: horizontal solo si el listado no cabe en vertical', () => {
        expect(X.orientacionPdf(X.normalizarOpciones({ formato: 'pdf' }, {}))).toBe('horizontal');
        expect(X.orientacionPdf(X.normalizarOpciones({ formato: 'pdf', columnas: 'fecha,estado' }, {}))).toBe('vertical');
        expect(X.orientacionPdf(X.normalizarOpciones({ formato: 'pdf', contenido: 'tablas' }, {}))).toBe('vertical');
        expect(X.orientacionPdf(X.normalizarOpciones({ formato: 'pdf', orientacion: 'horizontal', contenido: '' }, {}))).toBe('horizontal');
    });

    test('las opciones viajan por URL y el servidor las lee igual', () => {
        const o = X.normalizarOpciones({ formato: 'xlsx', columnas: 'fecha,estado', indicadores: 'total', contenido: 'detalle', notas: 'Nota' }, {});
        const q = X.opcionesAParametros(o, new URLSearchParams());
        const leida = X.normalizarOpciones(Object.fromEntries(q.entries()), {});
        expect(leida).toEqual(o);
    });
});

describe('Variación entre periodos (mismo criterio que las tarjetas)', () => {
    test('conteo: porcentaje y tono según el sentido del indicador', () => {
        const v = X.variacion(X.INDICADOR.vencidos, comp({ ...ind, vencidos: 6 }, { ...ind, vencidos: 4 }));
        expect(v).toMatchObject({ estado: 'cambio', dif: 2, rel: 0.5, tono: 'malo', texto: '+50 %', lectura: 'Desfavorable' });
        const r = X.variacion(X.INDICADOR.resueltos, comp({ ...ind, resueltos: 6 }, { ...ind, resueltos: 4 }));
        expect(r.tono).toBe('bueno');
        expect(X.variacion(X.INDICADOR.total, comp({ ...ind, total: 5 }, { ...ind, total: 10 })).tono).toBe('neutro');
    });

    test('porcentajes cambian en puntos; sin base no hay porcentaje', () => {
        const p = X.variacion(X.INDICADOR.cerrados, comp({ ...ind, porcentaje_cerrados: 60 }, { ...ind, porcentaje_cerrados: 45.5 }));
        expect(p.texto).toBe('+14.5 pts');
        expect(p.rel).toBeNull();
        const cero = X.variacion(X.INDICADOR.nuevos, comp({ ...ind, nuevos: 3 }, { ...ind, nuevos: 0 }));
        expect(cero.texto).toBe('+3');
        expect(cero.rel).toBeNull();
    });

    test('sin cambio y sin datos', () => {
        expect(X.variacion(X.INDICADOR.total, comp(ind, ind)).estado).toBe('igual');
        expect(X.variacion(X.INDICADOR.alto, comp({ ...ind, evaluados: 0 }, ind)).estado).toBe('nd');
        expect(X.variacion(X.INDICADOR.total, null).texto).toBe('Sin comparación disponible');
    });
});

describe('Seguridad y fechas en hojas de cálculo', () => {
    test('un texto no puede convertirse en fórmula', () => {
        expect(X.textoSeguro('=HYPERLINK("http://x","clic")')).toBe('\'=HYPERLINK("http://x","clic")');
        expect(X.textoSeguro('+1+1')).toBe("'+1+1");
        expect(X.textoSeguro('-2+3')).toBe("'-2+3");
        expect(X.textoSeguro('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(X.textoSeguro('\tcmd')).toBe("'\tcmd");
        expect(X.textoSeguro('＝1+1')).toBe("'＝1+1");
        expect(X.textoSeguro('FOD en pista')).toBe('FOD en pista');
        expect(X.textoSeguro('a\u0000b\u000Bc')).toBe('abc');
    });

    test('las fechas se escriben con la hora de reloj de México', () => {
        // 15:45 UTC = 09:45 en la Ciudad de México
        expect(X.fechaExcel('2026-11-09T15:45:54.000Z').toISOString()).toBe('2026-11-09T09:45:54.000Z');
        expect(X.fechaExcel(new Date('2026-11-10T03:30:00Z'), true).toISOString()).toBe('2026-11-09T00:00:00.000Z');
        expect(X.fechaExcel('2025-10-15', true).toISOString()).toBe('2025-10-15T00:00:00.000Z');
        expect(X.fechaExcel(null)).toBeNull();
        expect(X.diaMX('2026-11-10T05:59:00Z')).toBe('2026-11-09');
    });

    test('semáforo con los mismos nombres que la vista general', () => {
        expect(X.SEMAFORO[X.semaforo({ estado: 'A', fecha_vencimiento: '2026-11-09T06:00:00Z' }, '2026-11-10', 7)]).toBe('Vencido');
        expect(X.semaforo({ estado: 'C', fecha_vencimiento: '2026-11-15T06:00:00Z' }, '2026-11-10', 7)).toBe('proximo');
        expect(X.semaforo({ estado: 'C', fecha_vencimiento: null }, '2026-11-10', 7)).toBe('sin_plazo');
        expect(X.semaforo({ estado: 'D', cerrado_en_plazo: false }, '2026-11-10', 7)).toBe('cerrado_fuera');
        expect(X.SEMAFORO[X.semaforo({ estado: 'E', cerrado_en_plazo: null }, '2026-11-10', 7)]).toBe('Cerrado sin plazo');
    });
});

describe('Textos del documento', () => {
    test('periodo consultado', () => {
        expect(X.periodoConsultado({ desde: '2025-10-01', hasta: '2025-10-31' }).texto).toBe('01 oct 2025 – 31 oct 2025 (31 días)');
        expect(X.periodoConsultado({ fecha: '2025-10-05' }).dias).toBe(1);
        expect(X.periodoConsultado({}).texto).toBe('Todo el historial');
    });

    test('las observaciones solo incluyen lo pertinente', () => {
        const sinNada = { ...ind, vencidos: 0, proximos: 0, pendientes_evaluar: 0, abiertos_sin_plazo: 0 };
        expect(X.observaciones(sinNada, { matrizValidada: true })).toEqual([]);
        const o = X.observaciones(ind, { matrizValidada: false, truncado: { exportados: 50000, total: 60000 } });
        const textos = o.map(x => x.texto).join(' | ');
        expect(textos).toMatch(/1 reporte abierto ya venció su plazo/);
        expect(textos).toMatch(/criterios del Manual SMS \(numeral 5\.3\) y está pendiente de confirmar en el sistema/);
        expect(o.find(x => /tope de seguridad/.test(x.texto)).tipo).toBe('alerta');
        const mal = X.observaciones({ ...sinNada, coherencia: { total_igual_abiertos_mas_cerrados: false } }, {});
        expect(mal[0]).toMatchObject({ tipo: 'alerta' });
    });

    test('el resumen ejecutivo usa las cifras reales', () => {
        const r = X.resumenEjecutivo(ind, comp({ ...ind, total: 12 }, { ...ind, total: 8 }));
        expect(r[0]).toMatch(/^10 reportes: 5 abiertos y 5 cerrados/);
        expect(r.join(' ')).toMatch(/se recibieron 12 reportes, frente a 8 .*\(\+50 %\)/);
        expect(X.resumenEjecutivo({ ...ind, total: 0 }, null)).toHaveLength(1);
    });
});
