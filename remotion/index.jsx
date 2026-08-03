import React from 'react';
import {
  AbsoluteFill,
  Composition,
  Easing,
  interpolate,
  registerRoot,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

const transformText = (text, mode) => {
  if (mode === 'uppercase') return text.toLocaleUpperCase();
  if (mode === 'lowercase') return text.toLocaleLowerCase();
  if (mode === 'capitalize') return text.replace(/(^|\s)(\p{L})/gu, (_, space, letter) => `${space}${letter.toLocaleUpperCase()}`);
  return text;
};

const decoration = (style) => [
  style?.underline ? 'underline' : '',
  style?.strikeThrough ? 'line-through' : ''
].filter(Boolean).join(' ') || 'none';

const textStyle = (style = {}) => ({
  color: style.color || '#ffffff',
  fontFamily: style.fontFamily || 'Arial, sans-serif',
  fontSize: Math.max(8, Number(style.fontSizePx) || 64),
  fontWeight: Number(style.fontWeight) || 700,
  fontStyle: style.italic ? 'italic' : 'normal',
  textDecoration: decoration(style),
  WebkitTextStroke: `${Math.max(0, Number(style.strokeWidthPx) || 0)}px ${style.strokeColor || '#000000'}`,
  paintOrder: 'stroke fill',
  textShadow: style.shadow === false ? 'none' : '0 3px 12px rgba(0,0,0,.72)'
});

const FontFaces = ({faces = []}) => {
  if (!faces.length) return null;
  const css = faces.map((face) => `@font-face{font-family:"${face.family}";src:url("${face.dataUrl}") format("${face.format || 'truetype'}");font-display:block;}`).join('\n');
  return <style>{css}</style>;
};

const AnimatedTitle = ({title}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!title?.enabled || !title.text) return null;
  const startFrame = Math.max(0, Math.round((title.start || 0) * fps));
  const localFrame = frame - startFrame;
  const durationFrames = Math.max(1, Math.round((title.duration || 3) * fps));
  if (localFrame < 0 || localFrame > durationFrames) return null;
  const enter = spring({frame: localFrame, fps, config: {damping: 13, stiffness: 155, mass: .72}});
  const fadeOut = interpolate(localFrame, [durationFrames - Math.min(10, durationFrames / 3), durationFrames], [1, 0], clamp);
  const animation = title.animation || 'rise';
  const rawText = transformText(String(title.text), title.style?.textTransform);
  const typedLength = Math.round(interpolate(localFrame, [0, Math.min(durationFrames * .7, fps * 1.4)], [0, rawText.length], {...clamp, easing: Easing.out(Easing.cubic)}));
  const displayText = animation === 'typewriter' ? rawText.slice(0, typedLength) : rawText;
  const translateY = animation === 'rise' ? interpolate(enter, [0, 1], [70, 0]) : 0;
  const rotation = animation === 'slam' ? interpolate(enter, [0, 1], [-4, 0]) : 0;
  const scale = animation === 'slam'
    ? interpolate(enter, [0, 1], [1.55, 1])
    : interpolate(enter, [0, 1], [.88, 1]);
  const alignShift = title.align === 'left' ? '0%' : title.align === 'right' ? '-100%' : '-50%';
  return (
    <div style={{
      position: 'absolute', left: `${title.x ?? 50}%`, top: `${title.y ?? 14}%`,
      width: `${title.maxWidthPct || 88}%`, textAlign: title.align || 'center',
      transform: `translate(${alignShift}, -50%) translateY(${translateY}px) rotate(${rotation}deg) scale(${scale})`,
      transformOrigin: title.align === 'left' ? 'left center' : title.align === 'right' ? 'right center' : 'center',
      opacity: enter * fadeOut,
      padding: title.style?.background ? '10px 18px' : 0,
      background: title.style?.background ? title.style.backgroundColor || 'rgba(0,0,0,.45)' : 'transparent',
      borderRadius: title.style?.background ? 10 : 0,
      lineHeight: 1.04,
      ...textStyle(title.style)
    }}>
      {displayText}{animation === 'typewriter' && typedLength < rawText.length ? <span style={{opacity: frame % 12 < 7 ? 1 : 0}}>|</span> : null}
    </div>
  );
};

