const canvas = document.getElementById("paintCanvas");
const ctx = canvas.getContext("2d");

const colorPicker = document.getElementById("colorPicker");
const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");
const eraserButton = document.getElementById("eraserButton");
const undoButton = document.getElementById("undoButton");
const clearButton = document.getElementById("clearButton");
const saveButton = document.getElementById("saveButton");

const state = {
  drawing: false,
  eraser: false,
  color: colorPicker.value,
  size: Number(sizeSlider.value),
  history: [],
  maxHistory: 30,
  lastX: 0,
  lastY: 0,
};

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const old = document.createElement("canvas");
  old.width = canvas.width;
  old.height = canvas.height;
  const oldCtx = old.getContext("2d");
  oldCtx.drawImage(canvas, 0, 0);

  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (old.width > 0 && old.height > 0) {
    ctx.drawImage(old, 0, 0, old.width / dpr, old.height / dpr);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }
}

function setToolUI() {
  eraserButton.classList.toggle("active", state.eraser);
  sizeValue.textContent = `${state.size}px`;
}

function pushHistory() {
  const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  state.history.push(snapshot);
  if (state.history.length > state.maxHistory) {
    state.history.shift();
  }
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function beginDraw(event) {
  event.preventDefault();
  const p = getPoint(event);
  state.drawing = true;
  state.lastX = p.x;
  state.lastY = p.y;
  pushHistory();
}

function draw(event) {
  if (!state.drawing) return;
  event.preventDefault();
  const p = getPoint(event);
  ctx.strokeStyle = state.color;
  ctx.lineWidth = state.size;
  ctx.globalCompositeOperation = state.eraser ? "destination-out" : "source-over";

  ctx.beginPath();
  ctx.moveTo(state.lastX, state.lastY);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();

  state.lastX = p.x;
  state.lastY = p.y;
}

function endDraw() {
  state.drawing = false;
}

function undo() {
  const snapshot = state.history.pop();
  if (!snapshot) return;
  ctx.putImageData(snapshot, 0, 0);
}

function clearCanvas() {
  pushHistory();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

function savePng() {
  const link = document.createElement("a");
  link.download = `paint-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function initEvents() {
  canvas.addEventListener("pointerdown", beginDraw, { passive: false });
  canvas.addEventListener("pointermove", draw, { passive: false });
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointerleave", endDraw);
  canvas.addEventListener("pointercancel", endDraw);

  colorPicker.addEventListener("change", () => {
    state.color = colorPicker.value;
    state.eraser = false;
    setToolUI();
  });

  sizeSlider.addEventListener("input", () => {
    state.size = Number(sizeSlider.value);
    setToolUI();
  });

  eraserButton.addEventListener("click", () => {
    state.eraser = !state.eraser;
    setToolUI();
  });

  undoButton.addEventListener("click", undo);
  clearButton.addEventListener("click", clearCanvas);
  saveButton.addEventListener("click", savePng);
  window.addEventListener("resize", resizeCanvas);
}

resizeCanvas();
setToolUI();
initEvents();
