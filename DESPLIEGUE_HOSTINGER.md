# Publicar el SMS en Hostinger (`sms.opn-nlu.com`)

Con esto el SMS queda en `https://sms.opn-nlu.com`, en el mismo hosting que el portal y que Contratos, y ya no depende de que una computadora esté encendida.

Los nombres de los menús de hPanel pueden variar un poco según la versión del panel.

## Antes de empezar

- Acceso al **hPanel** de la cuenta donde está `opn-nlu.com`.
- Autorización para alojar ahí la información del SMS. Incluye datos personales de quienes reportan: nombres, teléfonos y ubicación.
- Decidir si se **pasan los datos actuales** o se empieza **en blanco**.

Si se pasan los datos actuales, en la computadora donde está hoy el SMS ejecuta:

```
npm run exportar-servidor
```

Ese comando genera dos archivos en `respaldos/para-servidor/`:

- `aifa_rsm_servidor_<fecha>.sql`: la base completa, con reportes, seguimientos y usuarios. Ya viene preparada para un hosting compartido.
- `uploads_<fecha>.zip`: las fotos de evidencia.

## 1. Base de datos

En hPanel, entra a **Bases de datos → Administración de MySQL**.

1. Crea una base de datos y un usuario. Hostinger les agrega un prefijo, por ejemplo `u123456789_sms`. Anota el nombre de la base, el usuario y la contraseña.
2. Abre **phpMyAdmin** de esa base, ve a **Importar** y sube uno de estos archivos:
   - Con los datos actuales: `aifa_rsm_servidor_<fecha>.sql`.
   - En blanco: `database/esquema_y_catalogos.sql`, que trae solo la estructura y los catálogos.

## 2. Aplicación Node.js

En hPanel, agrega un sitio web de tipo **aplicación web Node.js**.

| Opción | Valor |
|---|---|
| Origen | Repositorio de GitHub `Mafer512/SMS`, rama `main`. El repositorio es privado: autoriza el acceso de Hostinger a GitHub |
| Dominio | Subdominio `sms.opn-nlu.com` |
| Versión de Node.js | 22 (mínimo 18) |
| Instalación | `npm install` |
| Inicio | `npm start` (archivo de entrada `app.js`) |

**Variables de entorno.** Se capturan en el panel; no se sube ningún archivo `.env`.

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Clave nueva de al menos 32 caracteres; genera una con `npm run generar-clave`. No reutilices la de otra computadora. Sin ella el servidor **no arranca**, a propósito |
| `BASE_URL` | `https://sms.opn-nlu.com` |
| `CORS_ORIGIN` | `https://sms.opn-nlu.com` |
| `DB_HOST` | `localhost`, o el servidor que indique Hostinger en la sección de bases de datos |
| `DB_PORT` | `3306` |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Los del paso 1 |
| `UPLOADS_DIR` | Carpeta **fuera** de la aplicación, por ejemplo `/home/USUARIO/sms-datos/uploads`. Así las fotos no se borran al actualizar |
| `RESPALDOS_DIR` | Por ejemplo `/home/USUARIO/sms-datos/respaldos` |

`PORT` no se define: Hostinger lo asigna.

## 3. Fotos de evidencia

Solo aplica si se pasaron los datos actuales.

1. En el **Administrador de archivos**, crea la carpeta que pusiste en `UPLOADS_DIR`.
2. Sube ahí `uploads_<fecha>.zip` y usa **Extraer**.
3. Comprueba que quede `UPLOADS_DIR/reportes/...` y no `UPLOADS_DIR/uploads/reportes/...`.

## 4. Comprobar

- `https://sms.opn-nlu.com/reportes/general` abre con el candado de HTTPS.
- Puedes iniciar sesión con tu cuenta, si se pasaron los datos.
- Un reporte con fotos las muestra.
- **Administración → Respaldos**: si avisa que no encuentra `mysqldump`, desactiva el respaldo propio con `RESPALDO_AUTOMATICO=0` y usa las copias que Hostinger guarda de la base.

### Instalación en blanco: primer administrador

La pantalla de configuración inicial solo funciona desde la computadora donde corre el servidor, así que en el hosting no sirve. La primera cuenta se crea desde la terminal (SSH) de Hostinger, en la carpeta de la aplicación:

```
npm run migrar
node scripts/crear-usuario.js --usuario <usuario> --nombre "<Nombre Apellidos>" --correo <correo> --rol admin --departamento <id_departamento>
```

`npm run migrar` aplica los cambios de base de datos posteriores a `esquema_y_catalogos.sql` (por ejemplo, la clasificación de reportes y la matriz del Manual SMS). No borra ni modifica datos.

## 5. Cambiar el botón del portal

En `AIFA-OPERACIONES` (`index.html`), el botón **SMS** apunta a `http://localhost:3000/reportes/general`. Cámbialo a `https://sms.opn-nlu.com/reportes/general` y actualiza la prueba `__tests__/vista-director-general.test.js`, que lista los accesos directos.

## Después del traspaso

- Borra de la computadora los archivos de `respaldos/para-servidor/`, porque contienen datos personales.
- La base oficial pasa a ser la del hosting. La copia de la computadora local deja de coincidir; úsala solo para pruebas.
- Para publicar cambios, sube a `main` y usa **Redeploy** en hPanel. Si se activa el despliegue automático, se publica solo.
- Si el cambio trae una migración nueva en `database/migraciones/`, ejecuta `npm run migrar` por SSH en la carpeta de la aplicación y luego reinicia la aplicación.
