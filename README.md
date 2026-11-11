# AIFA-SMS · S.A.G.A.

Sistema de reportes de Seguridad Operacional (SMS) del Aeropuerto Internacional Felipe Ángeles: formulario de reporte, seguimiento por área, análisis estadístico y matriz de riesgo con los criterios del Manual SMS del AIFA.

## Requisitos

- Windows con [Node.js](https://nodejs.org) 18 o más reciente
- [MySQL](https://dev.mysql.com/downloads/installer/) 8

## Instalación

1. Descarga el repositorio (**Code → Download ZIP**) y descomprímelo, o clónalo.
2. Doble clic en **`Instalar en otra computadora.bat`**. Instala las dependencias (`npm install`, requiere internet), pide los datos de MySQL, crea la base vacía con los catálogos y guarda la configuración (`.env`).
3. Doble clic en **`Iniciar SMS.bat`**. Se abre la pantalla de acceso en http://localhost:3000/login.
4. Crea el primer administrador con el **código de configuración inicial** que muestra la ventana del SMS. Solo funciona desde esa misma computadora.

En macOS o Linux: `npm install`, `node instalacion/instalar.js` y `npm start`.

## Qué no incluye

Este repositorio no tiene datos reales: ni reportes, usuarios o fotos de evidencia, ni respaldos de la base, ni la configuración con claves (`.env`). Esos archivos se quedan solo en los equipos autorizados.

## Más información

- [LEEME.txt](LEEME.txt): uso de la copia local
- [README_SMS.md](README_SMS.md): funcionamiento del módulo SMS y migraciones
- [DESPLIEGUE_HOSTINGER.md](DESPLIEGUE_HOSTINGER.md): publicación en un servidor
