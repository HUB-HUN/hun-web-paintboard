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

const toolButtons = Array.from(document.querySelectorAll(".tool-button"));
const swatchButtons = Array.from(document.querySelectorAll(".swatch"));

const SHAPE_TOOLS = new Set(["line", "rect", "circle", "triangle", "star"]);

const state = {
  drawing: false,
  pointerId: null,
  tool: "brush",
  color: colorPicker.value,
  size: Number(sizeSlider.value),
  history: [],
  maxHistory: 30,
  lastX: 0,
  lastY: 0,
  startX: 0,
  startY: 0,
  previewSnapshot: null,
  statusTimer: null,
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

function setTool(tool) {
  state.tool = tool;
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
}

function pushHistory() {
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

function drawStar(cx, cy, outerRadius, innerRadius) {
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
  ctx.stroke();
}

function drawShape(tool, x1, y1, x2, y2) {
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = state.color;
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
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    ctx.strokeRect(left, top, width, height);
    return;
  }

  if (tool === "circle") {
    const radius = Math.hypot(x2 - x1, y2 - y1);
    ctx.beginPath();
    ctx.arc(x1, y1, radius, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (tool === "triangle") {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    ctx.beginPath();
    ctx.moveTo((left + right) / 2, top);
    ctx.lineTo(right, bottom);
    ctx.lineTo(left, bottom);
    ctx.closePath();
    ctx.stroke();
    return;
  }

  if (tool === "star") {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const outer = Math.max(1, Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2);
    drawStar(cx, cy, outer, outer * 0.45);
  }
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
  canvas.setPointerCapture(event.pointerId);
  pushHistory();

  if (SHAPE_TOOLS.has(state.tool)) {
    state.previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } else {
    applyStrokeStyle();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.001, p.y + 0.001);
    ctx.stroke();
  }
}

function draw(event) {
  if (!state.drawing || event.pointerId !== state.pointerId) return;
  event.preventDefault();
  const p = getPoint(event);

  if (SHAPE_TOOLS.has(state.tool)) {
    if (!state.previewSnapshot) return;
    ctx.putImageData(state.previewSnapshot, 0, 0);
    drawShape(state.tool, state.startX, state.startY, p.x, p.y);
  } else {
    applyStrokeStyle();
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  state.lastX = p.x;
  state.lastY = p.y;
}

function endDraw(event) {
  if (!state.drawing) return;
  if (event && state.pointerId !== null && event.pointerId !== state.pointerId) return;

  if (SHAPE_TOOLS.has(state.tool) && state.previewSnapshot) {
    ctx.putImageData(state.previewSnapshot, 0, 0);
    drawShape(state.tool, state.startX, state.startY, state.lastX, state.lastY);
  }

  state.drawing = false;
  state.previewSnapshot = null;
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
