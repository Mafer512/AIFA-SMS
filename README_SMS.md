# Módulo SMS · Reportes y seguimientos (S.A.G.A. · AIFA)

Monitoreo, análisis y seguimiento de hallazgos de Seguridad Operacional. Se
construyó sobre la aplicación existente (Express + EJS + MySQL) sin eliminar
funciones previas.

## Instalación / actualización

```bash
npm install                 # agrega exceljs (exportación a Excel)
mysqldump -uroot aifa_rsm > respaldo.sql   # respaldo antes de migrar
npm run migrar              # aplica database/migraciones (no destructivas)
npm start
```

`npm run migrar` solo **crea tablas y agrega columnas o índices que no
existan**; nunca elimina ni modifica datos. Lleva control en
`migraciones_aplicadas`, así que se puede ejecutar varias veces. Las
migraciones pueden ser `.sql` o `.js` (las `.js` revisan el esquema antes de
alterar una tabla, porque MySQL no admite `ADD COLUMN IF NOT EXISTS`).

| Migración | Cambio |
|---|---|
| 001 | Tablas `reporte_evaluacion_riesgo`, `acciones_correctivas`, `acciones_correctivas_archivos`, `notificaciones`, `notificaciones_lectura` |
| 002 | Tabla `reporte_compromiso` (responsable y fecha compromiso con historial); columnas `tipo` (inicial/residual) y `medidas_mitigacion` en `reporte_evaluacion_riesgo`; tablas `zonas_aeropuerto` y `reporte_zona` (módulo opcional) |
| 003 | Tabla `reportes_eliminados` (copia completa de cada reporte eliminado, para restaurarlo) |
| 004 | Columnas de clasificación en `reportes` (tipo de reporte, opinión de quien reporta sobre frecuencia y gravedad, sugerencia de prevención, vuelo, matrícula, posición y equipo de apoyo); también crea la tabla `partes_involucradas` y las columnas `id_parte_involucrada` y `parte_involucrada_otra`, que el sistema ya no usa (la parte involucrada se quitó del formulario; quedan en la base sin datos); descripciones de severidad por tipo de consecuencia en la matriz de riesgo (solo si la matriz guardada no está validada) |
| 005 | Matriz de riesgo con los criterios del numeral 5.3 del Manual SMS del AIFA (Revisión 02, nov. 2025): probabilidad, gravedad, niveles Intolerable / Tolerable / Aceptable y guía de gravedad por tipo de consecuencia. Solo reemplaza una matriz sin validar que siga igual a la referencia anterior (OACI) |

### Datos de quien reporta

Nombre, teléfono, gerencia, cargo, IP y navegador de quien reporta **no se
muestran sin sesión**: el detalle y el historial públicos del reporte (y las
rutas `/api/reportes` y `/api/departamento/:id/reportes`) ya no los incluyen.
El personal con sesión los ve en el detalle y el historial
(`GET /api/sms/reportes/:folio/reportante`, permiso `ver_interno`). El
formulario lo explica en el aviso de confidencialidad, cuyo texto debe
validar la Gerencia de SMS con Jurídica.

## Usuarios y permisos

- **Primera cuenta de administrador**: en `/login` aparece "Crear cuenta de
  administrador" **solo si se abre desde la misma computadora del servidor**
  (no a través de un proxy). Pide el **código de configuración** que el
  servidor imprime en su terminal al iniciar
  (`[S.A.G.A.] Código de configuración inicial: XXXXX-XXXXX`). El código
  cambia en cada inicio, después de usarse y tras 5 intentos fallidos.
- **`/admin/usuarios`** (admin): alta de usuarios (contraseña generada o
  escrita, mostrada una sola vez), rol, área, cargo, desactivar/reactivar,
  restablecer contraseña y desbloquear. No se eliminan cuentas (se conserva
  su historial), no puedes desactivarte ni cambiar tu propio rol, y siempre
  queda al menos un administrador activo.
- **`/mi-cuenta`**: cada usuario cambia su contraseña. Con contraseña
  temporal, al iniciar sesión se le lleva ahí.
- Se puede iniciar sesión con el **usuario o el correo**.
- Política de contraseñas: 10+ caracteres, letras y números, sin el usuario
  ni el nombre. Se guardan con bcrypt.
- Todo queda en la bitácora (`usuario_creado`, `usuario_actualizado`,
  `usuario_desactivado`, `password_restablecida`, `password_cambiada`…).
- Alternativa por terminal: `node scripts/crear-usuario.js` (mismas reglas).

## Respaldos

- Automáticos **cada 24 h** mientras el servidor está encendido (revisa al
  iniciar y cada hora). Se guardan comprimidos en `respaldos/` y se
  conservan los últimos 30 (`RESPALDOS_CONSERVAR`). `RESPALDO_AUTOMATICO=0`
  los desactiva.
