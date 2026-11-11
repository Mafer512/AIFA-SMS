const riesgo = require('../../lib/sms/riesgo');

describe('Matriz de riesgo', () => {
    const ref = () => riesgo.copia(riesgo.MATRIZ_REFERENCIA);

    test('la matriz de referencia es válida y queda marcada como NO validada', () => {
        const m = riesgo.validarMatriz(ref());
        expect(m.validada).toBe(false);
        expect(Object.keys(m.celdas)).toHaveLength(25);
        expect(m.niveles.map(n => n.clave)).toEqual(['alto', 'medio', 'bajo']);
    });

    test('clasifica una combinación con el código de la celda', () => {
        const r = riesgo.clasificar(ref(), 4, 4);
        expect(r).toMatchObject({ indice: '4B', nivel: 'alto', nivel_nombre: 'Intolerable', es_alto: true, prioridad: 'Medidas inmediatas para mitigar o suspender la actividad' });
        expect(riesgo.clasificar(ref(), 1, 1)).toMatchObject({ indice: '1E', nivel: 'bajo' });
        expect(riesgo.clasificar(ref(), 3, 3)).toMatchObject({ indice: '3C', nivel: 'medio' });
    });

    test('rechaza valores fuera de 1 a 5', () => {
        expect(() => riesgo.clasificar(ref(), 0, 3)).toThrow(/probabilidad/);
        expect(() => riesgo.clasificar(ref(), 3, 6)).toThrow(/severidad/);
        expect(() => riesgo.clasificar(ref(), '2.5', 3)).toThrow();
    });

    test('valida la estructura al guardar', () => {
        const m = ref();
        m.probabilidad = m.probabilidad.slice(0, 4);
        expect(() => riesgo.validarMatriz(m)).toThrow(/exactamente 5/);

        const c = ref();
        c.niveles[0].color = 'rojo';
        expect(() => riesgo.validarMatriz(c)).toThrow(/#RRGGBB/);

        const d = ref();
        d.niveles[1].clave = 'alto';
        expect(() => riesgo.validarMatriz(d)).toThrow(/repetida/);

        const e = ref();
        e.celdas['2-2'] = 'inexistente';
        expect(() => riesgo.validarMatriz(e)).toThrow(/celda 2D/);

        const f = ref();
        f.niveles[0].plazo_dias = 0;
        expect(() => riesgo.validarMatriz(f)).toThrow(/plazo/);

        const g = ref();
        g.alertas.dias_aviso_vencimiento = 90;
        expect(() => riesgo.validarMatriz(g)).toThrow(/aviso/);
    });

    test('acepta plazos y normaliza colores', () => {
        const m = ref();
        m.niveles[0].plazo_dias = '7';
        m.niveles[0].color = '#cf324c';
        const v = riesgo.validarMatriz(m);
        expect(v.niveles[0].plazo_dias).toBe(7);
        expect(v.niveles[0].color).toBe('#CF324C');
    });
});

describe('Validación institucional de la matriz', () => {
    const r = require('../../lib/sms/riesgo');
    test('los datos de validación solo se conservan si la matriz está validada', () => {
        const base = r.copia(r.MATRIZ_REFERENCIA);
        const conValidacion = r.validarMatriz({ ...base, validada: true, validacion: { por: 'Admin', fecha: '2026-01-01T00:00:00Z', referencia: 'Acta 1' } });
        expect(conValidacion.validacion).toEqual({ por: 'Admin', fecha: '2026-01-01T00:00:00Z', referencia: 'Acta 1' });
        const sin = r.validarMatriz({ ...base, validada: false, validacion: { por: 'Admin' } });
        expect(sin.validacion).toBeNull();
    });
    test('la matriz de referencia no viene validada', () => {
        expect(r.MATRIZ_REFERENCIA.validada).toBe(false);
    });
});
