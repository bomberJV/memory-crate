import { END_STEP, EVENT_STEPS } from './workload-model.js';

const plotInk = ['#414f63', '#9c9c9c', '#5c91bb', '#74bdaa', '#ecb678'];

export function createWorkloadPlot(canvas, seek) {
  const ctx = canvas.getContext('2d');
  let scene;
  let left = 46;
  let right = 18;

  function draw() {
    if (!ctx || !scene || !canvas.clientWidth) return;
    const { profile, original, frame, changed } = scene;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const nextLeft = width < 480 ? 33 : 45;
    const nextRight = width < 480 ? 9 : 17;
    if (left !== nextLeft || right !== nextRight) {
      left = nextLeft;
      right = nextRight;
      canvas.closest('.profile-panel').style.setProperty('--plot-left', left + 'px');
      canvas.closest('.profile-panel').style.setProperty('--plot-right', right + 'px');
    }
    const top = 17;
    const bottom = height - 24;
    const budget = frame.allocation.capacity;
    const maximum = Math.ceil((Math.max(profile.peak.allocation.total, original.peak.allocation.total, budget) + 1) / 4) * 4;
    const x = tick => left + (width - left - right) * tick / END_STEP;
    const y = value => bottom - (bottom - top) * value / maximum;

    function line(x1, y1, x2, y2, color, dash = []) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function edge(points, getHeight, color, dash, weight) {
      ctx.beginPath();
      ctx.lineWidth = weight;
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      points.forEach((p, i) => i ? ctx.lineTo(x(p.step), y(getHeight(p))) : ctx.moveTo(x(p.step), y(getHeight(p))));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let level = 0; level <= maximum; level += 4) {
      const yy = y(level);
      line(left, yy, width - right, yy, '#303d49');
      ctx.fillStyle = '#acb7bc';
      ctx.fillText(String(level), left - 8, yy);
    }
    ctx.textAlign = 'center';
    for (let event = 0; event <= END_STEP / EVENT_STEPS; event++) {
      const xx = x(event * EVENT_STEPS);
      line(xx, top, xx, bottom, '#26323d');
      if (width > 430 || event % 2 === 0) {
        ctx.fillStyle = '#acb7bc';
        ctx.fillText(String(event), xx, bottom + 15);
      }
    }

    const cumulative = profile.points.map(p => {
      const bounds = [0];
      for (const value of [p.allocation.weights, p.allocation.reserve, ...p.requests.map(r => r.cache)]) bounds.push(bounds.at(-1) + value);
      return { px: x(p.step), bounds };
    });
    for (let layer = 0; layer < plotInk.length; layer++) {
      ctx.beginPath();
      cumulative.forEach((p, i) => i ? ctx.lineTo(p.px, y(p.bounds[layer + 1])) : ctx.moveTo(p.px, y(p.bounds[layer + 1])));
      for (let i = cumulative.length - 1; i >= 0; i--) ctx.lineTo(cumulative[i].px, y(cumulative[i].bounds[layer]));
      ctx.closePath();
      ctx.fillStyle = plotInk[layer];
      ctx.fill();
    }
    const points = profile.points;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width - left - right, Math.max(0, y(budget) - top));
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (const p of points) ctx.lineTo(x(p.step), y(p.allocation.total));
    ctx.lineTo(width - right, bottom);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#f28b78';
    ctx.fillRect(left, top, width - left - right, bottom - top);
    for (let pos = -height; pos < width; pos += 7) line(pos, bottom, pos + height, top, '#b9574d');
    ctx.restore();
    if (changed) edge(original.points, p => p.allocation.total, '#e3ddd4', [5, 5], 1.6);
    edge(points, p => p.allocation.total, '#f2eade', [], 1.5);

    const budgetY = y(budget);
    line(left, budgetY, width - right, budgetY, '#ff9886', [6, 3]);
    const label = budget + ' GiB budget';
    ctx.font = '600 11px ui-monospace, monospace';
    const labelWidth = ctx.measureText(label).width;
    ctx.fillStyle = '#27232a';
    ctx.fillRect(left + 4, budgetY - 17, labelWidth + 9, 16);
    ctx.fillStyle = '#ffb5a5';
    ctx.textAlign = 'left';
    ctx.fillText(label, left + 8, budgetY - 9);
    if (frame.allocation.weights > 4) {
      ctx.fillStyle = '#e3e9ed';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Shared weights', left + 10, y(frame.allocation.weights / 2));
    }

    const xx = x(frame.step);
    const yy = y(frame.allocation.total);
    line(xx, top, xx, bottom, '#edf2efbb');
    ctx.beginPath();
    ctx.fillStyle = frame.allocation.fits ? '#d6efdf' : '#ffac93';
    ctx.strokeStyle = '#142028';
    ctx.lineWidth = 2;
    ctx.arc(xx, yy, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  let dragging = false;
  function choosePosition(e) {
    const rect = canvas.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left - left) / (rect.width - left - right)));
    seek(Math.round(fraction * END_STEP));
  }
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    choosePosition(event);
  });
  canvas.addEventListener('pointermove', event => { if (dragging && event.isPrimary) choosePosition(event); });
  canvas.addEventListener('lostpointercapture', () => { dragging = false; });
  window.addEventListener('resize', draw);
  if (typeof ResizeObserver === 'function') new ResizeObserver(draw).observe(canvas);
  return data => { scene = data; draw(); };
}
