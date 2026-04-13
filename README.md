# Soundscape Recorder

Herramienta de campo para documentar sesiones de grabación de soundscapes con referencias listas para asociar después a tomas hechas con una Zoom H6.

## Qué hace

- Inicia y cierra sesiones de campo.
- Registra puntos con GPS, fecha, hora y clima automático.
- Detecta el lugar a partir de coordenadas.
- Asocia fotos, notas, tags, características del entorno y referencia de toma.
- Conserva las tomas importadas de Zoom H6 para exportarlas o sincronizarlas después.
- Muestra los puntos en mapa y exporta cada sesión en un paquete ZIP estructurado.
- Publica selecciones web con imagen + audio desde `/api/published-selections`.

## Desarrollo local

**Requisitos:** Node.js

1. Instala dependencias con `npm install`.
2. Copia `.env.example` a `.env.local` sólo si necesitas ajustar variables locales.
3. Arranca el entorno con `npm run dev`.

## Despliegue en Vercel

La app está preparada para desplegarse como frontend estático de Vite.

1. Sube el repositorio a GitHub.
2. Importa el proyecto en Vercel.
3. Verifica estos valores:
   `Framework Preset`: `Vite`
   `Build Command`: `npm run build`
   `Output Directory`: `dist`
   `Node.js`: `22.x`
4. Crea un Blob store en Vercel y comprueba que la variable `BLOB_READ_WRITE_TOKEN` queda asociada al proyecto.
5. Añade una base Neon Postgres al proyecto y comprueba que `DATABASE_URL` queda disponible.
6. Despliega y prueba desde el dominio HTTPS real de Vercel.

## Respaldo en nube

- La app puede respaldar sesiones y fotos en Vercel Blob.
- Las fotos suben con `Client Uploads`, directamente desde el navegador a Blob.
- Las tomas importadas de Zoom H6 también pueden subirse a Blob cuando sincronizas o publicas una selección web.
- Cada cambio local deja la sesión en estado pendiente hasta que se sincroniza.
- Si vuelves a estar online, la app intenta reanudar el respaldo de sesiones pendientes.
- El manifiesto remoto sigue subiendo desde función servidor e incluye metadatos de puntos, tomas Zoom H6 y fotos ya subidas a Blob.
- El catálogo remoto guarda sesiones, puntos, fotos y tomas en Neon Postgres para poder consultarlas después fuera del navegador.
- Para probar el respaldo en local usa el despliegue de Vercel o `vercel dev`; `vite dev` no sirve las rutas `api/*`.

## Selecciones publicadas

- La app puede publicar una selección de `imagen + audio + caption` desde la ficha de un punto.
- Las selecciones publicadas quedan disponibles en `GET /api/published-selections`.
- Puedes filtrar por `sessionId` o `pointId`.
- La respuesta incluye `imageUrl` y `audioUrl`, preparadas para consumir desde otra web.

Ejemplo de consumo:

```ts
const response = await fetch('https://tu-app.vercel.app/api/published-selections');
const selections = await response.json();

for (const item of selections) {
  console.log(item.caption, item.imageUrl, item.audioUrl);
}
```

## Catálogo remoto

- La base remota usa `DATABASE_URL` o `POSTGRES_URL` y está pensada para conectarse a Neon Postgres en Vercel.
- El esquema SQL base está en [db/schema.sql](/Volumes/Nexus/DevProyjects/field-recorder/db/schema.sql).
- Las rutas `api/catalog/session` y `api/catalog/sessions` crean el esquema si no existe y sincronizan una sesión completa.
- La app mantiene `IndexedDB` como caché offline y sincroniza después con Neon cuando vuelve la red.

## Geolocalización en producción

- La geolocalización web sólo funciona en `https` o `localhost`.
- En móvil, el navegador debe tener permiso de ubicación.
- La detección de lugar y el clima automático dependen de conectividad de red.

## Seguridad

- La app no expone claves Gemini en el cliente.
- Si en el futuro añades IA generativa, la clave debe vivir en backend o en una función servidor, nunca en Vite ni en el bundle frontend.
