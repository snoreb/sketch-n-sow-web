const curve = (count, fn) => Array.from({ length: count }, (_, index) => fn(index / (count - 1)));
const stroke = (points, color, width = 0.025) => ({ points, color, width });
const circle = (radius, height) => curve(65, value => [Math.cos(value * Math.PI * 2) * radius, height, Math.sin(value * Math.PI * 2) * radius]);
export function sampleSketch(index) {
  const kind = index % 3;
  let title, strokes;
  if (kind === 0) {
    title = 'A place to grow';
    strokes = [stroke(curve(40, value => [Math.sin(value * 2) * 0.1, value * 1.2 - 0.7, 0]), '#47794d', 0.035)];
    for (const direction of [-1, 1]) strokes.push(stroke(curve(50, value => [direction * Math.sin(value * Math.PI) * 0.5, value * 0.65 - 0.4, Math.sin(value * Math.PI * 2) * 0.13]), '#749258', 0.025));
    for (let petal = 0; petal < 6; petal++) {
      const angle = petal * Math.PI / 3;
      strokes.push(stroke(curve(40, value => {
        const radius = Math.sin(value * Math.PI) * 0.36;
        return [0.09 + Math.cos(angle + Math.sin(value * Math.PI * 2) * 0.45) * radius, 0.5 + Math.sin(angle + Math.sin(value * Math.PI * 2) * 0.45) * radius, Math.sin(value * Math.PI) * 0.12];
      }), '#ce8b50', 0.028));
    }
  } else if (kind === 1) {
    title = 'The gathering pavilion';
    strokes = [stroke(circle(0.8, -0.6), '#b47a4e'), stroke(circle(0.8, 0.2), '#b47a4e')];
    for (let pillar = 0; pillar < 6; pillar++) {
      const angle = pillar * Math.PI / 3;
      const base = [Math.cos(angle) * 0.8, -0.6, Math.sin(angle) * 0.8];
      strokes.push(stroke([base, [base[0], 0.2, base[2]], [0, 0.9, 0]], '#b47a4e', 0.03));
    }
  } else {
    title = 'A new way around';
    strokes = [stroke(curve(180, value => { const angle = value * Math.PI * 4; return [Math.sin(angle) * 0.65, value * 1.6 - 0.8, Math.cos(angle) * 0.65]; }), '#567f86')];
    strokes[0].widths = strokes[0].points.map((_, pointIndex) => 0.012 + Math.sin(pointIndex / 179 * Math.PI) * 0.055);
    strokes.push(stroke(circle(0.85, -0.82), '#9caca1', 0.018));
  }
  return { schemaVersion: 1, id: crypto.randomUUID?.() ?? `sample-${Date.now()}-${Math.random()}`, title, coordinates: 'right-handed-y-up', source: 'sample', strokes };
}