- Manual: `npm run respaldar` o **Administración → Respaldos → Respaldar ahora**
  (queda en la bitácora).
- Usan `mysqldump` (se busca en el PATH y en `C:Program FilesMySQL`; si
  no, indicar `MYSQLDUMP_PATH`).
- **Restaurar** (reemplaza los datos de la base de destino; probar antes en
  una base de pruebas):

  ```bash
  node -e "process.stdout.write(require('zlib').gunzipSync(require('fs').readFileSync('respaldos/ARCHIVO.sql.gz')))" | mysql -uroot aifa_rsm
  ```

- Contienen datos personales: no se publican ni se suben al control de
  versiones (`.gitignore`).

## Control de versiones

El proyecto usa git. Quedan fuera (`.gitignore`): `.env`, `node_modules/`,
`uploads/` (evidencias), `respaldos/` y `database/backup_completo.sql`
(contiene datos reales). Para instalar desde cero sin datos personales:

```bash
mysql -uroot -e "CREATE DATABASE aifa_rsm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -uroot aifa_rsm < database/esquema_y_catalogos.sql   # estructura + áreas y categorías
npm run migrar
```

## Publicar en un servidor

Pasos completos para Hostinger (`sms.opn-nlu.com`) en
[DESPLIEGUE_HOSTINGER.md](DESPLIEGUE_HOSTINGER.md). En resumen:

- `NODE_ENV=production` exige `JWT_SECRET` de al menos 32 caracteres
  aleatorios (`npm run generar-clave`); sin ella el servidor no arranca.
- `UPLOADS_DIR` lleva las fotos de evidencia fuera del código.
- `npm run exportar-servidor` genera la base y las fotos listas para
  importarse en un hosting compartido (sin `DEFINER` ni intercalaciones de
  MySQL 8). `database/esquema_y_catalogos.sql` ya viene igual de limpio.

## Eliminar reportes

- Solo **administradores**: botón 🗑 en cada fila de `/reportes/general`, en
  las tarjetas móviles y "Eliminar reporte" en el detalle.
- Se pide el **motivo** y **escribir el folio** para confirmar.
- Antes de borrar se guarda una **copia completa** (áreas, seguimientos,
  evidencias, ubicación, acciones, riesgo, compromisos y zona) en
  `reportes_eliminados`. Luego se elimina con las llaves foráneas en cascada.
- `/admin/eliminados` lista lo eliminado y permite **restaurar** el reporte
  tal como estaba (mismos id y fechas).
- El folio de un reporte eliminado **no se vuelve a asignar** y la bitácora
  conserva el folio, quién eliminó, cuándo y por qué.
- Los archivos de imagen no se borran del almacenamiento (para poder restaurar).
- Las notificaciones del reporte no se restauran.

Configuración en `configuracion_sistema` (se crea al guardar desde la interfaz):
`sms_matriz_riesgo`, `sms_spi`, `sms_zonas`. La bitácora de auditoría reutiliza
`logs_sistema` (`categoria = 'auditoria'`).

## Pantallas

| Ruta | Contenido | Acceso |
|---|---|---|
| `/reportes/general` | Indicadores con cuadre de cifras y variación contra el periodo anterior, filtros, tabla sin doble desplazamiento, semáforo de plazos, vista rápida con etapas, exportación | Público (como antes) |
| `/reportes/analisis` | Gráficas interactivas (leyendas, zoom, clic para filtrar, PNG), comparación entre periodos, SPI, desempeño por área responsable, recurrencias, consistencia de datos | Público |
| `/reportes/:folio` | Etapas de atención, semáforo, responsable y fecha compromiso, zona, riesgo inicial → residual, acciones, historial con autor | Público; gestión según rol |
| `/reportes/ejecutivo` | Informe ejecutivo para imprimir / PDF (resumen, indicadores, comparativo, SPI, áreas, recurrencias, listado) | Público |
| `/notificaciones` | Centro de notificaciones: actividad (filtros, no leídas, paginación) y alertas vigentes | Con sesión |
| `/admin/matriz-riesgo` | Matriz 5×5 y su validación institucional | Consulta: todos · edición: admin |
| `/admin/spi` | Indicadores SPI: métrica, meta, alerta, validación; parámetros de recurrencia | Consulta: todos · edición: admin |
| `/admin/zonas` | Módulo opcional de zonas autorizadas | Consulta: todos · edición: admin |
| `/admin/auditoria` | Bitácora con filtros por tipo, folio y fechas | Supervisor, admin |

## Roles y permisos

