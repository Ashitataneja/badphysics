import type { GestureName } from '../camera/gestureClassifier';

/** Tiny line-drawn pose glyphs. Shapes, not colour, carry the meaning. */
export function GestureGlyph({ gesture, size = 22 }: { gesture: GestureName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    'aria-hidden': true,
  };
  const palm = <path d="M7 21v-6l-2-4m2 4V5m3 9V3m3 11V4m3 10V6l2 5-3 10" />;
  switch (gesture) {
    case 'GRAB_GRAVITY':
      return (
        <svg {...common}>
          <rect x="6" y="8" width="11" height="10" rx="3" />
          <path d="M9 8v3m3-3v3m3-3v3" />
          <circle cx="11.5" cy="13" r="9.5" strokeDasharray="1.5 2.5" />
        </svg>
      );
    case 'STRETCH_REALITY':
      return (
        <svg {...common}>
          <path d="M2 12h5M17 12h5M7 8v8M17 8v8M9 12h6" />
          <path d="M11 10l-2 2 2 2M13 10l2 2-2 2" />
        </svg>
      );
    case 'TEAR_REALITY':
      return (
        <svg {...common}>
          <path d="M3 18L9 12l2 3 4-6 2 2 4-6" />
          <path d="M14 20h7" strokeDasharray="2 2" />
        </svg>
      );
    case 'REVERSE_GRAVITY':
      return (
        <svg {...common}>
          <rect x="8" y="12" width="8" height="8" rx="2.5" />
          <path d="M12 9V2m-3 3l3-3 3 3" />
        </svg>
      );
    case 'CONDUCT_STORM':
      return (
        <svg {...common}>
          <path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 13c3-3 6 3 9 0s6 3 9 0M5 18c2-2 4 2 6 0" />
        </svg>
      );
    case 'SNAP_UNIVERSE':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2.2" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2" />
        </svg>
      );
    case 'FREEZE_TIME':
      return (
        <svg {...common}>
          {palm}
          <path d="M2 2l20 20" strokeOpacity="0" />
        </svg>
      );
    case 'ERASE_YOURSELF':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 5l18 14" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" strokeDasharray="2 2" />
        </svg>
      );
  }
}
