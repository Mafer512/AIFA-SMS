const f = require('../../lib/sms/filtros');
const { puede, capacidadesDe } = require('../../lib/sms/permisos');

describe('Lectura de filtros', () => {
    test('normaliza y descarta valores inválidos', () => {
        const r = f.leerFiltros({
            folio: 'rsm-54', q: '  fauna  ', fecha: '2025-02-30', desde: '2025-10-31', hasta: '2025-10-01',
            area: 'abc', responsable: '28', estado: 'Z', riesgo: 'medio', vencimiento: 'todos'
        }, { nivelesRiesgo: ['alto', 'medio', 'bajo'] });
        expect(r).toEqual({ folio: 'RSM-54', q: 'fauna', desde: '2025-10-01', hasta: '2025-10-31', responsable: 28, riesgo: 'medio' });
    });

    test('rechaza folios con caracteres no permitidos', () => {
        expect(f.leerFiltros({ folio: "RSM-1' OR 1=1" }).folio).toBeUndefined();
    });

    test('acepta los estados agrupados', () => {
        ['abiertos', 'cerrados', 'atencion', 'A', 'F'].forEach(e => expect(f.leerFiltros({ estado: e }).estado).toBe(e));
    });

    test('orden y paginación con lista blanca', () => {
        expect(f.leerOrden({ orden: 'fecha; DROP TABLE reportes', dir: 'x' })).toEqual({ campo: 'fecha', dir: 'desc' });
        expect(f.leerOrden({ orden: 'prioridad', dir: 'asc' })).toEqual({ campo: 'prioridad', dir: 'asc' });
        expect(f.leerPagina({ pagina: '3', por_pagina: '50' })).toEqual({ pagina: 3, porPagina: 50, offset: 100 });
        expect(f.leerPagina({ pagina: '-1', por_pagina: '1000' })).toEqual({ pagina: 1, porPagina: 25, offset: 0 });
    });
});

describe('Construcción del WHERE', () => {
    test('los filtros se combinan con AND y todos los valores van como parámetros', () => {
        const w = f.construirWhere({ folio: 'RSM-5', q: 'fod pista', area: 28, estado: 'abiertos', vencimiento: 'proximos' }, { diasAviso: 7 });
        expect(w.sql.startsWith('WHERE ')).toBe(true);
        expect(w.sql.split('\n  AND ').length).toBe(6);
        expect(w.params).toEqual(['%RSM-5%', '%fod%', '%fod%', '%fod%', '%fod%', '%fod%', '%pista%', '%pista%', '%pista%', '%pista%', '%pista%', 28, 7]);
        expect(w.sql).not.toMatch(/RSM-5|fod|pista/);
    });

    test('escapa comodines de LIKE', () => {
        expect(f.escaparLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    });

    test('"alto riesgo" sin niveles altos configurados no devuelve resultados', () => {
        expect(f.construirWhere({ riesgo: 'altos' }, { nivelesAltos: [] }).sql).toBe('WHERE FALSE');
    });

    test('sin filtros no hay WHERE', () => {
        expect(f.construirWhere({})).toEqual({ sql: '', params: [] });
    });

    test('el orden por prioridad deja al final los no evaluados', () => {
        const o = f.construirOrden({ campo: 'prioridad', dir: 'desc' }, { nivelesOrden: ['alto', 'medio', 'bajo'] });
        expect(o).toMatch(/^ORDER BY \(b\.riesgo_nivel IS NULL\) ASC, FIELD\(b\.riesgo_nivel, 'alto', 'medio', 'bajo'\) ASC/);
    });
});

describe('Permisos por rol', () => {
    test('matriz de capacidades', () => {
        const v = { rol: 'viewer' }, e = { rol: 'editor' }, s = { rol: 'supervisor' }, a = { rol: 'admin' };
        expect(puede(null, 'ver_interno')).toBe(false);
        expect(puede(v, 'ver_interno')).toBe(true);
        expect(puede(v, 'registrar_accion')).toBe(false);
        expect(puede(e, 'registrar_accion')).toBe(true);
        expect(puede(e, 'verificar_accion')).toBe(false);
        expect(puede(e, 'evaluar_riesgo')).toBe(false);
        expect(puede(s, 'evaluar_riesgo')).toBe(true);
        expect(puede(s, 'configurar_matriz')).toBe(false);
        expect(puede(a, 'configurar_matriz')).toBe(true);
        expect(capacidadesDe({ rol: 'desconocido' })).toEqual([]);
    });
});

describe('Filtros nuevos (plazos, evaluación, zonas)', () => {
    test('se aceptan y se traducen a SQL parametrizado', () => {
        const r = f.leerFiltros({ riesgo: 'pendiente_evaluar', estado: 'sin_accion', vencimiento: 'cerrado_fuera', zona: '7' });
        expect(r).toEqual({ riesgo: 'pendiente_evaluar', estado: 'sin_accion', vencimiento: 'cerrado_fuera', zona: 7 });
        const w = f.construirWhere(r);
        expect(w.sql).toMatch(/b\.id_zona = \?/);
        expect(w.sql).toMatch(/b\.estado IN \('E','F'\)/);
        expect(w.sql).toMatch(/b\.cerrado_en_plazo = 0/);
        expect(w.sql).toMatch(/b\.riesgo_nivel IS NULL AND b\.estado NOT IN/);
        expect(w.params).toEqual([7]);
    });
    test('"en tiempo" usa los días de aviso configurados', () => {
        const w = f.construirWhere({ vencimiento: 'en_tiempo' }, { diasAviso: 10 });
        expect(w.params).toEqual([10]);
    });
    test('zona inválida se ignora', () => {
        expect(f.leerFiltros({ zona: '1 OR 1=1' }).zona).toBeUndefined();
    });
    test('nuevas capacidades por rol', () => {
        expect(puede({ rol: 'editor' }, 'asignar_compromiso')).toBe(true);
        expect(puede({ rol: 'viewer' }, 'asignar_compromiso')).toBe(false);
        expect(puede({ rol: 'supervisor' }, 'configurar_spi')).toBe(false);
        expect(puede({ rol: 'admin' }, 'configurar_zonas')).toBe(true);
    });
});