| Capacidad | viewer | editor | supervisor | admin |
|---|:-:|:-:|:-:|:-:|
| Ver detalle interno (acciones, autores, historial de compromisos) | ✓ | ✓ | ✓ | ✓ |
| Registrar y avanzar acciones **de su área** | | ✓ | ✓ | ✓ |
| Asignar responsable y fecha compromiso **de su área** | | ✓ | ✓ | ✓ |
| Asignar zona a reportes **de su área** (módulo activo) | | ✓ | ✓ | ✓ |
| Evaluar riesgo inicial y residual, verificar efectividad, cancelar | | | ✓ | ✓ |
| Exportar con datos del reportante · bitácora | | | ✓ | ✓ |
| Configurar matriz, SPI y zonas | | | | ✓ |
| Eliminar y restaurar reportes | | | | ✓ |

- El token se valida y además se consulta el usuario en la BD en cada petición.
- Alta de usuarios: `node scripts/crear-usuario.js --usuario jlopez --nombre "Juan López" --correo jlopez@aifa.aero --rol editor --departamento dir_operacion`

## Reglas de negocio

- **Una fila por reporte.** El estatus vigente es el del último seguimiento.
  Un reporte asociado a varias áreas cuenta una sola vez en los totales; en el
  desempeño por área cuenta en cada área y la fila de totales lo cuenta una vez.
- **Cuadre de cifras** (se verifica y se muestra): total = abiertos + cerrados;
  abiertos = nuevos (A) + en atención (B, C); cerrados = Resuelto (D) +
  Duplicado (E) + No requiere atención (F). Duplicado y No requiere atención
  **no** cuentan como resoluciones.
- **Tiempo de resolución**: de la fecha del reporte al primer seguimiento
  Resuelto posterior a su última reapertura. Se informan **mediana** y
  promedio (la mediana no se distorsiona por casos extremos).
- **Plazo del reporte**: lo que ocurra primero entre su fecha compromiso y la
  fecha límite de su riesgo inicial (si el nivel tiene plazo). **Vencimiento**
  (abiertos): el plazo del reporte o la fecha compromiso más próxima de sus
  acciones abiertas.
- **Semáforo**: abiertos → vencido / próximo (días de aviso de la matriz) /
  en tiempo / sin plazo; cerrados → en plazo / fuera de plazo / sin plazo.
  Siempre con luces, icono y texto (nunca solo color).
- **Compromiso de atención**: área (de las asociadas al reporte), persona y
  fecha (hoy o posterior). Reprogramar exige motivo; todo queda en historial,
  bitácora y notificación al área.
- **Etapas**: Generado → Enterado → En atención → cierre, con la fecha del
  primer seguimiento de cada etapa. Una etapa que no se registró se muestra
  como "sin registro" (no se inventan fechas).
- **Riesgo**: solo se evalúa con una matriz **validada institucionalmente**
  (el servidor registra quién y cuándo la validó). Inicial = peligro
  identificado; residual = después de las medidas de mitigación (obligatorias
  y solo si existe el inicial). El plazo lo fija el riesgo inicial.
- **Acciones**: pendiente → en proceso → concluida (por verificar) → verificada.
  No se registra un cierre (D Resuelto, E Duplicado o F No requiere
  atención) con acciones sin concluir o sin verificar. **Duplicado** exige el
  folio del reporte original (queda como "Duplicado de RSM-…") y **No requiere
  atención** exige el motivo. El sistema nunca cierra reportes por sí solo.

## Análisis

- **Comparación entre periodos**: periodo seleccionado frente al anterior de
  igual duración o al mismo periodo del año anterior. Sin periodo, compara el
  último mes con reportes contra el mes previo.
- **SPI**: métricas calculadas con los registros (recibidos, alto riesgo,
  % cerrados, % cerrados en plazo, tiempo de resolución, % acciones en plazo,
  % acciones efectivas), opcionalmente por categoría. Meta y nivel de alerta
  los define un administrador; **no hay metas precargadas**.
