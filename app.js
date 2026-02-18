const canvas = document.getElementById("paintCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const colorPicker = document.getElementById("colorPicker");
const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");
const undoButton = document.getElementById("undoButton");
const clearButton = document.getElementById("clearButton");
const saveButton = document.getElementById("saveButton");
const copyButton = document.getElementById("copyButton");
const pasteButton = document.getElementById("pasteButton");
const statusText = document.getElementById("statusText");
const strokeModeButton = document.getElementById("strokeModeButton");
const fillModeButton = document.getElementById("fillModeButton");

const toolButtons = Array.from(document.querySelectorAll(".tool-button"));
const swatchButtons = Array.from(document.querySelectorAll(".swatch"));

const TAU = Math.PI * 2;
const SHAPE_TOOLS = new Set(["line", "rect", "circle", "triangle", "star"]);

const state = {
  drawing: false,
  pointerId: null,
  tool: "brush",
  color: colorPicker.value,
  size: Number(sizeSlider.value),
  shapeFill: false,
  history: [],
  maxHistory: 30,
  lastX: 0,
  lastY: 0,
  lastShiftKey: false,
  startX: 0,
  startY: 0,
  previewSnapshot: null,
  statusTimer: null,
  selection: {
    active: false,
    creating: false,
    dragging: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    layer: null,
    baseSnapshot: null,
    offsetX: 0,
    offsetY: 0,
  },
};

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
  if (state.statusTimer) {
    clearTimeout(state.statusTimer);
  }
  state.statusTimer = setTimeout(() => {
    statusText.textContent = "";
    statusText.classList.remove("error");
  }, 2200);
}

function getCanvasScale() {
  const cssWidth = canvas.clientWidth || 1;
  return canvas.width / cssWidth;
}

function normalizeRect(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { x: left, y: top, w: width, h: height };
}

function pointInRect(pointX, pointY, rect) {
  return pointX >= rect.x && pointX <= rect.x + rect.w && pointY >= rect.y && pointY <= rect.y + rect.h;
}

function clearSelectionState() {
  state.selection.active = false;
  state.selection.creating = false;
  state.selection.dragging = false;
  state.selection.x = 0;
  state.selection.y = 0;
  state.selection.w = 0;
  state.selection.h = 0;
  state.selection.layer = null;
  state.selection.baseSnapshot = null;
  state.selection.offsetX = 0;
  state.selection.offsetY = 0;
}

function drawSelectionOutline(x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.restore();
}

function renderFloatingSelection() {
  if (!state.selection.active || !state.selection.baseSnapshot || !state.selection.layer) return;
  ctx.putImageData(state.selection.baseSnapshot, 0, 0);
  ctx.drawImage(state.selection.layer, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
  drawSelectionOutline(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
}

function commitSelectionToCanvas(clearAfter = true) {
  if (!state.selection.active || !state.selection.baseSnapshot || !state.selection.layer) {
    if (clearAfter) clearSelectionState();
    return;
  }
  ctx.putImageData(state.selection.baseSnapshot, 0, 0);
  ctx.drawImage(state.selection.layer, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
  if (clearAfter) {
    clearSelectionState();
  }
}

function resizeCanvas() {
  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }

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

function setTool(tool) {
  if (state.tool !== "select" && tool === "select") {
    // keep current canvas as-is
  }
  if (state.tool === "select" && tool !== "select" && state.selection.active) {
    commitSelectionToCanvas(true);
  }
  state.tool = tool;
  setToolUI();
}

function setShapeFillMode(fill) {
  state.shapeFill = fill;
  setToolUI();
}

function setToolUI() {
  sizeValue.textContent = `${state.size}px`;
  toolButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === state.tool);
  });
  swatchButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.color.toLowerCase() === state.color.toLowerCase());
  });
  strokeModeButton.classList.toggle("active", !state.shapeFill);
  fillModeButton.classList.toggle("active", state.shapeFill);
}

function pushHistory() {
  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }
  try {
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.history.push(snapshot);
    if (state.history.length > state.maxHistory) {
      state.history.shift();
    }
  } catch {
    // ignore memory pressure
  }
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function applyStrokeStyle() {
  ctx.lineWidth = state.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (state.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = state.color;
  }
}

function drawStarPath(cx, cy, outerRadius, innerRadius) {
  const spikes = 5;
  let angle = -Math.PI / 2;
  const step = Math.PI / spikes;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    angle += step;
  }
  ctx.closePath();
}

function paintCurrentPath() {
  if (state.shapeFill) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
}

function constrainPoint(tool, x1, y1, x2, y2, shiftKey) {
  if (!shiftKey) return { x: x2, y: y2 };

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (tool === "line") {
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return { x: x2, y: y2 };
    const snap = Math.PI / 4;
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / snap) * snap;
    return {
      x: x1 + Math.cos(snapped) * length,
      y: y1 + Math.sin(snapped) * length,
    };
  }

  if (tool === "rect" || tool === "circle" || tool === "triangle" || tool === "star") {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: x1 + (dx >= 0 ? side : -side),
      y: y1 + (dy >= 0 ? side : -side),
    };
  }

  return { x: x2, y: y2 };
}