const AnimatedCaptions = ({captions}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = Array.isArray(captions?.words) ? captions.words : [];
  if (!captions?.enabled || !words.length) return null;
  const time = frame / fps;
  let activeIndex = words.findIndex((word) => time >= word.start && time < word.end);
  if (activeIndex < 0) {
    for (let index = words.length - 1; index >= 0; index--) {
      if (time >= words[index].end && time - words[index].end < .22) {
        activeIndex = index;
        break;
      }
    }
  }
  if (activeIndex < 0) return null;
  const perPage = Math.max(1, Math.min(12, Number(captions.wordsPerPage) || 5));
  const pageStart = Math.floor(activeIndex / perPage) * perPage;
  const page = words.slice(pageStart, pageStart + perPage);
  const first = page[0];
  const last = page[page.length - 1];
  if (time < first.start - .12 || time > last.end + .24) return null;
  const pageFrame = frame - Math.max(0, Math.floor((first.start - .08) * fps));
  const pageEnter = spring({frame: pageFrame, fps, config: {damping: 16, stiffness: 190, mass: .58}});
  const alignShift = captions.align === 'left' ? '0%' : captions.align === 'right' ? '-100%' : '-50%';
  // El gap en `em` del contenedor tomaba los 16 px predeterminados del navegador,
  // no el tamaño real de los subtítulos. Además, el pop usa transform y no ocupa
  // espacio de layout. Esta reserva proporcional mantiene separadas las palabras
  // incluso durante el fotograma de mayor escala.
  const captionFontSize = Math.max(
    8,
    Number(captions.style?.fontSizePx) || 0,
    Number(captions.activeStyle?.fontSizePx) || 0
  );
  const wordGapPx = Math.max(8, captionFontSize * .38);
  const lineGapPx = Math.max(4, captionFontSize * .12);
  return (
    <div style={{
      position: 'absolute', left: `${captions.x ?? 50}%`, top: `${captions.y ?? 72}%`,
      width: `${captions.maxWidthPct || 88}%`, display: 'flex', flexWrap: 'wrap',
      justifyContent: captions.align === 'left' ? 'flex-start' : captions.align === 'right' ? 'flex-end' : 'center',
      alignItems: 'baseline', columnGap: `${wordGapPx}px`, rowGap: `${lineGapPx}px`,
      textAlign: captions.align || 'center', lineHeight: 1.12,
      transform: `translate(${alignShift}, -50%) translateY(${interpolate(pageEnter, [0, 1], [26, 0])}px)`,
      opacity: pageEnter,
      padding: captions.background ? '10px 16px' : 0,
      background: captions.background ? captions.backgroundColor || 'rgba(0,0,0,.45)' : 'transparent',
      borderRadius: captions.background ? 10 : 0
    }}>
      {page.map((word, pageIndex) => {
        const index = pageStart + pageIndex;
        const active = index === activeIndex;
        const localWordFrame = frame - Math.floor(word.start * fps);
        const wordEnter = spring({frame: localWordFrame, fps, config: {damping: 11, stiffness: 240, mass: .42}});
        const animation = captions.animation || 'word-pop';
        const activeScale = active && animation === 'word-pop' ? interpolate(wordEnter, [0, 1], [1.42, 1.1]) : active ? 1.06 : 1;
        const bounce = active && animation === 'bounce' ? interpolate(wordEnter, [0, .55, 1], [18, -9, 0]) : 0;
        const style = active ? captions.activeStyle : captions.style;
        return (
          <span key={`${index}-${word.start}`} style={{
            display: 'inline-block',
            opacity: active || time >= word.start ? 1 : .62,
            transform: `translateY(${bounce}px) scale(${activeScale})`,
            transformOrigin: 'center bottom',
            transition: 'none',
            ...textStyle(style)
          }}>
            {transformText(word.text, style?.textTransform)}
          </span>
        );
      })}
    </div>
  );
};

const DynamicTextOverlay = (props) => (
  <AbsoluteFill style={{backgroundColor: 'transparent', overflow: 'hidden'}}>
    <FontFaces faces={props.fontFaces} />
    <AnimatedTitle title={props.title} />
    <AnimatedCaptions captions={props.captions} />
  </AbsoluteFill>
);

const Root = () => (
  <Composition
    id="ManifestadorDynamicText"
    component={DynamicTextOverlay}
    width={1080}
    height={1920}
    fps={25}
    durationInFrames={250}
    defaultProps={{durationSeconds: 10, width: 1080, height: 1920, fontFaces: [], title: {}, captions: {words: []}}}
    calculateMetadata={({props}) => {
      const fps = Math.max(1, Math.min(60, Number(props.fps) || 25));
      return {
        fps,
        width: Math.max(2, Math.round(Number(props.width) || 1080)),
        height: Math.max(2, Math.round(Number(props.height) || 1920)),
        durationInFrames: Math.max(1, Math.ceil((Number(props.durationSeconds) || 1) * fps)),
        defaultCodec: 'vp8',
        defaultVideoImageFormat: 'png',
        defaultPixelFormat: 'yuva420p'
      };
    }}
  />
);

registerRoot(Root);
