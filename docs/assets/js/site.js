/* ===== HELPERS ===== */
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.remove('opacity-0', 'translate-y-4');
  t.classList.add('opacity-100', 'translate-y-0');
  setTimeout(() => { t.classList.add('opacity-0', 'translate-y-4'); t.classList.remove('opacity-100', 'translate-y-0'); }, 2500);
}

/* ===== SPARKLINES ===== */
function renderSparklines() {
  ['spark1', 'spark2'].forEach(id => {
    const el = document.getElementById(id);
    const color = id === 'spark1' ? 'primary-container' : 'secondary';
    const count = 20;
    let html = '';
    for (let i = 0; i < count; i++) {
      const h = 15 + Math.random() * 85;
      const op = 0.15 + (h / 100) * 0.6;
      html += `<div class="spark-bar bg-${color} w-full rounded-t-sm" style="height:${h}%;opacity:${op}"></div>`;
    }
    el.innerHTML = html;
  });
}

/* ===== WAVE CANVAS ===== */
function initWave() {
  const canvas = document.getElementById('waveCanvas');
  const ctx = canvas.getContext('2d');
  let t = 0;

  function resize() {
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    ctx.clearRect(0, 0, w, h);

    for (let layer = 0; layer < 3; layer++) {
      const amp = 12 + layer * 8;
      const freq = 0.003 + layer * 0.001;
      const speed = 0.015 + layer * 0.008;
      const alpha = 0.15 - layer * 0.04;

      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 2) {
        const y = h - amp - Math.sin(x * freq + t * speed) * amp * 0.6 - Math.sin(x * freq * 1.8 + t * speed * 0.7) * amp * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, h - amp * 2.5, 0, h);
      grad.addColorStop(0, `rgba(0,229,255,${alpha})`);
      grad.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    const spikePositions = [0.2, 0.45, 0.75];
    const spikeColors = ['rgba(0,229,255,0.4)', 'rgba(64,229,108,0.4)', 'rgba(255,180,171,0.4)'];
    spikePositions.forEach((pos, i) => {
      const sx = w * pos;
      const sh = (30 + Math.sin(t * 0.02 + i) * 15);
      ctx.beginPath();
      ctx.moveTo(sx, h);
      ctx.lineTo(sx, h - sh);
      ctx.strokeStyle = spikeColors[i];
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    t++;
    requestAnimationFrame(draw);
  }
  draw();
}

/* ===== BELL CURVE CANVAS ===== */
let currentRisk = 65.5;
let targetRisk = 65.5;

function initBellCurve() {
  const canvas = document.getElementById('bellCanvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  function gauss(x, mu, sigma) {
    return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
  }

  function draw() {
    currentRisk += (targetRisk - currentRisk) * 0.08;

    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 40, r: 20, t: 10, b: 30 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const x = pad.l + (cw / 5) * i;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ch); ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ch / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(137,147,150,0.6)';
    ctx.font = '9px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      ctx.fillText((i * 20) + '%', pad.l + (cw / 5) * i, pad.t + ch + 18);
    }
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      ctx.fillText(((4 - i) * 0.15).toFixed(2), pad.l - 6, pad.t + (ch / 4) * i + 3);
    }

    const mu = 0.3;
    const sigma = 0.12;
    const riskX = pad.l + (currentRisk / 100) * cw;

    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ch);
    for (let px = 0; px <= cw; px++) {
      const riskVal = (px / cw) * 100;
      const normVal = riskVal / 100;
      const y = gauss(normVal, mu, sigma);
      const plotY = pad.t + ch - (y / (gauss(mu, mu, sigma))) * ch * 0.9;
      ctx.lineTo(pad.l + px, plotY);
    }
    ctx.lineTo(pad.l + cw, pad.t + ch);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(pad.l, pad.t, pad.l, pad.t + ch);
    fillGrad.addColorStop(0, 'rgba(0,229,255,0.12)');
    fillGrad.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    ctx.beginPath();
    for (let px = 0; px <= cw; px++) {
      const riskVal = (px / cw) * 100;
      const normVal = riskVal / 100;
      const y = gauss(normVal, mu, sigma);
      const plotY = pad.t + ch - (y / (gauss(mu, mu, sigma))) * ch * 0.9;
      if (px === 0) ctx.moveTo(pad.l + px, plotY);
      else ctx.lineTo(pad.l + px, plotY);
    }
    ctx.strokeStyle = 'rgba(0,229,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const threshX = pad.l + 0.7 * cw;
    ctx.beginPath();
    ctx.moveTo(threshX, pad.t);
    ctx.lineTo(threshX, pad.t + ch);
    ctx.strokeStyle = 'rgba(255,180,171,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ffb4ab';
    ctx.font = 'bold 9px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('70% RISK FLOOR', threshX, pad.t - 2);

    const normRisk = currentRisk / 100;
    const dotY = pad.t + ch - (gauss(normRisk, mu, sigma) / gauss(mu, mu, sigma)) * ch * 0.9;

    ctx.beginPath();
    ctx.moveTo(riskX, dotY + 8);
    ctx.lineTo(riskX, pad.t + ch);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const glowGrad = ctx.createRadialGradient(riskX, dotY, 0, riskX, dotY, 20);
    glowGrad.addColorStop(0, currentRisk > 70 ? 'rgba(255,180,171,0.3)' : 'rgba(255,255,255,0.3)');
    glowGrad.addColorStop(1, 'rgba(255,180,171,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(riskX - 20, dotY - 20, 40, 40);

    ctx.beginPath();
    ctx.arc(riskX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(riskX, dotY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = currentRisk > 70 ? '#ffb4ab' : '#00e5ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    requestAnimationFrame(draw);
  }
  draw();
}

/* ===== SIMULATION LOGIC ===== */
function initSimulation() {
  const rgbSlider = document.getElementById('rgbSlider');
  const tempSlider = document.getElementById('tempSlider');
  const intensitySlider = document.getElementById('intensitySlider');
  const rippleSlider = document.getElementById('rippleSlider');

  function update() {
    const rgbShift = parseFloat(rgbSlider.value);
    const temp = parseFloat(tempSlider.value);
    const intensity = parseFloat(intensitySlider.value);
    const ripple = parseFloat(rippleSlider.value);

    document.getElementById('rgbVal').textContent = `${rgbShift > 0 ? '+' : ''}${rgbShift.toFixed(0)}%`;
    document.getElementById('tempVal').textContent = temp.toFixed(1) + '°C';
    document.getElementById('intensityVal').textContent = intensity.toFixed(0) + '%';
    document.getElementById('rippleVal').textContent = `+${ripple.toFixed(1)}%`;

    rgbSlider.style.setProperty('--val', ((rgbShift + 40) / 80 * 100) + '%');
    tempSlider.style.setProperty('--val', ((temp - 20) / 80 * 100) + '%');
    intensitySlider.style.setProperty('--val', ((intensity - 10) / 90 * 100) + '%');
    rippleSlider.style.setProperty('--val', (ripple / 30 * 100) + '%');

    const rgbFactor = Math.abs(rgbShift) / 40;
    const tempFactor = (temp - 20) / 80;
    const intensityFactor = 1 - ((intensity - 10) / 90);
    const rippleFactor = ripple / 30;
    const risk = Math.min(99.9, (tempFactor * 0.35 + intensityFactor * 0.25 + rippleFactor * 0.25 + rgbFactor * 0.15) * 100);
    targetRisk = risk;

    const approxRulHours = Math.max(0, Math.round(12000 - (risk / 100) * 9500));
    const delta = (risk - 50).toFixed(1);

    document.getElementById('riskPct').innerHTML = risk.toFixed(1) + '<span class="text-lg opacity-50 ml-1">%</span>';
    document.getElementById('estDays').innerHTML = String(approxRulHours) + '<span class="text-lg opacity-50 ml-1">H</span>';

    const riskDeltaEl = document.getElementById('riskDelta');
    if (delta >= 0) {
      riskDeltaEl.innerHTML = '<span class="material-symbols-outlined text-[12px]">trending_up</span>+' + delta + '% FROM BASELINE';
      riskDeltaEl.className = 'font-label-sm text-[10px] text-error/60 mt-1 flex items-center gap-1';
    } else {
      riskDeltaEl.innerHTML = '<span class="material-symbols-outlined text-[12px]">trending_down</span>' + delta + '% FROM BASELINE';
      riskDeltaEl.className = 'font-label-sm text-[10px] text-secondary/60 mt-1 flex items-center gap-1';
    }

    const badge = document.getElementById('riskBadge');
    if (risk > 70) {
      badge.textContent = 'CRITICAL';
      badge.className = 'px-6 py-2 bg-error-container/20 border border-error/40 text-error font-headline-lg rounded-sm shadow-[0_0_15px_rgba(255,180,171,0.2)]';
    } else if (risk > 40) {
      badge.textContent = 'ELEVATED';
      badge.className = 'px-6 py-2 bg-tertiary-container/20 border border-tertiary/40 text-tertiary font-headline-lg rounded-sm shadow-[0_0_15px_rgba(245,205,0,0.2)]';
    } else {
      badge.textContent = 'NOMINAL';
      badge.className = 'px-6 py-2 bg-secondary/10 border border-secondary/40 text-secondary font-headline-lg rounded-sm shadow-[0_0_15px_rgba(64,229,108,0.2)]';
    }

    const base = { r: 248, g: 241, b: 228 };
    const sh = 1 + rgbShift / 100;
    const r = Math.max(0, Math.min(255, Math.round(base.r * sh)));
    const g = Math.max(0, Math.min(255, Math.round(base.g * (1 + rgbShift / 140))));
    const b = Math.max(0, Math.min(255, Math.round(base.b * (1 - rgbShift / 120))));
    document.getElementById('rgbSwatch').style.background = `rgb(${r}, ${g}, ${b})`;
    document.getElementById('ldrBar').style.width = `${Math.max(8, intensity - ripple * 0.8)}%`;
    document.getElementById('rippleBar').style.width = `${Math.min(100, ripple * 3.3)}%`;
    document.getElementById('tempBar').style.width = `${((temp - 20) / 80) * 100}%`;
  }

  rgbSlider.addEventListener('input', update);
  tempSlider.addEventListener('input', update);
  intensitySlider.addEventListener('input', update);
  rippleSlider.addEventListener('input', update);
  update();

  document.getElementById('deployBtn').addEventListener('click', () => {
    addDeployedLedNode();
    setFlowAnimation(true);
    showToast('Configuration deployed: new LED added and live flow activated.');
  });
}

let deployedCount = 0;
function addDeployedLedNode() {
  deployedCount += 1;
  const ledLane = document.getElementById('ledLane');
  if (!ledLane) return;
  const baseLed = ledLane.querySelector('[data-node="led-base"]');
  if (!baseLed) return;

  const ledNode = document.createElement('div');
  ledNode.className = 'glass-panel flow-node px-3 py-2 rounded text-xs uppercase tracking-widest whitespace-nowrap';
  ledNode.textContent = `LED-${String(deployedCount).padStart(2, '0')}`;

  ledLane.insertBefore(ledNode, baseLed.nextSibling);
}

function setFlowAnimation(active) {
  document.querySelectorAll('#dataPathFlow [data-link]').forEach((el) => {
    el.classList.toggle('flowing', active);
  });
  document.querySelectorAll('#dataPathFlow .flow-node').forEach((el) => {
    el.classList.toggle('flowing', active);
  });
}

/* ===== SCROLL REVEAL ===== */
function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

/* ===== NAV ACTIVE STATE ===== */
function initNavTracking() {
  const sections = ['hero', 'parameters', 'architecture', 'simulation', 'team'];
  const navLinks = document.querySelectorAll('#mainNav .nav-link');
  const sideBtns = document.querySelectorAll('.side-btn[data-section]');
  const setActive = (id) => {
    navLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.section === id);
    });
    sideBtns.forEach(btn => {
      const isActive = btn.dataset.section === id;
      if (isActive) {
        btn.classList.remove('text-zinc-500', 'opacity-50');
        btn.classList.add('bg-[#00E5FF]', 'text-black', 'scale-125', 'shadow-[0_0_12px_#00E5FF]');
      } else {
        btn.classList.add('text-zinc-500', 'opacity-50');
        btn.classList.remove('bg-[#00E5FF]', 'text-black', 'scale-125', 'shadow-[0_0_12px_#00E5FF]');
      }
    });
  };

  const updateFromScroll = () => {
    const y = window.scrollY + 160;
    let active = sections[0];
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el && y >= el.offsetTop) active = id;
    });
    setActive(active);
  };

  window.addEventListener('scroll', updateFromScroll, { passive: true });
  window.addEventListener('resize', updateFromScroll);
  updateFromScroll();
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  renderSparklines();
  initWave();
  initBellCurve();
  initSimulation();
  initReveal();
  initNavTracking();
  setFlowAnimation(true);
});