function drawShape(tool, x1, y1, x2, y2) {
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = state.color;
  ctx.fillStyle = state.color;
  ctx.lineWidth = state.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (tool === "line") {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }

  if (tool === "rect") {
    const rect = normalizeRect(x1, y1, x2, y2);
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    paintCurrentPath();
    return;
  }

  if (tool === "circle") {
    const rect = normalizeRect(x1, y1, x2, y2);
    ctx.beginPath();
    ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, TAU);
    paintCurrentPath();
    return;
  }

  if (tool === "triangle") {
    const rect = normalizeRect(x1, y1, x2, y2);
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.w / 2, rect.y);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
    ctx.lineTo(rect.x, rect.y + rect.h);
    ctx.closePath();
    paintCurrentPath();
    return;
  }

  if (tool === "star") {
    const rect = normalizeRect(x1, y1, x2, y2);
    const outer = Math.max(1, Math.min(rect.w, rect.h) / 2);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    drawStarPath(cx, cy, outer, outer * 0.45);
    paintCurrentPath();
  }
}

function createSelectionLayer(rect) {
  const scale = getCanvasScale();
  const sx = Math.round(rect.x * scale);
  const sy = Math.round(rect.y * scale);
  const sw = Math.max(1, Math.round(rect.w * scale));
  const sh = Math.max(1, Math.round(rect.h * scale));
  const imageData = ctx.getImageData(sx, sy, sw, sh);
  const layer = document.createElement("canvas");
  layer.width = sw;
  layer.height = sh;
  layer.getContext("2d").putImageData(imageData, 0, 0);
  return layer;
}

function beginSelectionFromRect(rect) {
  const layer = createSelectionLayer(rect);
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);

  state.selection.active = true;
  state.selection.creating = false;
  state.selection.dragging = false;
  state.selection.x = rect.x;
  state.selection.y = rect.y;
  state.selection.w = rect.w;
  state.selection.h = rect.h;
  state.selection.layer = layer;
  state.selection.baseSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  state.selection.offsetX = 0;
  state.selection.offsetY = 0;

  renderFloatingSelection();
}

function beginDraw(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  const p = getPoint(event);

  state.drawing = true;
  state.pointerId = event.pointerId;
  state.startX = p.x;
  state.startY = p.y;
  state.lastX = p.x;
  state.lastY = p.y;
  state.lastShiftKey = event.shiftKey;
  canvas.setPointerCapture(event.pointerId);

  if (state.tool === "select") {
    if (state.selection.active && pointInRect(p.x, p.y, state.selection)) {
      state.selection.dragging = true;
      state.selection.offsetX = p.x - state.selection.x;
      state.selection.offsetY = p.y - state.selection.y;
      return;
    }

    if (state.selection.active) {
      commitSelectionToCanvas(true);
    }

    pushHistory();
    state.selection.creating = true;
    state.previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return;
  }

  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }

  pushHistory();

  if (SHAPE_TOOLS.has(state.tool)) {
    state.previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return;
  }

  applyStrokeStyle();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + 0.001, p.y + 0.001);
  ctx.stroke();
}

function draw(event) {
  if (!state.drawing || event.pointerId !== state.pointerId) return;
  event.preventDefault();
  const p = getPoint(event);
  const prevX = state.lastX;
  const prevY = state.lastY;
  state.lastShiftKey = event.shiftKey;

  if (state.tool === "select") {
    if (state.selection.creating) {
      if (!state.previewSnapshot) return;
      ctx.putImageData(state.previewSnapshot, 0, 0);
      const rect = normalizeRect(state.startX, state.startY, p.x, p.y);
      drawSelectionOutline(rect.x, rect.y, rect.w, rect.h);
      state.lastX = p.x;
      state.lastY = p.y;
      return;
    }

    if (state.selection.dragging) {
      state.selection.x = p.x - state.selection.offsetX;
      state.selection.y = p.y - state.selection.offsetY;
      renderFloatingSelection();
    }
    state.lastX = p.x;
    state.lastY = p.y;
    return;
  }

  if (SHAPE_TOOLS.has(state.tool)) {
    if (!state.previewSnapshot) return;
    const constrained = constrainPoint(state.tool, state.startX, state.startY, p.x, p.y, event.shiftKey);
    ctx.putImageData(state.previewSnapshot, 0, 0);
    drawShape(state.tool, state.startX, state.startY, constrained.x, constrained.y);
    state.lastX = p.x;
    state.lastY = p.y;
    return;
  }

  applyStrokeStyle();
  ctx.beginPath();
  ctx.moveTo(prevX, prevY);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  state.lastX = p.x;
  state.lastY = p.y;
}

