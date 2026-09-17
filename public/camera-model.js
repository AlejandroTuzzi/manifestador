// English cinematography instructions; UI labels live in the locale catalogs.
export const CAMERA_GROUPS = [
  {
    "id": "shot",
    "videoOnly": false,
    "options": [
      {
        "id": "extremeWide",
        "prompt": "extreme wide shot; the subject appears small within an expansive environment"
      },
      {
        "id": "wide",
        "prompt": "wide shot; show the subject and the surrounding environment"
      },
      {
        "id": "full",
        "prompt": "full-body shot; frame the subject from head to toe without cropping the feet"
      },
      {
        "id": "cowboy",
        "prompt": "cowboy shot; frame the subject from mid-thigh to above the head"
      },
      {
        "id": "medium",
        "prompt": "medium shot; frame the subject from the waist up"
      },
      {
        "id": "mediumClose",
        "prompt": "medium close-up; frame the subject from the chest up"
      },
      {
        "id": "close",
        "prompt": "close-up; frame the face and shoulders"
      },
      {
        "id": "extremeClose",
        "prompt": "extreme close-up; tightly frame the face with minimal surrounding space"
      },
      {
        "id": "detail",
        "prompt": "insert shot; tightly frame the specific object or detail described in the scene"
      },
      {
        "id": "macro",
        "prompt": "extreme macro close-up; reveal fine surface textures of the specified detail"
      }
    ]
  },
  {
    "id": "angle",
    "videoOnly": false,
    "options": [
      {
        "id": "eye",
        "prompt": "eye-level shot; camera at the subject's eye height"
      },
      {
        "id": "high",
        "prompt": "high-angle shot; camera above the subject looking down"
      },
      {
        "id": "low",
        "prompt": "low-angle shot; camera below the subject looking up"
      },
      {
        "id": "overhead",
        "prompt": "overhead top-down shot; camera looking straight down at 90 degrees"
      },
      {
        "id": "worm",
        "prompt": "worm's-eye view; camera at ground level looking almost vertically upward"
      }
    ]
  },
  {
    "id": "view",
    "videoOnly": false,
    "options": [
      {
        "id": "front",
        "prompt": "front view of the subject"
      },
      {
        "id": "threeQuarter",
        "prompt": "three-quarter view of the subject"
      },
      {
        "id": "profile",
        "prompt": "side profile view of the subject"
      },
      {
        "id": "rear",
        "prompt": "rear view; camera behind the subject"
      },
      {
        "id": "shoulder",
        "prompt": "over-the-shoulder shot; a shoulder in the foreground frames the other subject"
      },
      {
        "id": "pov",
        "prompt": "point-of-view shot; show what the viewpoint character sees"
      }
    ]
  },
  {
    "id": "lens",
    "videoOnly": false,
    "options": [
      {
        "id": "ultraWide",
        "prompt": "16mm ultra-wide-angle lens; expansive field of view"
      },
      {
        "id": "wide",
        "prompt": "24mm wide-angle lens; broad field of view"
      },
      {
        "id": "documentary",
        "prompt": "35mm lens; moderately wide field of view"
      },
      {
        "id": "normal",
        "prompt": "50mm standard lens; natural-looking framing"
      },
      {
        "id": "portrait",
        "prompt": "85mm portrait lens; narrow field of view"
      },
      {
        "id": "tele",
        "prompt": "135mm telephoto lens; distant camera position with tight framing"
      },
      {
        "id": "longTele",
        "prompt": "200mm telephoto lens; distant viewpoint and compressed-looking spatial relationships"
      },
      {
        "id": "macro",
        "prompt": "100mm macro lens; close focusing on fine details"
      },
      {
        "id": "fisheye",
        "prompt": "fisheye lens; intentionally curved lines and extreme wide-angle distortion"
      }
    ]
  },
  {
    "id": "depth",
    "videoOnly": false,
    "options": [
      {
        "id": "veryShallow",
        "prompt": "very shallow depth of field; f/1.4 aperture look; keep the focal subject sharp with a heavily defocused background and soft bokeh"
      },
      {
        "id": "shallow",
        "prompt": "shallow depth of field; f/2.8 aperture look; sharply focused subject with a softly blurred background"
      },
      {
        "id": "moderate",
        "prompt": "moderate depth of field; f/5.6 aperture look; sharp subject with gently softened but recognizable surroundings"
      },
      {
        "id": "deep",
        "prompt": "deep depth of field and deep focus; f/11 aperture look; foreground and background remain sharp with minimal background blur"
      }
    ]
  },
  {
    "id": "focus",
    "videoOnly": false,
    "options": [
      {
        "id": "eyes",
        "prompt": "focus precisely on the subject's eyes"
      },
      {
        "id": "subject",
        "prompt": "keep the main subject in sharp focus"
      },
      {
        "id": "detail",
        "prompt": "focus precisely on the specific detail or object described in the scene"
      }
    ]
  },
  {
    "id": "composition",
    "videoOnly": false,
    "options": [
      {
        "id": "center",
        "prompt": "centered composition; subject in the center of the frame"
      },
      {
        "id": "thirds",
        "prompt": "rule-of-thirds composition"
      },
      {
        "id": "symmetry",
        "prompt": "symmetrical composition"
      },
      {
        "id": "negative",
        "prompt": "composition with generous negative space around the subject"
      },
      {
        "id": "dutch",
        "prompt": "Dutch angle; deliberately tilted camera roll and diagonal horizon"
      }
    ]
  },
  {
    "id": "motion",
    "videoOnly": true,
    "options": [
      {
        "id": "static",
        "prompt": "locked-off static camera; no camera movement"
      },
      {
        "id": "push",
        "prompt": "slow dolly-in; camera physically moves toward the subject"
      },
      {
        "id": "pull",
        "prompt": "slow dolly-out; camera physically moves away from the subject"
      },
      {
        "id": "track",
        "prompt": "smooth lateral tracking shot following the subject"
      },
      {
        "id": "pan",
        "prompt": "slow horizontal pan; camera rotates from a fixed position"
      },
      {
        "id": "tilt",
        "prompt": "slow upward camera tilt from a fixed position"
      },
      {
        "id": "orbit",
        "prompt": "smooth camera orbit around the subject"
      },
      {
        "id": "handheld",
        "prompt": "handheld camera with subtle natural movement"
      },
      {
        "id": "zoom",
        "prompt": "slow optical zoom-in from a fixed camera position; no dolly movement"
      }
    ]
  }
];

export function buildCameraPrompt(selection = {}, mode = 'image') {
  return CAMERA_GROUPS.filter(group => !group.videoOnly || mode === 'video')
    .map(group => group.options.find(option => option.id === selection[group.id])?.prompt)
    .filter(Boolean).join(', ');
}

export function prependCameraPrompt(original, selection, mode = 'image') {
  const prefix = buildCameraPrompt(selection, mode);
  return prefix ? prefix + ', ' + original : original;
}

