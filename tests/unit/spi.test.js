const spi = require('../../lib/sms/spi');
const { normalizarLugar, agruparLugares } = require('../../lib/sms/lugares');

const filas = [
    { id: 1, fecha: '2025-10-02T10:00:00', estado: 'D', riesgo_nivel: 'alto', fecha_resolucion: '2025-10-03T10:00:00', fecha_cierre: '2025-10-03T10:00:00', cerrado_en_plazo: 1, tipo_problema: 'FOD' },
    { id: 2, fecha: '2025-10-05T10:00:00', estado: 'D', riesgo_nivel: 'bajo', fecha_resolucion: '2025-10-08T10:00:00', fecha_cierre: '2025-10-08T10:00:00', cerrado_en_plazo: 0, tipo_problema: 'FOD' },
    { id: 3, fecha: '2025-10-20T10:00:00', estado: 'A', riesgo_nivel: null, tipo_problema: 'Fauna' },
    { id: 4, fecha: '2025-11-01T10:00:00', estado: 'E', riesgo_nivel: null, fecha_cierre: '2025-11-01T11:00:00', cerrado_en_plazo: null, tipo_problema: 'FOD' }
];
const acciones = [
    { id_reporte: 1, estado: 'verificada', efectividad: 'efectiva', fecha_compromiso: '2025-10-10', fecha_cumplimiento: '2025-10-09T12:00:00', fecha_verificacion: '2025-10-11T12:00:00' },
    { id_reporte: 2, estado: 'completada', efectividad: 'sin_verificar', fecha_compromiso: '2025-10-10', fecha_cumplimiento: '2025-10-12T12:00:00' }
];
const ctx = { filas, acciones, nivelesAltos: ['alto'] };

describe('Métricas mensuales (SPI)', () => {
    test('conteos y porcentajes solo con registros del mes', () => {
        expect(spi.valorMensual('recibidos', '2025-10', ctx).valor).toBe(3);
        expect(spi.valorMensual('recibidos', '2025-10', { ...ctx, categoria: 'FOD' }).valor).toBe(2);
        expect(spi.valorMensual('alto_riesgo', '2025-10', ctx).valor).toBe(1);
        expect(spi.valorMensual('porcentaje_cerrados', '2025-10', ctx)).toMatchObject({ valor: 66.7, numerador: 2, denominador: 3 });
        expect(spi.valorMensual('porcentaje_en_plazo', '2025-10', ctx)).toMatchObject({ valor: 50, numerador: 1, denominador: 2 });
        expect(spi.valorMensual('dias_resolucion', '2025-10', ctx).valor).toBe(2);
        expect(spi.valorMensual('acciones_en_plazo', '2025-10', ctx)).toMatchObject({ valor: 50, denominador: 2 });
        expect(spi.valorMensual('acciones_efectivas', '2025-10', ctx)).toMatchObject({ valor: 100, denominador: 1 });
    });

    test('sin datos en el mes: porcentaje nulo, no cero inventado', () => {
        expect(spi.valorMensual('porcentaje_cerrados', '2025-12', ctx).valor).toBeNull();
        expect(spi.valorMensual('dias_resolucion', '2025-12', ctx).valor).toBeNull();
        expect(spi.valorMensual('recibidos', '2025-12', ctx).valor).toBe(0);
    });

    test('estado frente a meta y alerta', () => {
        const menor = { direccion: 'menor', meta: 5, alerta: 10 };
        expect(spi.estadoSPI(menor, 4).estado).toBe('meta');
        expect(spi.estadoSPI(menor, 7).estado).toBe('vigilancia');
        expect(spi.estadoSPI(menor, 10).estado).toBe('alerta');
        const mayor = { direccion: 'mayor', meta: 90, alerta: 70 };
        expect(spi.estadoSPI(mayor, 95).estado).toBe('meta');
        expect(spi.estadoSPI(mayor, 80).estado).toBe('vigilancia');
        expect(spi.estadoSPI(mayor, 60).estado).toBe('alerta');
        expect(spi.estadoSPI({ direccion: 'mayor', meta: null }, 60).estado).toBe('sin_meta');
        expect(spi.estadoSPI(mayor, null).estado).toBe('sin_datos');
    });
});

describe('Configuración de SPI', () => {
    test('sin configuración no hay metas precargadas', () => {
        expect(spi.CONFIG_INICIAL.indicadores).toEqual([]);
    });
    test('valida métricas, coherencia meta/alerta y categorías del catálogo', () => {
        expect(() => spi.validarConfig({ indicadores: [{ nombre: 'X', metrica: 'inventada' }] })).toThrow(/métrica válida/);
        expect(() => spi.validarConfig({ indicadores: [{ nombre: 'X', metrica: 'recibidos', alerta: 3 }] })).toThrow(/meta antes/);
        expect(() => spi.validarConfig({ indicadores: [{ nombre: 'X', metrica: 'alto_riesgo', direccion: 'menor', meta: 5, alerta: 2 }] })).toThrow(/mayor o igual/);
        expect(() => spi.validarConfig({ indicadores: [{ nombre: 'X', metrica: 'porcentaje_en_plazo', meta: 120 }] })).toThrow(/no es válido/);
        expect(() => spi.validarConfig({ indicadores: [{ nombre: 'X', metrica: 'recibidos', categoria: 'No existe' }] }, { categorias: ['FOD'] })).toThrow(/catálogo/);
        const ok = spi.validarConfig({ indicadores: [{ nombre: 'Cierre en plazo', metrica: 'porcentaje_en_plazo', meta: '90', alerta: '' }] });
        expect(ok.indicadores[0]).toMatchObject({ clave: 'spi_1', direccion: 'mayor', meta: 90, alerta: null, activo: true });
        expect(ok.umbral_recurrencia).toBe(3);
    });
});

