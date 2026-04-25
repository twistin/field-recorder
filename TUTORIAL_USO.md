# Tutorial de uso

Guía práctica para probar hoy la app `field-recorder` sin perder tiempo en funciones secundarias.

## 1. Qué hace la app

La app está pensada para documentar salidas de campo de paisaje sonoro:

- crea una `salida` de trabajo
- guarda `registros` o `puntos` con GPS, fecha y hora
- añade fotos del entorno o del setup
- intenta resolver lugar y clima automáticamente
- permite una clasificación rápida del ambiente con el micro del dispositivo
- importa audios de una Zoom H6 y los asocia a los puntos
- exporta resultados en CSV, KML y ZIP
- opcionalmente respalda en nube, sincroniza catálogo remoto y publica selecciones web

Importante: la app no graba el audio definitivo de campo desde el navegador. El audio “real” entra al flujo al importar archivos de la Zoom H6.

## 2. Cómo arrancarla hoy

### Prueba local rápida

Si sólo quieres probar el flujo principal de sesiones, puntos, fotos, GPS e importación:

```bash
npm install
npm run dev
```

Luego abre `http://localhost:3000`.

Esto te permite probar:

- navegación
- creación de salidas
- captura de puntos
- fotos
- GPS
- detección de ambiente
- importación Zoom H6
- exportación local

### Prueba con funciones remotas

Si además quieres probar:

- `Respaldar nube`
- `Sincronizar catálogo`
- `Publicar selección`

entonces no te basta con `vite dev`. Necesitas servir también las rutas `api/*`.

Flujo recomendado:

1. Copia `.env.example` a `.env.local`.
2. Configura `BLOB_READ_WRITE_TOKEN`.
3. Configura `DATABASE_URL` o `POSTGRES_URL`.
4. Arranca con `vercel dev` en lugar de `npm run dev`.

Sin eso, la app funciona bien para captura y exportación local, pero no para las operaciones remotas.

## 3. Permisos que debes aceptar

Para una prueba realista, concede estos permisos al navegador:

- ubicación: para GPS y resolución automática del lugar
- micrófono: para `DETECTAR AMBIENTE`
- cámara o galería: para añadir fotos

Notas:

- la geolocalización web funciona en `localhost` o en `https`
- en móvil, si niegas GPS al principio, tendrás que pulsar `Activar GPS`

## 4. Cómo está organizada la app

La navegación principal tiene cuatro áreas:

- `Resumen`: vista general de la salida activa, trabajo reciente y media reciente
- `Salidas`: crear una nueva salida, abrir sesiones existentes, importar Zoom H6 y ver pendientes
- `Captura`: registrar puntos nuevos con GPS, fotos, notas e IA sonora
- `Proyectos`: archivo de sesiones, biblioteca y ficha completa de cada registro

## 5. Flujo recomendado para probarla hoy

## Paso 1. Crear una salida

En `Salidas`:

1. Escribe `Nombre de la salida`.
2. Rellena `Trabajo` si quieres agrupar varias salidas bajo un mismo proyecto.
3. Añade `Zona / región`.
4. Revisa `Preset de equipo`.
5. Pulsa `Iniciar salida`.

Al crearla, la app te lleva a `Captura`.

## Paso 2. Preparar un registro en Captura

En `Captura` verás:

- estado del GPS
- estado del clima
- lugar detectado
- acciones rápidas
- formulario mínimo del punto

Botones clave:

- `Activar GPS`: pide o refresca la posición
- `Releer ubicación`: reintenta resolver el lugar desde coordenadas
- `Actualizar clima`: consulta clima automático
- `DETECTAR AMBIENTE`: escucha 15 segundos y etiqueta el ambiente
- `Añadir foto`: adjunta una o varias fotos

Importante: `DETECTAR AMBIENTE` no guarda audio. Sólo genera una clasificación aproximada con etiquetas como voces, agua, tráfico, pájaros, etc.

## Paso 3. Guardar un registro rápido

Si quieres ir deprisa, usa `Guardar registro rápido`.

Ese flujo intenta guardar el punto con:

- coordenadas
- fecha y hora
- clima automático
- lugar detectado
- fotos ya añadidas
- clasificación sonora ya calculada, si la lanzaste antes

Úsalo cuando estés en marcha y no quieras rellenar mucho.

## Paso 4. Guardar un registro completo

Si quieres más control, rellena:

- `Nombre del lugar`
- `Hábitat / entorno`
- `ID / referencia Zoom H6`
- `Notas`

y pulsa `Guardar registro completo`.

Si abres `Campos avanzados`, puedes además ajustar:

- `Clima observado`
- `Etiquetas manuales`
- `Características del paisaje`
- `Latitud`
- `Longitud`
- `Setup de micros`

Consejo importante: rellena `ID / referencia Zoom H6` si ya sabes qué toma corresponderá. Eso mejora mucho la autoasignación al importar audios.

