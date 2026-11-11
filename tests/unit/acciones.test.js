const a = require('../../lib/sms/acciones');

describe('Reglas de cambio de estado de acciones correctivas', () => {
    test('transiciones permitidas y capacidad requerida', () => {
        expect(a.validarTransicion('pendiente', 'en_proceso')).toBe('actualizar_accion');
        expect(a.validarTransicion('en_proceso', 'completada')).toBe('actualizar_accion');
        expect(a.validarTransicion('completada', 'verificada')).toBe('verificar_accion');
        expect(a.validarTransicion('completada', 'en_proceso', { comentario: 'No fue efectiva' })).toBe('verificar_accion');
        expect(a.validarTransicion('pendiente', 'cancelada', { comentario: 'Duplicada' })).toBe('cancelar_accion');
    });

    test('no se puede saltar la verificación ni reabrir estados finales', () => {
        expect(() => a.validarTransicion('pendiente', 'verificada')).toThrow(/No se puede pasar/);
        expect(() => a.validarTransicion('en_proceso', 'verificada')).toThrow(/No se puede pasar/);
        expect(() => a.validarTransicion('verificada', 'en_proceso')).toThrow(/No se puede pasar/);
        expect(() => a.validarTransicion('cancelada', 'pendiente')).toThrow(/No se puede pasar/);
        expect(() => a.validarTransicion('pendiente', 'pendiente')).toThrow(/ya está/);
        expect(() => a.validarTransicion('pendiente', 'inventado')).toThrow(/no válido/);
    });

    test('cancelar y declarar no efectiva exigen comentario', () => {
        expect(() => a.validarTransicion('pendiente', 'cancelada')).toThrow(/motivo/);
        expect(() => a.validarTransicion('completada', 'en_proceso', { comentario: '  ' })).toThrow(/no fue efectiva/);
    });

    test('el reporte no se cierra mientras haya acciones sin concluir o sin verificar', () => {
        expect(a.evaluarCierre([]).puede_cerrar).toBe(true);
        expect(a.evaluarCierre([{ estado: 'verificada' }, { estado: 'cancelada' }]).puede_cerrar).toBe(true);
        const r = a.evaluarCierre([{ estado: 'verificada' }, { estado: 'completada' }, { estado: 'pendiente' }]);
        expect(r.puede_cerrar).toBe(false);
        expect(r.pendientes).toBe(2);
        expect(r.mensaje).toMatch(/2 acciones/);
    });

    test('valida los datos de una acción nueva', () => {
        expect(() => a.validarNuevaAccion({ tipo: 'correctiva', descripcion: 'abc', fecha_compromiso: '2026-12-01', responsable_nombre: 'X' }, '2026-11-04')).toThrow(/mínimo 5/);
        expect(() => a.validarNuevaAccion({ tipo: 'otra', descripcion: 'Acción válida', fecha_compromiso: '2026-12-01', responsable_nombre: 'X' }, '2026-11-04')).toThrow(/correctiva o preventiva/);
        expect(() => a.validarNuevaAccion({ tipo: 'correctiva', descripcion: 'Acción válida', fecha_compromiso: '2026-12-01' }, '2026-11-04')).toThrow(/responsable/);
        expect(() => a.validarNuevaAccion({ tipo: 'correctiva', descripcion: 'Acción válida', fecha_compromiso: '2026-02-30', responsable_nombre: 'X' }, '2026-11-04')).toThrow(/fecha compromiso/);
        expect(() => a.validarNuevaAccion({ tipo: 'correctiva', descripcion: 'Acción válida', fecha_asignacion: '2026-11-10', fecha_compromiso: '2026-11-05', responsable_nombre: 'X' }, '2026-11-04')).toThrow(/anterior/);
        const ok = a.validarNuevaAccion({ tipo: 'preventiva', descripcion: '  Revisar señalización  ', fecha_compromiso: '2026-12-01', id_departamento_responsable: '28' }, '2026-11-04');
        expect(ok).toMatchObject({ tipo: 'preventiva', descripcion: 'Revisar señalización', id_departamento_responsable: 28, fecha_asignacion: '2026-11-04' });
    });

    test('clasifica el vencimiento de una fecha compromiso', () => {
        expect(a.estadoVencimiento('2026-11-01', '2026-11-04', 7)).toBe('vencido');
        expect(a.estadoVencimiento('2026-11-04', '2026-11-04', 7)).toBe('proximo');
        expect(a.estadoVencimiento('2026-11-11', '2026-11-04', 7)).toBe('proximo');
        expect(a.estadoVencimiento('2026-11-12', '2026-11-04', 7)).toBe('en_tiempo');
        expect(a.estadoVencimiento(null, '2026-11-04', 7)).toBeNull();
    });
});