- **Recurrencias**: categorías y lugares con al menos N reportes en una
  ventana de días (configurable; 3 en 90 días por defecto). Los lugares se
  agrupan desde el texto capturado ("cerca de la posición 505" = "Posición
  505") mostrando los textos originales; con el módulo de zonas, por zona.
- **Consistencia de datos**: cuadre de cifras y registros a revisar (estatus
  del registro distinto al último seguimiento, resueltos sin registro de
  resolución, cerrados con acciones abiertas, seguimientos anteriores al
  reporte, sin área responsable, abiertos sin plazo). **Solo informa**: no
  modifica registros.

## Notificaciones

- Eventos: nuevo reporte, asignación de área, actualización, acción asignada,
  acción por verificar, acción reabierta, riesgo evaluado, fecha compromiso.
- Alertas vigentes: vencidos, próximos a vencer, acciones por verificar y
  (para quien evalúa) reportes pendientes de evaluar.
- Cada usuario ve solo lo de su área; supervisión y admin ven lo de supervisión.

## Exportaciones

Desde la vista general, **Exportar → PDF… / Excel (.xlsx)…** abre un diálogo
(`public/js/sms-exportar.js`) para elegir formato, periodo, indicadores,
gráficas, secciones, columnas, orientación del PDF y notas. Los demás filtros
activos siempre se respetan. Catálogo y reglas compartidas por ambos formatos
(columnas, indicadores, variación, observaciones, protección de fórmulas, fechas):
`public/js/sms-exportacion.js` (UMD: navegador, Web Worker y Node).

- **Excel (.xlsx)**: lo arma el servidor (`lib/sms/exportar-excel.js`) en
  `GET /api/sms/exportar.xlsx`. Parámetros opcionales además de los filtros y
  el orden de `/api/sms/reportes`: `titulo`, `indicadores`, `columnas`,
  `contenido` (`comparativo,tablas,detalle,observaciones`) y `notas`; sin
  ellos se exporta todo (vacío = ninguno). Hojas: Resumen ejecutivo, Datos
  generales, Indicadores, Comparativas, Distribuciones e Información de filtros.
  Fechas reales en hora de México, números como números, porcentajes y
  diferencias con fórmula (el libro se recalcula al abrirse), filtro y
  encabezado fijo. Los textos que empiezan con `= + - @` llevan apóstrofo.
  Tope de seguridad: 50,000 filas, y el libro avisa si se alcanza.
- **PDF**: se arma en el navegador con jsPDF + AutoTable (servidos desde
  `node_modules` en `/vendor/…`) dentro de un Web Worker
  (`public/js/sms-pdf-worker.js` → `public/js/sms-pdf.js`), así la página no
  se congela (5,000 filas ≈ 430 páginas en ~2 s). Consulta los mismos
  endpoints que la vista general, con **todas** las páginas del listado; las
  gráficas se dibujan fuera de la pantalla en tema claro y se insertan como PNG.
  Encabezado y pie con «Página X de Y», gráficas y filas sin partir,
  orientación automática según las columnas.
- Las columnas del reportante solo van al Excel y solo para supervisión y
  administración (el servidor lo valida aunque se pidan en la URL).
- `/reportes/ejecutivo` (vista de impresión) y el detalle de cada reporte (Imprimir).
- Cada exportación a Excel queda en la bitácora.

## Pruebas

```bash
npm run test:unit           # riesgo, acciones, filtros, permisos, etapas, semáforo, SPI, lugares
npm test                    # además, integración contra la base de PRUEBAS
```

Las pruebas de integración usan `aifa_rsm_test` (o `DB_NAME_PRUEBAS`) y **se
niegan a ejecutarse contra `aifa_rsm`**. Crean y eliminan sus propios
usuarios y datos, y restauran la configuración. Para preparar la base:

```bash
mysql -uroot -e "CREATE DATABASE aifa_rsm_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysqldump -uroot aifa_rsm | mysql -uroot aifa_rsm_test
DB_NAME=aifa_rsm_test npm run migrar
```

## Archivos principales

```
lib/sms/riesgo.js          matriz 5×5: validación, clasificación, validación institucional
lib/sms/acciones.js        reglas de estado, cierre y vencimiento de acciones
lib/sms/etapas.js          etapas de atención y semáforo de plazos
lib/sms/spi.js             métricas por mes/periodo, SPI, comparativos, recurrencia
lib/sms/lugares.js         agrupación del lugar reportado
lib/sms/zonas.js           módulo opcional de zonas
lib/sms/filtros.js         filtros validados y SQL parametrizado
lib/sms/consultas.js       consulta base (1 fila por reporte), indicadores, análisis (series diarias y por hora), calidad
lib/sms/permisos.js        roles, capacidades y middleware de sesión
lib/sms/notificaciones.js  eventos y alertas vigentes por usuario
lib/sms/auditoria.js       bitácora en logs_sistema
routes/sms.js              API y páginas del módulo
public/js/sms.js           utilidades, semáforo, etapas, globos de ayuda, campana
public/js/sms-graficas.js  gráficas SVG accesibles e interactivas, exportación PNG (sin librerías externas)
public/js/sms-series.js    agrupación por día/semana/mes y flujo acumulado (funciones puras, con pruebas)
public/js/sms-analisis.js  vistas de análisis compartidas (página e informe)
public/css/sms.css         estilos del módulo (claro, oscuro e impresión)
```
