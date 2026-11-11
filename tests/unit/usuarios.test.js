const u = require('../../lib/sms/usuarios');

describe('Usuarios: reglas', () => {
    test('sugiere el usuario a partir del nombre', () => {
        expect(u.sugerirUsuario('Fabrizio', 'Pizano Ruiz')).toBe('fabrizio.pizano');
        expect(u.sugerirUsuario('José Ángel', '')).toBe('jose.angel');
        expect(u.sugerirUsuario('María')).toBe('maria');
    });

    test('las contraseñas generadas cumplen la política', () => {
        for (let i = 0; i < 20; i++) {
            const p = u.generarPassword();
            expect(p).toHaveLength(14);
            expect(u.problemaPassword(p)).toBeNull();
        }
    });

    test('política de contraseñas', () => {
        expect(u.problemaPassword('corta1')).toMatch(/10 caracteres/);
        expect(u.problemaPassword('soloLetrasLargas')).toMatch(/letras y números/);
        expect(u.problemaPassword('fabrizio.pizano2026', { usuario: 'fabrizio.pizano' })).toMatch(/usuario/);
        expect(u.problemaPassword('Fabrizio2026x', { nombre: 'Fabrizio' })).toMatch(/nombre/);
        expect(u.problemaPassword('1234567890')).not.toBeNull();
        expect(u.problemaPassword('Torre-Control-17')).toBeNull();
    });

    test('valida datos y rechaza usuarios con espacios', () => {
        expect(() => u.validarDatos({ nombre: 'Fabrizio', username: 'Fabrizio Pizano', email: 'f@aifa.aero', rol: 'admin', id_departamento: 1 })).toThrow(/sin espacios/);
        expect(() => u.validarDatos({ nombre: 'F', username: 'fp', email: 'x', rol: 'jefe', id_departamento: 1 })).toThrow();
        const ok = u.validarDatos({ nombre: ' Fabrizio ', apellidos: 'Pizano', username: 'fabrizio.pizano', email: 'Fabrizio@AIFA.aero', rol: 'admin', id_departamento: '3' });
        expect(ok).toEqual({ nombre: 'Fabrizio', apellidos: 'Pizano', username: 'fabrizio.pizano', email: 'fabrizio@aifa.aero', rol: 'admin', id_departamento: 3 });
        expect(u.validarDatos({ activo: false }, { parcial: true })).toEqual({ activo: 0 });
    });

    test('comparación del código de configuración', () => {
        expect(u.igualesSeguro('AB12C-DE34F', 'AB12C-DE34F')).toBe(true);
        expect(u.igualesSeguro('AB12C-DE34X', 'AB12C-DE34F')).toBe(false);
        expect(u.igualesSeguro('', 'AB12C-DE34F')).toBe(false);
    });
});
