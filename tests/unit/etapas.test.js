const { calcularEtapas, semaforo, posicion } = require('../../lib/sms/etapas');

const seg = (estado, fecha, departamento = 'Operaciones') => ({ estado, fecha, departamento });

describe('Etapas de atención', () => {
    test('flujo completo con fechas y tiempo transcurrido', () => {
        const e = calcularEtapas({
            fechaReporte: '2025-10-01T10:00:00Z', estadoActual: 'D',
            seguimientos: [seg('A', '2025-10-01T10:00:00Z'), seg('B', '2025-10-01T11:00:00Z'), seg('C', '2025-10-02T10:00:00Z'), seg('D', '2025-10-03T10:00:00Z')]
        });
        expect(e.map(x => x.estado)).toEqual(['completa', 'completa', 'completa', 'completa']);
        expect(e[3].nombre).toBe('Resuelto');
        expect(e[1].minutos_desde_reporte).toBe(60);
        expect(e[3].minutos_desde_reporte).toBe(2 * 1440);
    });

    test('una etapa que no se registró queda como omitida, sin inventar fecha', () => {
        const e = calcularEtapas({ fechaReporte: '2025-10-01T10:00:00Z', estadoActual: 'E', seguimientos: [seg('B', '2025-10-01T10:05:00Z'), seg('E', '2025-10-01T10:10:00Z')] });
        expect(e[2]).toMatchObject({ estado: 'omitida', fecha: null });
        expect(e[3]).toMatchObject({ clave: 'E', nombre: 'Duplicado', estado: 'completa' });
    });

    test('reporte abierto: etapa actual y pendientes', () => {
        const e = calcularEtapas({ fechaReporte: '2025-10-01T10:00:00Z', estadoActual: 'B', seguimientos: [seg('B', '2025-10-01T12:00:00Z')] });
        expect(e.map(x => x.estado)).toEqual(['completa', 'actual', 'pendiente', 'pendiente']);
        expect(e[3].nombre).toBe('Cierre');
    });

    test('reabierto: las etapas posteriores vuelven a pendiente', () => {
        const e = calcularEtapas({
            fechaReporte: '2025-10-01T10:00:00Z', estadoActual: 'C',
            seguimientos: [seg('C', '2025-10-01T11:00:00Z'), seg('D', '2025-10-02T11:00:00Z'), seg('C', '2025-10-03T11:00:00Z')]
        });
        expect(e[2].estado).toBe('actual');
        expect(e[3]).toMatchObject({ estado: 'pendiente', fecha: null });
    });

    test('posición en el flujo', () => {
        expect(['A', 'B', 'C', 'D', 'E', 'F', null].map(posicion)).toEqual([0, 1, 2, 3, 3, 3, 0]);
    });
});

describe('Semáforo de plazos', () => {
    const hoy = '2025-10-10';
    test('abiertos', () => {
        expect(semaforo({ estado: 'C', fechaVencimiento: '2025-10-09' }, hoy, 7)).toBe('vencido');
        expect(semaforo({ estado: 'C', fechaVencimiento: '2025-10-10' }, hoy, 7)).toBe('proximo');
        expect(semaforo({ estado: 'C', fechaVencimiento: '2025-10-17' }, hoy, 7)).toBe('proximo');
        expect(semaforo({ estado: 'C', fechaVencimiento: '2025-10-18' }, hoy, 7)).toBe('en_tiempo');
        expect(semaforo({ estado: 'A', fechaVencimiento: null }, hoy, 7)).toBe('sin_plazo');
    });
    test('cerrados: cumplimiento contra el plazo', () => {
        expect(semaforo({ estado: 'D', plazoReporte: '2025-10-05', fechaCierre: '2025-10-05T18:00:00' }, hoy)).toBe('cerrado_en_plazo');
        expect(semaforo({ estado: 'D', plazoReporte: '2025-10-05', fechaCierre: '2025-10-06T08:00:00' }, hoy)).toBe('cerrado_fuera');
        expect(semaforo({ estado: 'F', plazoReporte: null, fechaCierre: '2025-10-06T08:00:00' }, hoy)).toBe('cerrado');
    });
});
