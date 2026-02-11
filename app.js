const canvas = document.getElementById('triangleCanvas');
const ctx = canvas.getContext('2d');
const historyCanvas = document.getElementById('historyCanvas');
const hctx = historyCanvas.getContext('2d');

const modeDrawBtn = document.getElementById('modeDraw');
const modeAnglesBtn = document.getElementById('modeAngles');
const resetBtn = document.getElementById('resetBtn');
const computeBtn = document.getElementById('computeBtn');
const angleForm = document.getElementById('angleForm');
const drawInfo = document.getElementById('drawInfo');
const canvasHint = document.getElementById('canvasHint');
const statusValue = document.getElementById('statusValue');
const historyPanel = document.getElementById('historyPanel');
const historyMeta = document.getElementById('historyMeta');

const FIELD_KEYS = ['A', 'B', 'C', 'Aext', 'Bext', 'Cext', 'a', 'b', 'c'];
const EPS = 0.5; // tolerance in degrees

const state = {
  mode: 'draw',
  points: [],
  hover: null,
  currentAngles: null,
  history: {
    exists: false,
    suppressed: false,
    attempt: null,
  },
};

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderCanvas();
}

window.addEventListener('resize', resizeCanvas);

function setMode(mode, options = {}) {
  state.mode = mode;
  modeDrawBtn.classList.toggle('active', mode === 'draw');
  modeAnglesBtn.classList.toggle('active', mode === 'angles');
  angleForm.classList.toggle('hidden', mode === 'draw');
  drawInfo.classList.toggle('hidden', mode !== 'draw');
  canvasHint.textContent = mode === 'draw'
    ? 'Click 3 points to create triangle'
    : 'Angle preview (computed after Compute)';

  if (!options.preserve) {
    if (mode === 'draw') {
      clearAngleInputs();
      state.currentAngles = null;
    } else {
      clearDrawPoints();
      state.currentAngles = null;
    }
    updateResults(makeAllNA('Waiting for input.'));
  }
  renderCanvas();
}

function clearDrawPoints() {
  state.points = [];
  state.hover = null;
}

function clearAngleInputs() {
  document.getElementById('inA').value = '';
  document.getElementById('inB').value = '';
  document.getElementById('inC').value = '';
  document.getElementById('inAext').value = '';
  document.getElementById('inBext').value = '';
  document.getElementById('inCext').value = '';
  document.getElementById('inSideA').value = '';
  document.getElementById('inSideB').value = '';
  document.getElementById('inSideC').value = '';
}

function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top,
  };
}

canvas.addEventListener('click', (evt) => {
  if (state.mode !== 'draw') return;
  if (state.points.length >= 3) return;
  state.points.push(getCanvasPos(evt));
  renderCanvas();
});

canvas.addEventListener('mousemove', (evt) => {
  if (state.mode !== 'draw') return;
  state.hover = getCanvasPos(evt);
  renderCanvas();
});

canvas.addEventListener('mouseleave', () => {
  if (state.mode !== 'draw') return;
  state.hover = null;
  renderCanvas();
});

modeDrawBtn.addEventListener('click', () => setMode('draw'));
modeAnglesBtn.addEventListener('click', () => setMode('angles'));

resetBtn.addEventListener('click', () => {
  if (state.mode === 'draw') {
    clearDrawPoints();
    state.currentAngles = null;
    updateResults(makeAllNA('Waiting for 3 points on the canvas.'));
  } else {
    clearAngleInputs();
    state.currentAngles = null;
    updateResults(makeAllNA('Waiting for input.'));
  }
  renderCanvas();
});

computeBtn.addEventListener('click', () => {
  compute(true);
});

historyPanel.addEventListener('click', () => {
  if (!state.history.exists) return;
  applyHistory();
});

function compute(updateHistory = true) {
  let result;
  let inputsSnapshot = null;
  let pointsSnapshot = null;

  if (state.mode === 'draw') {
    result = solveFromPoints(state.points);
    pointsSnapshot = state.points.map((p) => ({ x: p.x, y: p.y }));
  } else {
    const inputs = readAngleInputs();
    result = solveFromAngles(inputs);
    inputsSnapshot = inputs;
  }

  state.currentAngles = result.previewAngles || null;
  updateResults(result);

  if (updateHistory) {
    const attempt = {
      mode: state.mode,
      inputs: inputsSnapshot,
      points: pointsSnapshot,
      results: result,
      previewAngles: result.previewAngles || null,
    };
    updateHistoryPanel(attempt);
  }

  renderCanvas();
}

