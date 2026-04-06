# Field Recorder

Herramienta de campo para documentar sesiones de grabación de soundscapes con referencias listas para asociar después a tomas hechas con una Zoom H6.

## Qué hace

- Inicia y cierra sesiones de campo.
- Registra puntos con GPS, fecha, hora y clima automático.
- Detecta el lugar a partir de coordenadas.
- Asocia fotos, notas, tags, características del entorno y referencia de toma.
- Muestra los puntos en mapa y exporta cada sesión en un paquete ZIP estructurado.

## Desarrollo local

**Requisitos:** Node.js

1. Instala dependencias con `npm install`.
2. Copia `.env.example` a `.env.local` sólo si necesitas ajustar variables locales.
3. Arranca el entorno con `npm run dev`.

## Seguridad

- La app no expone claves Gemini en el cliente.
- Si en el futuro añades IA generativa, la clave debe vivir en backend o en una función servidor, nunca en Vite ni en el bundle frontend.
