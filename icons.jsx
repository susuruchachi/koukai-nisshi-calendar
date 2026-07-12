// --- lucide-react の代わりに使う軽量インラインSVGアイコン ---
function makeIcon(paths) {
  return function Icon({ size = 24, color = 'currentColor', style, ...rest }) {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style,
        ...rest,
      },
      paths.map((d, i) => React.createElement('path', { key: i, d }))
    );
  };
}

const ChevronLeft = makeIcon(['M15 18l-6-6 6-6']);
const ChevronRight = makeIcon(['M9 18l6-6-6-6']);
const Plus = makeIcon(['M5 12h14', 'M12 5v14']);
const X = makeIcon(['M18 6L6 18', 'M6 6l12 12']);
const Pencil = makeIcon([
  'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  'M15 5l4 4',
]);
const Trash2 = makeIcon([
  'M3 6h18',
  'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  'M10 11v6',
  'M14 11v6',
]);
const Download = makeIcon(['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14']);
const MapPin = makeIcon([
  'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z',
  'M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
]);
const Anchor = makeIcon([
  'M12 2v2',
  'M12 22V8',
  'M5 12H2a10 10 0 0 0 20 0h-3',
  'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
]);
const Repeat = makeIcon([
  'M17 2l4 4-4 4',
  'M3 11V9a4 4 0 0 1 4-4h14',
  'M7 22l-4-4 4-4',
  'M21 13v2a4 4 0 0 1-4 4H3',
]);