function applyHistory() {
  const attempt = state.history.attempt;
  if (!attempt) return;

  state.history.suppressed = true;

  if (attempt.mode === 'draw') {
    setMode('draw', { preserve: true });
    state.points = attempt.points ? attempt.points.map((p) => ({ ...p })) : [];
  } else {
    setMode('angles', { preserve: true });
    fillAngleInputs(attempt.inputs || {});
  }

  compute(false);
  renderHistory();
}

function updateHistoryPanel(attempt) {
  state.history.exists = true;
  state.history.suppressed = false;
  state.history.attempt = attempt;
  renderHistory();
}

function renderHistory() {
  if (!state.history.exists || !state.history.attempt) {
    historyPanel.classList.add('empty');
    historyPanel.title = 'History is empty';
    historyMeta.textContent = 'Empty';
    drawHistoryPlaceholder();
    setHistoryValues(makeAllNA('No history yet.'), true);
    return;
  }

  historyPanel.classList.remove('empty');
  historyPanel.title = 'Click to restore the last attempt';

  const attempt = state.history.attempt;
  historyMeta.textContent = `Last: ${attempt.mode === 'draw' ? 'Draw' : 'Angles'}`;

  if (attempt.previewAngles) {
    drawTriangleFromAngles(hctx, attempt.previewAngles, { labels: false });
  } else {
    drawHistoryPlaceholder();
  }

  if (state.history.suppressed) {
    const suppressed = makeAllNA('History used as current input.');
    setHistoryValues(suppressed, false);
  } else {
    setHistoryValues(attempt.results, false);
  }
}

function setHistoryValues(result, forceNA) {
  const cells = document.querySelectorAll('[data-history-field]');
  cells.forEach((cell) => {
    const key = cell.getAttribute('data-history-field');
    const field = result.fields[key];
    if (!field || forceNA) {
      cell.textContent = 'N.A.';
      cell.className = 'h-value na';
      cell.title = 'N.A.';
      return;
    }
    if (field.status === 'value') {
      cell.textContent = formatValue(field.value);
      cell.className = 'h-value';
      cell.title = '';
    } else if (field.status === 'bad') {
      cell.textContent = 'Bad value';
      cell.className = 'h-value bad';
      cell.title = field.reason || 'Bad value';
    } else {
      cell.textContent = 'N.A.';
      cell.className = 'h-value na';
      cell.title = field.reason || 'N.A.';
    }
  });
}

function readAngleInputs() {
  return {
    A: parseNumber(document.getElementById('inA').value),
    B: parseNumber(document.getElementById('inB').value),
    C: parseNumber(document.getElementById('inC').value),
    Aext: parseNumber(document.getElementById('inAext').value),
    Bext: parseNumber(document.getElementById('inBext').value),
    Cext: parseNumber(document.getElementById('inCext').value),
    a: parseNumber(document.getElementById('inSideA').value),
    b: parseNumber(document.getElementById('inSideB').value),
    c: parseNumber(document.getElementById('inSideC').value),
  };
}

function fillAngleInputs(inputs) {
  document.getElementById('inA').value = valueOrEmpty(inputs.A);
  document.getElementById('inB').value = valueOrEmpty(inputs.B);
  document.getElementById('inC').value = valueOrEmpty(inputs.C);
  document.getElementById('inAext').value = valueOrEmpty(inputs.Aext);
  document.getElementById('inBext').value = valueOrEmpty(inputs.Bext);
  document.getElementById('inCext').value = valueOrEmpty(inputs.Cext);
  document.getElementById('inSideA').value = valueOrEmpty(inputs.a);
  document.getElementById('inSideB').value = valueOrEmpty(inputs.b);
  document.getElementById('inSideC').value = valueOrEmpty(inputs.c);
}

function parseNumber(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function valueOrEmpty(value) {
  return value == null ? '' : value;
}

function formatValue(value) {
  if (value == null || !Number.isFinite(value)) return 'N.A.';
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, '');
}

function makeAllNA(reason) {
  const fields = {};
  FIELD_KEYS.forEach((key) => {
    fields[key] = { status: 'na', value: null, reason };
  });
  return { fields, status: 'N.A.', statusReason: reason, previewAngles: null };
}

