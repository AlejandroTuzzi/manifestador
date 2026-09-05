# Migración multilenguaje de Manifestador

## Objetivo

Ofrecer español e inglés en toda la interfaz sin duplicar lógica, sin traducir contenido del usuario y sin alterar los prompts técnicos que necesitan conservar un idioma determinado para las APIs.

La elección se guarda en `config.json`. Español (`es`) es el idioma base y fallback: una clave faltante nunca debe dejar un control vacío ni impedir que la aplicación arranque.

## Convenciones obligatorias

- Los textos nuevos visibles deben entrar mediante `tr('clave')` o atributos `data-i18n*`.
- Las claves se agrupan por módulo: `assets.*`, `automation.*`, `errors.*`, etc.
- `public/locales/es.js` y `public/locales/en.js` deben tener exactamente las mismas claves.
- No concatenar frases traducidas. Usar variables: `tr('assets.count', { count })`.
- Fechas y números deben pasar por los helpers de `ManifestadorI18n`/`Intl`.
- No traducir nombres, prompts, etiquetas, títulos, proyectos ni descripciones creados por el usuario.
- No traducir identificadores de modelos, códigos de personaje, rutas, nombres de archivo ni términos técnicos oficiales.
- Las instrucciones internas para modelos se revisan por intención; no se pasan automáticamente por el traductor de interfaz.
- Todo texto debe permanecer en UTF-8. No aceptar mojibake en ningún catálogo.

## Estado y lista de tareas

### Orden de ejecución

1. **Núcleo compartido** — completado: navegación, acceso, monitor global, selector de referencias, reproductor, lightbox y tareas largas.
2. **Crear** — completado: estructura, modelos, referencias, validaciones, resultados, historial y herramientas auxiliares usan los catálogos compartidos.
3. **Bibliotecas** — completado: Assets, Personajes, Locaciones/Objetos, Prompts, Vocabulario y Snippets.
4. **Producción** — en curso: Series, guiones, Automatizador y Subtitulador migrados; Poser pendiente.
5. **Administración y cierre** — Consumo migrado; Configuración completa, errores del servidor y QA visual bilingüe pendientes.

### 0. Infraestructura

- [x] Crear motor i18n con fallback, interpolación y atributos traducibles.
- [x] Separar catálogos `es` y `en`.
- [x] Persistir `language` en Configuración.
- [x] Aplicar `lang="es|en"` al documento.
- [x] Añadir helpers para números y fechas según locale.
- [x] Añadir prueba de paridad entre catálogos y claves usadas en HTML.
- [x] Migrar navegación, selector de modos, monitor global, acceso y selector de idioma como prueba vertical.

### 1. Núcleo y componentes compartidos

- [ ] Toasts y confirmaciones comunes.
- [ ] Estados vacíos, cargando, listo, error y progreso.
- [ ] Botones comunes: guardar, cancelar, borrar, editar, descargar, cerrar, volver.
- [x] Lightbox, selector global de referencias y reproductor de Assets.
- [x] Plurales reutilizables para archivos, imágenes, videos, audios, palabras y proyectos.
- [ ] Sustituir comparaciones y formatos fijados a `es-AR` por el locale activo.

### 2. Crear

- [x] Placeholders y herramientas de la caja de prompt.
- [x] Controles de Imagen y mensajes de referencias.
- [x] Controles de Video para Seedance, MiniMax, Gemini Omni y HeyGen.
- [x] Audio, voces y etiquetas expresivas.
- [x] Música y controles de Suno.
- [x] ComfyUI, referencias y valores personalizados.
- [x] Lista de tomas, panel de guion y resultados.
- [x] Historial, regeneración, edición y errores por modelo.

### 3. Bibliotecas

- [x] Assets: pestañas, filtros, clasificación, asociaciones y operaciones masivas.
- [x] Personajes: original, variantes, HeyGen, voces, fotos y exportación.
- [x] Locaciones y objetos: tipos, variantes, fotos y asociaciones.
- [x] Prompts: categorías, Estilos, LoRA, análisis IA e invocación.
- [x] Vocabulario: categorías, fichas, análisis IA, búsqueda y copia.
- [x] Snippets: lenguajes, categorías, visor y editor.

### 4. Series y guiones

- [x] Biblioteca de series y metadatos.
- [x] Editor, importación y generación de guiones.
- [x] Storyboard y asociación de Assets.
- [x] Lectura de guion, navegación de escenas y planos.
- [x] Exportaciones y mensajes de compatibilidad con Controversy Tracker.

### 5. Automatizador

- [x] Biblioteca y configuración general de proyectos.
- [x] Bloques manuales y generadores Imagen, Assets, HeyGen, H3, Seedance y Omni.
- [x] Estilos de título, subtítulos dinámicos y resaltados.
- [x] Música, transiciones, efectos, máscaras y logos.
- [x] Regeneraciones, montajes, limpieza y finalización.
- [x] Monitor de tareas recuperables y mensajes después de F5.
- [x] Confirmaciones destructivas y resúmenes de resultados.

### 6. Subtitulador y Poser

- [x] Proyectos, transcripción, corrección y exportación TXT/SRT.
- [x] Animaciones Remotion, estilos y render final.
- [x] Controles del Poser, huesos, cámaras, escenas y archivos `.pose`.

### 7. Consumo y Configuración

- [x] Resumen, meses, unidades, tarifas y estimaciones de Consumo.
- [x] Todos los campos, ayudas y pruebas de API en Configuración.
- [x] OAuth de HeyGen, Photoshop, FFmpeg, ComfyUI y acceso.
- [x] Controles NSFW y mensajes administrativos.

### 8. Servidor y errores

- [ ] Asignar códigos estables a validaciones y errores esperables.
- [ ] Traducir códigos en el cliente; conservar el mensaje original como fallback y diagnóstico.
- [ ] Separar errores mostrables de logs técnicos de proveedores.
- [ ] Localizar nombres de unidades y estados devueltos por la API.
- [ ] Revisar mensajes de trabajos en segundo plano y recuperación de automatizaciones.

### 9. Calidad y cierre

- [x] Prueba automática que detecte claves faltantes en ambos catálogos y en sus usos literales actuales.
- [ ] Prueba que busque textos visibles sin migrar en HTML y renderizadores JS.
- [ ] Prueba de UTF-8/mojibake para HTML, JS, JSON y Markdown.
- [ ] Recorrido manual completo en español.
- [ ] Recorrido manual completo en inglés.
- [ ] Revisar desbordes a 1920, 1366, 1024 y móvil.
- [ ] Revisar `title`, `placeholder`, `aria-label`, foco, hover, disabled y errores.
- [ ] Validar que los datos guardados sean idénticos al cambiar de idioma.
- [ ] Validar integración completa con Controversy Tracker en ambos idiomas.

## Definición de terminado por módulo

Un módulo se marca completo sólo cuando no tiene texto visible codificado directamente, posee las mismas claves en español e inglés, respeta pluralización y formatos, pasa pruebas y fue recorrido visualmente en ambos idiomas sin desbordes ni mojibake.