function endDraw(event) {
  if (!state.drawing) return;
  if (event && state.pointerId !== null && event.pointerId !== state.pointerId) return;

  if (state.tool === "select") {
    if (state.selection.creating && state.previewSnapshot) {
      ctx.putImageData(state.previewSnapshot, 0, 0);
      const rect = normalizeRect(state.startX, state.startY, state.lastX, state.lastY);
      if (rect.w >= 3 && rect.h >= 3) {
        beginSelectionFromRect(rect);
      }
    } else if (state.selection.dragging) {
      state.selection.dragging = false;
      renderFloatingSelection();
    }
  } else if (SHAPE_TOOLS.has(state.tool) && state.previewSnapshot) {
    const constrained = constrainPoint(
      state.tool,
      state.startX,
      state.startY,
      state.lastX,
      state.lastY,
      state.lastShiftKey,
    );
    ctx.putImageData(state.previewSnapshot, 0, 0);
    drawShape(state.tool, state.startX, state.startY, constrained.x, constrained.y);
  }

  state.drawing = false;
  state.previewSnapshot = null;
  state.selection.creating = false;
  if (state.pointerId !== null) {
    try {
      if (canvas.hasPointerCapture(state.pointerId)) {
        canvas.releasePointerCapture(state.pointerId);
      }
    } catch {
      // ignore
    }
  }
  state.pointerId = null;
  ctx.globalCompositeOperation = "source-over";
}

function undo() {
  if (state.selection.active) {
    clearSelectionState();
  }
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
  if (state.selection.active) {
    renderFloatingSelection();
  }
  const link = document.createElement("a");
  link.download = `paint-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function getTargetIsTypingElement(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

async function copyCanvasToClipboard() {
  if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
    showStatus("클립보드 복사를 지원하지 않는 브라우저입니다.", true);
    return;
  }

  if (state.selection.active) {
    renderFloatingSelection();
  }

  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("blob_generation_failed");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showStatus("캔버스를 클립보드에 복사했습니다.");
  } catch {
    showStatus("클립보드 복사에 실패했습니다.", true);
  }
}

async function readImageFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    showStatus("붙여넣기는 Ctrl/Cmd+V 키를 사용해 주세요.", true);
    return null;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          return item.getType(type);
        }
      }
    }
  } catch {
    showStatus("클립보드 읽기 권한이 필요합니다.", true);
  }
  return null;
}

function loadBlobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
}

async function pasteImageBlob(blob) {
  if (!blob) return;
  try {
    const image = await loadBlobToImage(blob);
    pushHistory();
    const x = (canvas.clientWidth - image.width) / 2;
    const y = (canvas.clientHeight - image.height) / 2;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(image, x, y, image.width, image.height);
    showStatus("비트맵 이미지를 캔버스에 붙여넣었습니다.");
  } catch {
    showStatus("이미지 붙여넣기에 실패했습니다.", true);
  }
}

async function pasteFromClipboardButton() {
  const blob = await readImageFromClipboard();
  if (!blob) {
    showStatus("클립보드에 이미지가 없습니다.", true);
    return;
  }
  await pasteImageBlob(blob);
}

function handlePasteEvent(event) {
  if (!event.clipboardData) return;
  const items = Array.from(event.clipboardData.items || []);
  const imageItem = items.find((item) => item.type && item.type.startsWith("image/"));
  if (!imageItem) return;
  event.preventDefault();
  const file = imageItem.getAsFile();
  if (file) {
    pasteImageBlob(file);
  }
}

function handleShortcuts(event) {
  const isMacLike = navigator.platform.toLowerCase().includes("mac");
  const meta = isMacLike ? event.metaKey : event.ctrlKey;

  if (event.key === "Escape" && state.selection.active) {
    commitSelectionToCanvas(true);
    return;
  }

  if (!meta) return;

  const key = event.key.toLowerCase();
  if (key === "c") {
    if (getTargetIsTypingElement(event.target)) return;
    event.preventDefault();
    copyCanvasToClipboard();
  } else if (key === "z") {
    if (getTargetIsTypingElement(event.target)) return;
    event.preventDefault();
    undo();
  }
}

function initEvents() {
  canvas.addEventListener("pointerdown", beginDraw, { passive: false });
  canvas.addEventListener("pointermove", draw, { passive: false });
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointerleave", endDraw);
  canvas.addEventListener("pointercancel", endDraw);

  colorPicker.addEventListener("change", () => {
    state.color = colorPicker.value;
    if (state.tool === "eraser") {
      setTool("brush");
    }
    setToolUI();
  });

  sizeSlider.addEventListener("input", () => {
    state.size = Number(sizeSlider.value);
    setToolUI();
  });

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setTool(button.dataset.tool);
    });
  });

  swatchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextColor = button.dataset.color;
      if (!nextColor) return;
      state.color = nextColor;
      colorPicker.value = nextColor;
      if (state.tool === "eraser") {
        setTool("brush");
      } else {
        setToolUI();
      }
    });
  });

  strokeModeButton.addEventListener("click", () => {
    setShapeFillMode(false);
  });
  fillModeButton.addEventListener("click", () => {
    setShapeFillMode(true);
  });

  copyButton.addEventListener("click", copyCanvasToClipboard);
  pasteButton.addEventListener("click", pasteFromClipboardButton);
  undoButton.addEventListener("click", undo);
  clearButton.addEventListener("click", clearCanvas);
  saveButton.addEventListener("click", savePng);

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", handleShortcuts);
  window.addEventListener("paste", handlePasteEvent);
}

resizeCanvas();
setToolUI();
initEvents();