function makeAllBad(reason) {
  const fields = {};
  FIELD_KEYS.forEach((key) => {
    fields[key] = { status: 'bad', value: null, reason };
  });
  return { fields, status: 'Bad value', statusReason: reason, previewAngles: null };
}

function updateResults(result) {
  const cells = document.querySelectorAll('[data-field]');
  cells.forEach((cell) => {
    const key = cell.getAttribute('data-field');
    const field = result.fields[key];
    if (!field) return;

    if (field.status === 'value') {
      cell.textContent = formatValue(field.value);
      cell.className = 'value';
      cell.title = '';
    } else if (field.status === 'bad') {
      cell.textContent = 'Bad value';
      cell.className = 'value bad';
      cell.title = field.reason || 'Bad value';
    } else {
      cell.textContent = 'N.A.';
      cell.className = 'value na';
      cell.title = field.reason || 'N.A.';
    }
  });

  statusValue.textContent = result.status;
}

function solveFromPoints(points) {
  if (!points || points.length < 3) {
    return makeAllNA('Waiting for 3 points on the canvas.');
  }

  const [Apt, Bpt, Cpt] = points;
  const area2 = Math.abs((Bpt.x - Apt.x) * (Cpt.y - Apt.y) - (Bpt.y - Apt.y) * (Cpt.x - Apt.x));
  if (area2 < 1e-2) {
    return makeAllBad('Points are collinear (not a valid triangle).');
  }

  const a = dist(Bpt, Cpt);
  const b = dist(Apt, Cpt);
  const c = dist(Apt, Bpt);

  const A = angleAt(Apt, Bpt, Cpt);
  const B = angleAt(Bpt, Apt, Cpt);
  const C = angleAt(Cpt, Apt, Bpt);

  if (!isAngleValid(A) || !isAngleValid(B) || !isAngleValid(C)) {
    return makeAllBad('Triangle angles are invalid.');
  }

  const sum = A + B + C;
  if (Math.abs(sum - 180) > 1.5) {
    return makeAllBad('Angles do not sum to 180 degrees.');
  }

  const fields = {};
  fields.A = { status: 'value', value: A };
  fields.B = { status: 'value', value: B };
  fields.C = { status: 'value', value: C };
  fields.Aext = { status: 'value', value: 180 - A };
  fields.Bext = { status: 'value', value: 180 - B };
  fields.Cext = { status: 'value', value: 180 - C };
  fields.a = { status: 'value', value: a };
  fields.b = { status: 'value', value: b };
  fields.c = { status: 'value', value: c };

  return {
    fields,
    status: 'OK',
    statusReason: '',
    previewAngles: { A, B, C },
  };
}

function solveFromAngles(inputs) {
  const normalized = normalizeAngles(inputs);

  if (normalized.status === 'bad') {
    return makeAllBad(normalized.reason);
  }

  const fields = {};
  FIELD_KEYS.forEach((key) => {
    fields[key] = { status: 'na', value: null, reason: normalized.reason };
  });

  const angles = normalized.angles;

  if (angles.A != null) {
    fields.A = { status: 'value', value: angles.A };
    fields.Aext = { status: 'value', value: 180 - angles.A };
  }
  if (angles.B != null) {
    fields.B = { status: 'value', value: angles.B };
    fields.Bext = { status: 'value', value: 180 - angles.B };
  }
  if (angles.C != null) {
    fields.C = { status: 'value', value: angles.C };
    fields.Cext = { status: 'value', value: 180 - angles.C };
  }

  let previewAngles = null;
  if (normalized.status === 'ok') {
    previewAngles = { ...angles };

    const sideResult = computeSides(inputs, angles);
    if (sideResult.status === 'bad') {
      return makeAllBad(sideResult.reason);
    }

    if (sideResult.status === 'ok') {
      fields.a = { status: 'value', value: sideResult.sides.a };
      fields.b = { status: 'value', value: sideResult.sides.b };
      fields.c = { status: 'value', value: sideResult.sides.c };
    } else {
      fields.a = { status: 'na', value: null, reason: sideResult.reason };
      fields.b = { status: 'na', value: null, reason: sideResult.reason };
      fields.c = { status: 'na', value: null, reason: sideResult.reason };
    }
  } else {
    fields.a = { status: 'na', value: null, reason: normalized.reason };
    fields.b = { status: 'na', value: null, reason: normalized.reason };
    fields.c = { status: 'na', value: null, reason: normalized.reason };
  }

  const anyValue = Object.values(fields).some((field) => field.status === 'value');
  const status = anyValue ? 'OK' : 'N.A.';

  return {
    fields,
    status,
    statusReason: normalized.reason,
    previewAngles,
  };
}

