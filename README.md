# Manifestador ✨

Herramienta **local** para generar imágenes y voz con las APIs de origen de cada modelo, sin pagar interfaces de terceros. Corre en tu máquina, las keys y los archivos quedan en tu disco.

## Cómo arrancar

```
npm start
```

y abrí **http://localhost:7777** (no requiere instalar dependencias, solo Node ≥ 20).

En Windows también podés ejecutar `Manifestador.bat`: inicia el servidor y abre la aplicación.

## Usarlo en varios ordenadores

Cloná el repositorio en cada equipo y actualizalo con `git pull`. Las API keys, la clave de acceso, el historial y los assets no se sincronizan por Git por seguridad; se configuran y conservan localmente en cada ordenador.

## Modelos integrados

| Modelo | Fuente / API | Notas |
|---|---|---|
| Nano Banana Pro | Google Gemini (`gemini-3-pro-image`) | 1K/2K/4K, hasta 14 referencias |
| Nano Banana 2 | Google Gemini (`gemini-3.1-flash-image`) | 1K/2K/4K, hasta 14 referencias |
| Nano Banana 2 Lite | Google Gemini (`gemini-3.1-flash-lite-image`) | rápido y barato, 1K |
| Seedream 5.0 Lite | BytePlus ModelArk | el ID exacto del modelo se ajusta en Configuración |
| Eleven v3 | ElevenLabs | TTS con [corchetes] de expresión |

> Nota: "Seedance" es la línea de **video** de ByteDance; su modelo de imagen es **Seedream**, que es el integrado acá.

## API keys (Configuración → API Keys)

- **Gemini**: https://aistudio.google.com/apikey — usada también por el traductor ES↔EN de la caja de prompts.
- **BytePlus ModelArk (Ark)**: consola de BytePlus → ModelArk → API keys. Verificá en tu consola el ID exacto del modelo Seedream (p. ej. `seedream-5-0-lite-250xxx`) y pegalo en Configuración → Avanzado.
- **fal.ai**: https://fal.ai/dashboard/keys
- **ElevenLabs**: https://elevenlabs.io → perfil → API keys.
- **OpenAI**: https://platform.openai.com/api-keys — solo se usa para el botón "Actualizar precios con OpenAI" (rastrea la web con `web_search` y ajusta las tarifas).

## Qué hace

- **Crear**: caja de prompt con switch Imagen/Audio, traducción ES→EN / EN→ES en la propia caja, proporción/resolución/referencias según lo que tolere cada modelo, lotes de hasta ×4, estimación de costo junto al botón.
- **Referencias**: subí imágenes (quedan en Assets y se reutilizan), o usá cualquier imagen generada, subida o foto de personaje.
- **Historial**: regenerar (mismo envío exacto), editar envío (carga todo en la caja), usar un resultado como referencia.
- **Prompts**: archivá los que uses seguido ("Guardar") y reutilizalos ("Prompts").
- **Personajes**: nombre, descripción, fotos y voz de ElevenLabs. Al **anclar** uno, sus fotos entran como referencia en imágenes y su voz se usa en audio.
- **Audio**: Eleven v3 con paleta de expresiones; los `[corchetes]` se pintan en rosa dentro de la caja para distinguirlos de la voz.
- **Consumo**: cada generación registra su costo estimado; ves el mes actual, el total histórico, el desglose por herramienta y las últimas operaciones. Las tarifas se editan a mano o se actualizan con OpenAI. *Es una estimación, no la factura oficial.*

## Dónde queda todo

- `data/config.json` — keys y rutas (solo en tu máquina).
- `data/history.json`, `data/prompts.json`, `data/characters.json`, `data/ledger.json`, `data/pricing.json`.
- `assets/generated/`, `assets/uploads/`, `assets/audio/` — configurables desde la app (pueden ser rutas absolutas).
