const fail = (message) => { throw new Error(message); };
const finite = (value, name, max = 100000) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max) fail(`Invalid ${name}`);
  return value;
};
function color(value = '#285d48') {
  if (typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)) {
    return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255).concat(1);
  }
  const parts = Array.isArray(value) ? value : [value?.r, value?.g, value?.b, value?.a ?? 1];
  if (parts.length !== 3 && parts.length !== 4) fail('Color needs RGB or RGBA');
  return [...parts.slice(0, 3), parts[3] ?? 1].map(part => {
    finite(part, 'color', 1);
    if (part < 0) fail('Color must be between 0 and 1');
    return part;
  });
}
export function normalizeSketch(input) {
  if (!input || input.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 160) fail('id must be 1–160 characters');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160) fail('title must be 1–160 characters');
  const coordinates = input.coordinates ?? 'right-handed-y-up';
  if (!['right-handed-y-up', 'unity-left-handed-y-up'].includes(coordinates)) fail('Unsupported coordinates');
  if (!Array.isArray(input.strokes) || input.strokes.length > 1000) fail('At most 1000 strokes allowed');
  let pointCount = 0;
  const strokes = input.strokes.map(stroke => {
    if (!Array.isArray(stroke?.points) || stroke.points.length === 0) fail('Each stroke needs points');
    pointCount += stroke.points.length;
    if (pointCount > 30000) fail('At most 30000 points per sketch');
    const points = stroke.points.map(point => {
      const components = Array.isArray(point) ? point : [point?.x, point?.y, point?.z];
      if (components.length !== 3) fail('Points need x, y, z');
      return components.map(part => finite(part, 'point'));
    });
    const width = finite(stroke.width ?? 0.01, 'width', 100);
    if (width < 0) fail('Width cannot be negative');
    const widths = stroke.widths ?? points.map(() => width);
    if (!Array.isArray(widths) || widths.length !== points.length) fail('widths must match points');
    widths.forEach(value => { finite(value, 'width', 100); if (value < 0) fail('Width cannot be negative'); });
    const baseColor = color(stroke.color);
    const colors = stroke.colors == null ? null : stroke.colors.map(value => color(value));
    if (colors && colors.length !== points.length) fail('colors must match points');
    return { points, widths: [...widths], color: baseColor, colors, loop: stroke.loop === true };
  });
  return { schemaVersion: 1, id: input.id, title: input.title.trim(), coordinates,
    source: input.source === 'sample' ? 'sample' : 'headset', strokes, pointCount };
}
