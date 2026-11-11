const c = require('../../lib/sms/clasificacion');
const f = require('../../lib/sms/filtros');
const riesgo = require('../../lib/sms/riesgo');

describe('Clasificación del reporte (formulario)', () => {
    test('sin datos opcionales todo queda en null', () => {
        expect(c.validarDatosReporte({})).toEqual({
            tipo_reporte: null, percepcion_probabilidad: null, percepcion_severidad: null, sugerencia_prevencion: null,
            vuelo: null, matricula: null, posicion: null, gse_tipo: null, gse_numero: null
        });
    });

    test('normaliza los datos operacionales', () => {
        const r = c.validarDatosReporte({
            tipo_reporte: 'casi_accidente', percepcion_probabilidad: '3', percepcion_severidad: 4,
            sugerencia_prevencion: '  Señalizar la zona  ',
            vuelo: ' vb 1234 ', matricula: 'xa-abc', posicion: '601', gse_tipo: 'Tractor de equipaje', gse_numero: 't-045'
        });
        expect(r).toMatchObject({
            tipo_reporte: 'casi_accidente', percepcion_probabilidad: 3, percepcion_severidad: 4,
            sugerencia_prevencion: 'Señalizar la zona',
            vuelo: 'VB 1234', matricula: 'XA-ABC', posicion: '601', gse_tipo: 'Tractor de equipaje', gse_numero: 'T-045'
        });
    });

    test('la parte involucrada ya no se recibe aunque venga en el formulario', () => {
        const r = c.validarDatosReporte({ id_parte_involucrada: '12', parte_involucrada_otra: 'Aerolínea X' });
        expect(r).not.toHaveProperty('id_parte_involucrada');
        expect(r).not.toHaveProperty('parte_involucrada_otra');
    });

    test('rechaza valores fuera de catálogo o de rango', () => {
        expect(() => c.validarDatosReporte({ tipo_reporte: 'otro' })).toThrow(/Tipo de reporte/);
        expect(() => c.validarDatosReporte({ percepcion_probabilidad: 6 })).toThrow(/Frecuencia/);
        expect(() => c.validarDatosReporte({ percepcion_severidad: '2.5' })).toThrow(/Gravedad/);
        expect(() => c.validarDatosReporte({ gse_tipo: 'Nave espacial' })).toThrow(/GSE/);
        expect(() => c.validarDatosReporte({ vuelo: 'VB<script>' })).toThrow(/Vuelo/);
        expect(() => c.validarDatosReporte({ matricula: 'XA-ABCDEFGHIJK' })).toThrow(/Matrícula/);
        expect(() => c.validarDatosReporte({ sugerencia_prevencion: 'x'.repeat(1001) })).toThrow(/1000/);
    });

    test('los errores llevan estado 400', () => {
        try { c.validarDatosReporte({ tipo_reporte: 'x' }); } catch (e) { expect(e.status).toBe(400); }
    });

    test('catálogo de tipos: voluntarios y obligatorios (numeral 5.2.1 del Manual SMS)', () => {
        expect(c.CLAVES_TIPO).toEqual(['condicion_insegura', 'acto_inseguro', 'buena_practica', 'casi_accidente', 'incidente', 'accidente']);
        expect(c.TIPOS_REPORTE.filter(t => t.grupo === 'voluntario').map(t => t.clave)).toEqual(['condicion_insegura', 'acto_inseguro', 'buena_practica']);
        expect(c.TIPOS_REPORTE.filter(t => t.grupo === 'obligatorio').map(t => t.clave)).toEqual(['casi_accidente', 'incidente', 'accidente']);
        expect(Object.keys(c.GRUPOS_REPORTE)).toEqual(['voluntario', 'obligatorio']);
        expect(c.nombreTipo('acto_inseguro')).toBe('Acto inseguro');
        expect(c.nombreTipo(null)).toBeNull();
    });

    test('incidente, accidente y condición insegura usan las definiciones de la NOM-064-SCT3-2023', () => {
        const d = k => c.TIPOS_REPORTE.find(t => t.clave === k).descripcion;
        expect(d('incidente')).toBe('Todo suceso relacionado con la utilización de una aeronave, que no llegue a ser un accidente que afecte o pueda afectar la Seguridad Operacional.');
        expect(d('accidente')).toMatch(/^Todo suceso en el cual se causen lesiones mortales o graves/);
        expect(d('condicion_insegura')).toBe('Condición u objeto que podría provocar un incidente o accidente de aviación o contribuir al mismo.');
    });

});

