# Instrucciones permanentes de Manifestador

## Diseño visual

- Todo cambio de interfaz debe respetar el sistema visual global existente de Manifestador.
- La aplicación utiliza un tema oscuro. **Todo elemento nuevo o modificado debe respetarlo sin excepciones**: campos de texto, áreas de texto, selectores, botones, menús, modales, tarjetas, tablas, reproductores, barras de desplazamiento, sliders, inputs de archivo, controles de fecha/color, tooltips y estados de autocompletado.
- No deben quedar controles con fondos blancos, colores claros accidentales ni estilos nativos del navegador que rompan la estética global.
- Antes de añadir CSS nuevo, reutilizar las variables, colores, bordes, tipografía, espaciado y componentes ya definidos en `public/style.css`.
- Verificar todos los estados visibles del componente: normal, foco, hover, activo, deshabilitado, validación y autocompletado.
- Los campos de texto, contraseñas, selectores, áreas de texto, botones y modales nuevos deben integrarse visualmente con los equivalentes existentes.
- Cada ajuste de diseño debe revisarse dentro de su contexto real y no como un elemento aislado.

## Idiomas

- **Toda funcionalidad nueva o modificada debe implementarse simultáneamente en todos los idiomas disponibles en la aplicación.** Una función no se considera terminada si algún texto visible queda disponible solamente en un idioma.
- No escribir directamente en la interfaz etiquetas, ayudas, placeholders, títulos, mensajes vacíos, estados, confirmaciones, notificaciones ni errores. Usar el motor compartido `ManifestadorI18n`, mediante `tr(...)`, `trn(...)` o los atributos `data-i18n*`.
- Mantener paridad exacta entre `public/locales/es.js` y `public/locales/en.js`, incluyendo plurales, interpolaciones y mensajes de error.
- Las respuestas esperables del servidor que se muestren al usuario deben incluir códigos estables traducibles; el mensaje técnico original puede conservarse como diagnóstico o fallback.
- Fechas, números, ordenamientos y unidades visibles deben utilizar el locale activo, nunca un idioma fijado en el código.
- No traducir contenido creado por el usuario, nombres de modelos, IDs, rutas, nombres de archivo ni instrucciones técnicas que una API necesite recibir literalmente.
- Antes de dar una tarea por terminada, ejecutar las pruebas de internacionalización y comprobar que no haya claves ausentes, texto visible sin migrar ni mojibake.