describe('Periodos y recurrencia', () => {
    test('periodo de comparación', () => {
        expect(spi.periodoComparacion('2025-10-01', '2025-10-31')).toEqual({ desde: '2025-08-31', hasta: '2025-09-30' });
        expect(spi.periodoComparacion('2025-10-01', '2025-10-31', 'anio')).toEqual({ desde: '2024-10-01', hasta: '2024-10-31' });
    });
    test('periodo de las tarjetas: rango, fecha, solo "desde" y ventana automática', () => {
        const hoy = '2026-11-10';
        expect(spi.periodoIndicadores({ desde: '2026-11-01', hasta: '2026-11-10' }, hoy)).toEqual({
            automatico: false, dias: 10,
            actual: { desde: '2026-11-01', hasta: '2026-11-10' },
            anterior: { desde: '2026-10-22', hasta: '2026-10-31' }
        });
        expect(spi.periodoIndicadores({ fecha: '2026-11-09' }, hoy)).toMatchObject({
            automatico: false, dias: 1, anterior: { desde: '2026-11-08', hasta: '2026-11-08' }
        });
        expect(spi.periodoIndicadores({ desde: '2026-11-04' }, hoy)).toMatchObject({
            automatico: false, dias: 7, actual: { desde: '2026-11-04', hasta: hoy }, anterior: { desde: '2026-10-28', hasta: '2026-11-03' }
        });
        // Sin fechas: últimos 30 días (incluido hoy) frente a los 30 previos, sin traslape
        expect(spi.periodoIndicadores({ estado: 'A' }, hoy)).toEqual({
            automatico: true, dias: 30,
            actual: { desde: '2026-10-12', hasta: hoy },
            anterior: { desde: '2026-09-12', hasta: '2026-10-11' }
        });
        expect(spi.periodoIndicadores({ hasta: '2026-03-31' }, hoy, { ventanaDias: 7 })).toMatchObject({
            automatico: true, dias: 7, actual: { desde: '2026-03-25', hasta: '2026-03-31' }, anterior: { desde: '2026-03-18', hasta: '2026-03-24' }
        });
        // Un "desde" futuro no produce un periodo negativo
        expect(spi.periodoIndicadores({ desde: '2026-12-01' }, hoy)).toMatchObject({ dias: 1, actual: { desde: '2026-12-01', hasta: '2026-12-01' } });
    });
    test('resumen de periodo distingue Resuelto, Duplicado y No requiere', () => {
        const r = spi.resumenPeriodo(filas, acciones, '2025-10-01', '2025-11-30', { nivelesAltos: ['alto'] });
        expect(r).toMatchObject({ recibidos: 4, cerrados: 3, resueltos: 2, duplicados: 1, no_requiere: 0, alto_riesgo: 1, cerrados_con_plazo: 2, porcentaje_en_plazo: 50 });
        expect(r.dias_mediana_resolucion).toBe(2);
    });
    test('mediana', () => {
        expect(spi.mediana([5, 1, 3])).toBe(3);
        expect(spi.mediana([1, 2, 3, 10])).toBe(2.5);
        expect(spi.mediana([])).toBeNull();
    });
    test('categorías recurrentes dentro de la ventana', () => {
        const r = spi.categoriasRecurrentes(filas, { umbral: 3, ventanaDias: 90 });
        expect(r[0]).toMatchObject({ categoria: 'FOD', n: 3, en_ventana: 3, recurrente: true });
        expect(r.find(c => c.categoria === 'Fauna').recurrente).toBe(false);
        const corta = spi.categoriasRecurrentes(filas, { umbral: 3, ventanaDias: 7 });
        expect(corta.find(c => c.categoria === 'FOD').recurrente).toBe(false);
    });
});

describe('Agrupación de lugares', () => {
    test('las variantes de una posición se agrupan', () => {
        ['Cerca de la posición 505', 'POSICION 505', 'alrededor de la posicón 505', 'Cerca de la posición de abordaje 505', 'cerca de la posivion 505']
            .forEach(t => expect(normalizarLugar(t)).toEqual({ clave: 'posicion-505', etiqueta: 'Posición 505' }));
        expect(normalizarLugar('Afuera de la puerta 1').clave).toBe('puerta-1');
        expect(normalizarLugar('No especificado')).toBeNull();
        expect(normalizarLugar('')).toBeNull();
    });
    test('el texto libre conserva la redacción original más frecuente', () => {
        const g = agruparLugares([{ lugar: 'Cerca de GSE' }, { lugar: 'cerca de GSE' }, { lugar: 'Cerca de GSE' }, { lugar: 'Posición 501' }]);
        expect(g[0]).toMatchObject({ etiqueta: 'Cerca de GSE', n: 3 });
        expect(g[1]).toMatchObject({ etiqueta: 'Posición 501', n: 1 });
    });
});