function normalizeAngles(inputs) {
  const angles = { A: null, B: null, C: null };

  const checks = [
    { key: 'A', ext: 'Aext' },
    { key: 'B', ext: 'Bext' },
    { key: 'C', ext: 'Cext' },
  ];

  for (const pair of checks) {
    const interior = inputs[pair.key];
    const exterior = inputs[pair.ext];

    if (interior != null && exterior != null) {
      if (!approxEqual(interior + exterior, 180, EPS)) {
        return { status: 'bad', reason: `Interior and exterior for ${pair.key} do not sum to 180.` };
      }
    }

    let value = interior;
    if (value == null && exterior != null) {
      value = 180 - exterior;
    }

    if (value != null && (!isFinite(value) || value <= 0 || value >= 180)) {
      return { status: 'bad', reason: `Angle ${pair.key} is not valid.` };
    }

    angles[pair.key] = value;
  }

  const known = ['A', 'B', 'C'].filter((k) => angles[k] != null).length;
  const sumKnown = (angles.A || 0) + (angles.B || 0) + (angles.C || 0);

  if (known < 2) {
    return { status: 'na', angles, reason: 'Need at least two angles to solve.' };
  }

  if (known === 2) {
    const missing = 180 - sumKnown;
    if (missing <= 0 || missing >= 180) {
      return { status: 'bad', reason: 'Angles do not form a valid triangle.' };
    }
    if (angles.A == null) angles.A = missing;
    if (angles.B == null) angles.B = missing;
    if (angles.C == null) angles.C = missing;
    return { status: 'ok', angles, reason: '' };
  }

  if (!approxEqual(sumKnown, 180, EPS)) {
    return { status: 'bad', reason: 'Angles do not sum to 180 degrees.' };
  }

  return { status: 'ok', angles, reason: '' };
}

function computeSides(inputs, angles) {
  const sides = { a: inputs.a, b: inputs.b, c: inputs.c };
  const provided = ['a', 'b', 'c'].find((k) => sides[k] != null);

  if (!provided) {
    return { status: 'na', reason: 'Provide one side length to compute sides.' };
  }

  if (sides[provided] <= 0) {
    return { status: 'bad', reason: 'Side length must be greater than zero.' };
  }

  const A = degToRad(angles.A);
  const B = degToRad(angles.B);
  const C = degToRad(angles.C);

  const sinA = Math.sin(A);
  const sinB = Math.sin(B);
  const sinC = Math.sin(C);

  let k = null;
  if (provided === 'a') k = sides.a / sinA;
  if (provided === 'b') k = sides.b / sinB;
  if (provided === 'c') k = sides.c / sinC;

  if (!Number.isFinite(k)) {
    return { status: 'bad', reason: 'Cannot compute side lengths with given values.' };
  }

  return {
    status: 'ok',
    sides: {
      a: k * sinA,
      b: k * sinB,
      c: k * sinC,
    },
  };
}