## Paso 5. Repetir varios puntos

Haz al menos 3 registros para probar bien:

1. uno con GPS y clima automáticos
2. uno con foto
3. uno con referencia H6 escrita manualmente

Así podrás comprobar mejor mapa, biblioteca, asociaciones y exportación.

## Paso 6. Importar audios de Zoom H6

Puedes importar desde `Salidas` o desde `Proyectos`, usando `Importar Zoom H6`.

Qué hace realmente:

- abre un selector de archivos
- acepta audio compatible
- crea fichas internas para cada toma
- intenta asociarlas a puntos ya creados

Formatos soportados:

- `.wav`
- `.bwf`
- `.mp3`
- `.m4a`
- `.flac`

La asociación automática sigue este orden:

1. coincidencia por referencia detectada en nombre de archivo y `ID / referencia Zoom H6`
2. coincidencia por hora cercana al punto
3. coincidencia por orden, si encajan cantidades y cronología

Si algo queda mal asociado, en el `Índice de tomas H6` puedes:

- cambiar `Punto asociado`
- pulsar `Autoasignar`
- completar metadatos técnicos y notas de toma

## Paso 7. Cerrar la salida

Cuando acabes, vuelve a `Salidas` y pulsa `Cerrar salida`.

Eso hace que la sesión quede lista para revisión, exportación y archivo.

## Paso 8. Revisar el archivo en Proyectos

En `Proyectos` puedes trabajar en tres niveles:

- `Salida`: lista de registros de esa sesión
- `Biblioteca`: fotos y tomas H6
- `Registro`: ficha completa del punto seleccionado

Desde ahí puedes:

- revisar fotos
- revisar la asociación de audios
- ver GPS, clima, lugar e IA sonora
- exportar el registro
- exportar la sesión completa
- publicar una selección web si tienes backend activo

## Paso 9. Exportar resultados

Desde la ficha de un `Registro` puedes exportar:

- `Exportar CSV`
- `Exportar KML`

Desde una sesión puedes exportar:

- `Exportar ZIP`

El ZIP incluye, como mínimo:

- `session.json`
- `session-report.md`
- `indexes/points.csv`
- `indexes/points.geojson`
- `takes/takes.json`
- `takes/takes.csv`
- audios importados disponibles
- fotos de los puntos

Si falta algún audio binario, la exportación puede seguir adelante y añadir `takes/missing-audio.txt`.

## Paso 10. Probar funciones remotas opcionales

Si estás en `vercel dev` o en despliegue real, puedes probar:

- `Respaldar nube`: sube sesión, fotos y audios a Blob
- `Sincronizar catálogo`: manda la sesión al catálogo remoto
- `Publicar selección`: publica una combinación `imagen + audio + caption`

`Publicar selección` exige:

- conexión
- una foto asociada al punto
- una toma H6 asociada al mismo punto

## 6. Prueba mínima recomendada de 15 minutos

Si hoy sólo quieres validar lo esencial, haz esto:

1. Arranca con `npm run dev`.
2. Crea una salida.
3. En `Captura`, pulsa `Activar GPS`.
4. Añade una foto.
5. Pulsa `DETECTAR AMBIENTE`.
6. Guarda un `registro completo` con referencia H6.
7. Crea un segundo punto con `Guardar registro rápido`.
8. Importa 2 o 3 audios de la Zoom H6.
9. Revisa asociaciones en `Proyectos`.
10. Exporta un CSV, un KML y un ZIP.

Con eso ya validas el núcleo real del producto.

## 7. Qué conviene vigilar durante la prueba

- si el GPS tarda demasiado o falla en interior
- si el lugar automático tiene sentido
- si el clima automático coincide con la situación real
- si la detección de ambiente devuelve algo razonable
- si las fotos quedan claramente asociadas al punto correcto
- si la importación H6 enlaza bien por referencia u hora
- si la navegación entre `Salidas`, `Captura` y `Proyectos` resulta clara

## 8. Limitaciones y comportamientos a tener en cuenta

- sin red, la app sigue guardando puntos, pero lugar y clima pueden quedar pendientes
- si el almacenamiento local falla, la app avisa y trabaja sólo en memoria
- `vite dev` no sirve las rutas `api/*`
- la detección sonora es local y aproximada
- la calidad de la autoasignación H6 mejora mucho si rellenas bien la referencia del punto

## 9. Recomendación operativa

Para probarla bien hoy:

- usa móvil si quieres validar permisos reales de GPS y cámara
- usa escritorio si quieres revisar archivo, asociaciones y exportaciones con más comodidad
- si tienes audios de Zoom H6 a mano, prueba al menos una importación con referencias bien nombradas

Si quieres, en el siguiente paso te puedo preparar también un checklist de QA corto para ir marcando fallos mientras la pruebas.
