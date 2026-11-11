const B = require('../../public/js/buscable');

const lista = [
    'Aumento de fauna por factores ambientales o estacionales',
    'Avistamiento de fauna aviar',
    'Cruce al frente o detrás de una aeronave',
    'Falla en el sistema VDGS (Visual Docking Guidance System)',
    'FOD (Foreign Object Debris)',
    'Impacto con fauna dentro del polígono',
    'Falla/ausencia de iluminación en área operacional'
].map((texto, orden) => ({ valor: String(orden), texto, grupo: '', orden, norm: B.normalizar(texto) }));
const textos = r => r.map(o => o.texto);

describe('Lista con búsqueda', () => {
    test('sin texto muestra todas en su orden', () => {
        expect(B.filtrar(lista, '')).toHaveLength(lista.length);
    });

    test('primero las que empiezan con lo escrito, luego por palabra y al final las que lo contienen', () => {
        expect(textos(B.filtrar(lista, 'f'))).toEqual([
            'Falla en el sistema VDGS (Visual Docking Guidance System)',
            'FOD (Foreign Object Debris)',
            'Falla/ausencia de iluminación en área operacional',
            'Aumento de fauna por factores ambientales o estacionales',
            'Avistamiento de fauna aviar',
            'Cruce al frente o detrás de una aeronave',
            'Impacto con fauna dentro del polígono'
        ]);
        expect(textos(B.filtrar(lista, 'fauna'))).toEqual([
            'Aumento de fauna por factores ambientales o estacionales',
            'Avistamiento de fauna aviar',
            'Impacto con fauna dentro del polígono'
        ]);
    });

    test('no distingue acentos ni mayúsculas y acepta varias palabras', () => {
        expect(textos(B.filtrar(lista, 'ILUMINACION'))).toEqual(['Falla/ausencia de iluminación en área operacional']);
        expect(textos(B.filtrar(lista, 'detras aeronave'))).toEqual(['Cruce al frente o detrás de una aeronave']);
        expect(B.filtrar(lista, 'zzz')).toEqual([]);
    });

    test('resalta lo escrito respetando acentos y escapando el texto', () => {
        expect(B.resaltar('Falla/ausencia de iluminación', 'ILUMINACION')).toBe('Falla/ausencia de <mark>iluminación</mark>');
        expect(B.resaltar('Avistamiento de fauna aviar', 'av')).toBe('<mark>Av</mark>istamiento de fauna aviar');
        expect(B.resaltar('Cruce <b>', 'cru')).toBe('<mark>Cru</mark>ce &lt;b&gt;');
    });
});
