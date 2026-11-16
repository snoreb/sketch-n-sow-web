import { SketchViewer, thumbnail } from './viewer.js';
import { sampleSketch } from './samples.js';

const grid = document.querySelector('#grid');
const notice = document.querySelector('#notice');
const dialog = document.querySelector('#inspector');
const connection = document.querySelector('#connection');
const addButton = document.querySelector('#add-sample');
const ideas = new Map();
let viewer, selectedId, sampleIndex = 0;
const reportViewer = message => window.dispatchEvent(new CustomEvent('sketch-viewer-status', { detail: message }));

function openIdea(sketch) {
  selectedId = sketch.id;
  document.querySelector('#idea-title').textContent = sketch.title;
  document.querySelector('#idea-details').textContent = `${sketch.strokes.length} strokes · ${sketch.pointCount.toLocaleString()} points · ${sketch.source === 'sample' ? 'Sample drawing' : 'From your headset'}${sketch.strokes.length ? '' : ' · This package contains no drawing yet.'}`;
  if (!dialog.open) dialog.showModal();
  try {
    viewer ??= new SketchViewer(document.querySelector('#viewport'));
    viewer.show(sketch);
  } catch (error) {
    reportViewer(`3D inspector failed: ${error.message}`);
    document.querySelector('#viewport').textContent = 'The 3D viewer needs WebGL. Try enabling hardware acceleration or opening another browser.';
  }
}
function updateCount() {
  document.querySelector('#count').textContent = ideas.size;
  document.querySelector('#empty').hidden = ideas.size > 0;
}
function upsert(sketch) {
  const existing = ideas.get(sketch.id);
  const card = document.createElement('button');
  card.className = 'card';
  card.setAttribute('aria-label', `Explore ${sketch.title} in 3D`);
  card.innerHTML = '<div class="card-preview"><span class="card-label"></span><canvas aria-hidden="true"></canvas><span class="card-arrow" aria-hidden="true">↗</span></div><div class="card-info"><h3></h3><div class="card-meta"><span class="stroke-count"></span><span class="origin"></span></div></div>';
  card.querySelector('h3').textContent = sketch.title;
  card.querySelector('.card-label').textContent = sketch.source === 'sample' ? 'SAMPLE SEED' : 'HEADSET SEED';
  card.querySelector('.stroke-count').textContent = `${sketch.strokes.length} strokes · 3D sketch`;
  card.querySelector('.origin').textContent = new Date(sketch.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  card.addEventListener('click', () => openIdea(sketch));
  try {
    thumbnail(sketch, card.querySelector('canvas'));
    reportViewer(`Browser received idea ${sketch.id}: ${sketch.pointCount} points. Thumbnail rendered successfully.`);
  }
  catch (error) {
    reportViewer(`Browser received idea ${sketch.id}, but its thumbnail failed: ${error.message}`);
    notice.textContent = 'Sketches received. Enable WebGL to preview them in 3D.';
  }
  if (existing) existing.card.replaceWith(card); else grid.prepend(card);
  ideas.set(sketch.id, { sketch, card });
  if (selectedId === sketch.id && dialog.open) openIdea(sketch);
  updateCount();
}
const stream = new EventSource('/api/events');
stream.onopen = () => { connection.textContent = 'Live session connected'; connection.className = 'connection live'; };
stream.onerror = () => { connection.textContent = 'Reconnecting…'; connection.className = 'connection offline'; };
stream.addEventListener('snapshot', event => {
  const snapshot = JSON.parse(event.data);
  if (dialog.open && !snapshot.some(sketch => sketch.id === selectedId)) dialog.close();
  ideas.clear();
  grid.replaceChildren();
  snapshot.forEach(upsert);
  updateCount();
});
stream.addEventListener('upsert', event => upsert(JSON.parse(event.data)));
addButton.addEventListener('click', async () => {
  addButton.disabled = true;
  notice.textContent = '';
  try {
    const response = await fetch('/api/sketches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sampleSketch(sampleIndex)) });
    if (!response.ok) throw new Error((await response.json()).error);
    sampleIndex++;
    notice.textContent = 'A new idea has been planted.';
  } catch (error) { notice.textContent = `Could not add idea: ${error.message}`; }
  finally { addButton.disabled = false; }
});
document.querySelector('#close').onclick = () => dialog.close();
document.querySelector('#reset').onclick = () => viewer?.reset();
dialog.addEventListener('close', () => { viewer?.clear(); selectedId = null; });
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});
