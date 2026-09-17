# Camera prompt builder

The Camera button in Creation opens a local, no-API-cost prompt builder for image,
video and ComfyUI prompts. Movement is only included in video mode. All fields are
optional and single-choice per group. UI labels are translated in ES/EN; generated
instructions stay in English. The preview is exactly the prefix inserted at
position zero, followed by a comma and space, preserving all existing prompt text.
Existing conflicting camera instructions are never silently removed.

## Vocabulary and limitations

Shot size, vertical angle, viewpoint, focal length, depth of field, focus target,
composition and camera movement are separate controls. Descriptive framing is
included alongside terms such as close-up or cowboy shot to reduce ambiguity.
Focal length is not a blur control. Depth of field depends on aperture, focal length,
subject distance and sensor/scene geometry. The preset f-stops describe a desired
look, not physically enforced camera settings. Perspective depends on viewpoint;
telephoto presets explicitly describe a distant viewpoint rather than implying
that focal length alone changes perspective. No fixed combination guarantees model
compliance; source references and provider behavior can override framing.

Sources reviewed on 2026-09-16:

- Google Cloud, cinematography and lens/focus prompting vocabulary:
  https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
- Runway, camera shots, angles and motion:
  https://runway.com/resources/ai-camera-prompts
- Nikon, aperture and depth of field:
  https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/what-is-aperture

Catalog: public/camera-model.js. UI: public/camera.js. Regression tests:
test/camera.test.js. Add ES/EN labels when extending the catalog. Do not promise
universal keyword effectiveness or charge an API request to compose this prefix.