describe('Filtro por tipo de reporte', () => {
    test('se lee y valida; el filtro de parte involucrada ya no existe', () => {
        expect(f.leerFiltros({ tipo: 'incidente' })).toEqual({ tipo: 'incidente' });
        expect(f.leerFiltros({ tipo: 'sin_clasificar', parte: '4' })).toEqual({ tipo: 'sin_clasificar' });
        expect(f.leerFiltros({ tipo: "x' OR 1=1" })).toEqual({});
    });

    test('se traduce a SQL parametrizado', () => {
        const w = f.construirWhere({ tipo: 'accidente' });
        expect(w.sql).toMatch(/b\.tipo_reporte = \?/);
        expect(w.params).toEqual(['accidente']);
        expect(f.construirWhere({ tipo: 'sin_clasificar' }).sql).toBe('WHERE b.tipo_reporte IS NULL');
    });

    test('se describe con su nombre legible', () => {
        expect(f.describirFiltros({ tipo: 'buena_practica' })).toEqual([
            { clave: 'tipo', etiqueta: 'Tipo de reporte', valor: 'Buena práctica' }
        ]);
    });
});

describe('Severidad por tipo de consecuencia (matriz)', () => {
    const ref = () => riesgo.copia(riesgo.MATRIZ_REFERENCIA);

    test('la guía de referencia solo usa textos de la tabla de gravedad del Manual SMS', () => {
        const m = riesgo.validarMatriz(ref());
        expect(m.consecuencias.map(x => x.nombre)).toEqual(['Personas', 'Aeronave y equipo', 'Operación y márgenes de seguridad']);
        m.consecuencias.forEach(x => {
            expect(Object.keys(x.niveles)).toEqual(['1', '2', '3', '4', '5']);
            Object.entries(x.niveles).forEach(([s, texto]) => {
                if (!texto) return;
                const nivel = m.severidad.find(n => n.valor === Number(s));
                expect(nivel.descripcion).toContain(texto);
            });
        });
    });

    test('la matriz de referencia es la del numeral 5.3 del Manual SMS', () => {
        const m = riesgo.validarMatriz(ref());
        expect(m.severidad.map(s => s.codigo + ' ' + s.nombre)).toEqual(['A Catastrófico', 'B Peligroso', 'C Importante', 'D Leve', 'E Insignificante']);
        expect(m.niveles.map(n => n.nombre)).toEqual(['Intolerable', 'Tolerable', 'Aceptable']);
        const celdas = n => Object.keys(m.celdas).filter(k => m.celdas[k] === n)
            .map(k => { const [p, s] = k.split('-').map(Number); return p + riesgo.codigoSeveridad(m.severidad, s); }).sort();
        expect(celdas('alto')).toEqual(['3A', '4A', '4B', '5A', '5B', '5C']);
        expect(celdas('bajo')).toEqual(['1B', '1C', '1D', '1E', '2D', '2E', '3E']);
        expect(celdas('medio')).toEqual(['1A', '2A', '2B', '2C', '3B', '3C', '3D', '4C', '4D', '4E', '5D', '5E']);
    });

    test('una matriz guardada sin consecuencias sigue siendo válida', () => {
        const m = ref();
        delete m.consecuencias;
        expect(riesgo.validarMatriz(m).consecuencias).toEqual([]);
    });

    test('genera la clave desde el nombre y rechaza repetidos', () => {
        const m = ref();
        m.consecuencias = [{ nombre: 'Daño a Carga o Equipaje', niveles: { 1: 'a' } }];
        expect(riesgo.validarMatriz(m).consecuencias[0]).toEqual({ clave: 'dano_a_carga_o_equipaje', nombre: 'Daño a Carga o Equipaje', niveles: { 1: 'a', 2: '', 3: '', 4: '', 5: '' } });
        m.consecuencias = [{ nombre: 'Personas' }, { nombre: 'Personas' }];
        expect(() => riesgo.validarMatriz(m)).toThrow(/repetido/);
    });

    test('limita la cantidad y el largo', () => {
        const m = ref();
        m.consecuencias = Array.from({ length: 13 }, (_, i) => ({ nombre: 'Tipo ' + i }));
        expect(() => riesgo.validarMatriz(m)).toThrow(/12/);
        m.consecuencias = [{ nombre: 'Personas', niveles: { 3: 'x'.repeat(501) } }];
        expect(() => riesgo.validarMatriz(m)).toThrow(/500/);
    });
});
