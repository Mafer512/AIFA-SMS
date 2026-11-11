const S = require('../../public/js/sms-series');

const diario = [
    { dia: '2025-10-30', recibidos: 2, nuevos: 1, atencion: 0, resueltos: 1, sin_accion: 0 },
    { dia: '2025-11-03', recibidos: 3, nuevos: 1, atencion: 1, resueltos: 0, sin_accion: 1 },
    { dia: '2025-11-09', recibidos: 1, nuevos: 1, atencion: 0, resueltos: 0, sin_accion: 0 }
];
const cierres = [
    { dia: '2025-10-31', cerrados: 1 },
    { dia: '2025-11-04', cerrados: 1 },
    { dia: '2025-12-02', cerrados: 1 }
];

describe('Series por periodo de las gráficas', () => {
    test('periodo efectivo: filtros, extremo de los datos y hoy', () => {
        expect(S.rangoEfectivo({}, diario, '2026-11-10')).toEqual({ desde: '2025-10-30', hasta: '2025-11-09' });
        expect(S.rangoEfectivo({ desde: '2025-11-01' }, diario, '2026-11-10')).toEqual({ desde: '2025-11-01', hasta: '2026-11-10' });
        expect(S.rangoEfectivo({ fecha: '2025-11-03' }, diario, '2026-11-10')).toEqual({ desde: '2025-11-03', hasta: '2025-11-03' });
        expect(S.rangoEfectivo({ hasta: '2025-11-05' }, diario, '2026-11-10')).toEqual({ desde: '2025-10-30', hasta: '2025-11-05' });
        expect(S.rangoEfectivo({}, [], '2026-11-10')).toBeNull();
    });

    test('el flujo acumulado sigue hasta el último cierre sin pasar de hoy', () => {
        const r = { desde: '2025-10-30', hasta: '2025-11-09' };
        expect(S.rangoFlujo(r, cierres, '2026-11-10')).toEqual({ desde: '2025-10-30', hasta: '2025-12-02' });
        expect(S.rangoFlujo(r, cierres, '2025-11-20')).toEqual({ desde: '2025-10-30', hasta: '2025-11-20' });
        expect(S.rangoFlujo(r, [], '2026-11-10')).toEqual(r);
    });

    test('granularidad automática según la duración', () => {
        expect(S.granularidad('2025-11-01', '2025-11-30')).toBe('dia');
        expect(S.granularidad('2025-08-01', '2025-11-30')).toBe('semana');
        expect(S.granularidad('2025-01-01', '2025-12-31')).toBe('mes');
    });

    test('semanas de lunes a domingo, recortadas al periodo y marcadas como parciales', () => {
        const { gran, cubetas } = S.periodos('2025-10-30', '2025-11-09', 'semana');
        expect(gran).toBe('semana');
        expect(cubetas).toEqual([
            { clave: '2025-10-27', desde: '2025-10-30', hasta: '2025-11-02', parcial: true },
            { clave: '2025-11-03', desde: '2025-11-03', hasta: '2025-11-09', parcial: false }
        ]);
        const meses = S.periodos('2025-10-15', '2025-12-02', 'mes').cubetas;
        expect(meses.map(c => [c.clave, c.desde, c.hasta, c.parcial])).toEqual([
            ['2025-10', '2025-10-15', '2025-10-31', true], ['2025-11', '2025-11-01', '2025-11-30', false], ['2025-12', '2025-12-01', '2025-12-02', true]
        ]);
        // Demasiados días para verse uno por uno: se agrupa por semana
        expect(S.periodos('2024-01-01', '2025-12-31', 'dia').gran).toBe('semana');
    });

    test('agrupar: recibidos por fecha del reporte y cerrados por fecha de cierre; nada fuera del periodo', () => {
        const { cubetas } = S.periodos('2025-10-30', '2025-11-09', 'semana');
        const g = S.agrupar(diario, cierres, cubetas);
        expect(g.map(x => [x.recibidos, x.nuevos, x.atencion, x.resueltos, x.sin_accion, x.cerrados])).toEqual([[2, 1, 0, 1, 0, 1], [4, 2, 1, 0, 1, 1]]);
        // El total recibido coincide con la suma de los días del periodo
        expect(g.reduce((s, x) => s + x.recibidos, 0)).toBe(6);
        // Los estatus agrupados siempre suman los recibidos
        g.forEach(x => expect(x.nuevos + x.atencion + x.resueltos + x.sin_accion).toBe(x.recibidos));
    });

    test('acumulado: pendientes = recibidos − cerrados al final de cada cubeta', () => {
        const { cubetas } = S.periodos('2025-10-30', '2025-12-02', 'semana');
        const a = S.acumulado(diario, cierres, cubetas);
        const ult = a[a.length - 1];
        expect(ult).toMatchObject({ recibidos: 6, cerrados: 3, pendientes: 3 });
        expect(a[0]).toMatchObject({ recibidos: 2, cerrados: 1, pendientes: 1 });
        for (let i = 1; i < a.length; i++) {
            expect(a[i].recibidos).toBeGreaterThanOrEqual(a[i - 1].recibidos);
            expect(a[i].cerrados).toBeGreaterThanOrEqual(a[i - 1].cerrados);
        }
    });

    test('índice por búsqueda binaria', () => {
        const { cubetas } = S.periodos('2025-11-01', '2025-11-30', 'dia');
        expect(S.indiceDe(cubetas, '2025-11-01')).toBe(0);
        expect(S.indiceDe(cubetas, '2025-11-30')).toBe(29);
        expect(S.indiceDe(cubetas, '2025-12-01')).toBe(-1);
        expect(S.indiceDe(cubetas, '2025-10-31')).toBe(-1);
    });
});