function dist(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function angleAt(p, p1, p2) {
  const v1 = { x: p1.x - p.x, y: p1.y - p.y };
  const v2 = { x: p2.x - p.x, y: p2.y - p.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const denom = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (denom === 0) return null;
  let cos = dot / denom;
  cos = Math.min(1, Math.max(-1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function isAngleValid(angle) {
  return angle != null && angle > 0 && angle < 180;
}

function approxEqual(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function renderCanvas() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (state.mode === 'draw') {
    drawPointsAndLines();
  } else {
    drawAnglePreview();
  }
}

function drawPointsAndLines() {
  const points = state.points;
  if (points.length > 0) {
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    if (points.length >= 2) {
      drawLine(points[0], points[1]);
    }
    if (points.length >= 3) {
      drawLine(points[1], points[2]);
      drawLine(points[2], points[0]);
    }

    points.forEach((p) => drawPoint(p));
  }

  if (points.length === 1 && state.hover) {
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 1.5;
    drawLine(points[0], state.hover);
    ctx.setLineDash([]);
  }

  if (points.length === 2 && state.hover) {
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 1.5;
    drawLine(points[0], points[1]);
    drawLine(points[1], state.hover);
    drawLine(state.hover, points[0]);
    ctx.setLineDash([]);
  }

  if (points.length === 3 && state.currentAngles) {
    labelAngles(points, state.currentAngles);
  }
}

function drawAnglePreview() {
  if (!state.currentAngles) {
    drawPlaceholderTriangle(ctx, canvas);
    return;
  }

  drawTriangleFromAngles(ctx, state.currentAngles, { labels: true });
}

function drawLine(p1, p2) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

function drawPoint(p) {
  ctx.fillStyle = '#ff2d2d';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

function labelAngles(points, angles) {
  const centroid = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3,
  };
  const labels = ['A', 'B', 'C'];
  const values = [angles.A, angles.B, angles.C];

  ctx.fillStyle = '#ffffff';
  ctx.font = '12px Space Grotesk, Oswald, sans-serif';

  points.forEach((p, i) => {
    const vx = p.x - centroid.x;
    const vy = p.y - centroid.y;
    const len = Math.hypot(vx, vy) || 1;
    const ox = (vx / len) * 16;
    const oy = (vy / len) * 16;
    const text = `${labels[i]} ${formatValue(values[i])} deg`;
    ctx.fillText(text, p.x + ox, p.y + oy);
  });
}

function drawTriangleFromAngles(context, angles, options = {}) {
  const rect = context.canvas.getBoundingClientRect();
  const points = trianglePointsFromAngles(angles, rect.width, rect.height, 20);

  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = '#000';
  context.fillRect(0, 0, rect.width, rect.height);
  context.strokeStyle = '#ff2d2d';
  context.lineWidth = 2;
  context.setLineDash([]);

  drawLineOnContext(context, points[0], points[1]);
  drawLineOnContext(context, points[1], points[2]);
  drawLineOnContext(context, points[2], points[0]);

  if (options.labels) {
    labelAnglesOnContext(context, points, angles);
  }
}

function drawLineOnContext(context, p1, p2) {
  context.beginPath();
  context.moveTo(p1.x, p1.y);
  context.lineTo(p2.x, p2.y);
  context.stroke();
}

function labelAnglesOnContext(context, points, angles) {
  const centroid = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3,
  };
  const labels = ['A', 'B', 'C'];
  const values = [angles.A, angles.B, angles.C];

  context.fillStyle = '#ffffff';
  context.font = '12px Space Grotesk, Oswald, sans-serif';

  points.forEach((p, i) => {
    const vx = p.x - centroid.x;
    const vy = p.y - centroid.y;
    const len = Math.hypot(vx, vy) || 1;
    const ox = (vx / len) * 16;
    const oy = (vy / len) * 16;
    const text = `${labels[i]} ${formatValue(values[i])} deg`;
    context.fillText(text, p.x + ox, p.y + oy);
  });
}

function trianglePointsFromAngles(angles, width, height, margin) {
  const A = degToRad(angles.A);
  const B = degToRad(angles.B);
  const C = degToRad(angles.C);

  const c = 1;
  const a = Math.sin(A) * c / Math.sin(C);
  const b = Math.sin(B) * c / Math.sin(C);

  const x = (b * b + c * c - a * a) / (2 * c);
  const y = Math.sqrt(Math.max(0, b * b - x * x));

  const pts = [
    { x: 0, y: 0 },
    { x: c, y: 0 },
    { x: x, y: y },
  ];

  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;

  const scale = Math.min((width - margin * 2) / w, (height - margin * 2) / h);

  return pts.map((p) => ({
    x: (p.x - minX) * scale + margin,
    y: (p.y - minY) * scale + margin,
  }));
}

function drawPlaceholderTriangle(context, canvasEl) {
  const rect = canvasEl.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const p1 = { x: w * 0.2, y: h * 0.75 };
  const p2 = { x: w * 0.8, y: h * 0.75 };
  const p3 = { x: w * 0.5, y: h * 0.25 };

  context.clearRect(0, 0, w, h);
  context.fillStyle = '#000';
  context.fillRect(0, 0, w, h);
  context.strokeStyle = '#ff2d2d';
  context.lineWidth = 1.5;
  context.setLineDash([6, 6]);

  drawLineOnContext(context, p1, p2);
  drawLineOnContext(context, p2, p3);
  drawLineOnContext(context, p3, p1);
  context.setLineDash([]);
}

function drawHistoryPlaceholder() {
  drawPlaceholderTriangle(hctx, historyCanvas);
}

resizeCanvas();
updateResults(makeAllNA('Waiting for input.'));
renderHistory();
