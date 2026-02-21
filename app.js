const canvas = document.getElementById("paintCanvas");
const canvasWrap = document.querySelector(".canvas-wrap");
const viewCtx = canvas.getContext("2d", { willReadFrequently: true });

const colorPicker = document.getElementById("colorPicker");
const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");
const undoButton = document.getElementById("undoButton");
const clearButton = document.getElementById("clearButton");
const saveButton = document.getElementById("saveButton");
const toastContainer = document.getElementById("toastContainer");
const strokeModeButton = document.getElementById("strokeModeButton");
const fillModeButton = document.getElementById("fillModeButton");
const textFontFamily = document.getElementById("textFontFamily");
const textFontWeight = document.getElementById("textFontWeight");
const textWeightValue = document.getElementById("textWeightValue");
const textSizeSlider = document.getElementById("textSizeSlider");
const textSizeValue = document.getElementById("textSizeValue");
const addLayerButton = document.getElementById("addLayerButton");
const mergeLayersButton = document.getElementById("mergeLayersButton");
const deleteLayerButton = document.getElementById("deleteLayerButton");
const layersList = document.getElementById("layersList");
const layersPanel = document.querySelector(".layers-panel");
const layersPanelHeader = document.querySelector(".layers-panel-header");
const layerTextControls = document.getElementById("layerTextControls");
const layerTextInput = document.getElementById("layerTextInput");

const toolButtons = Array.from(document.querySelectorAll(".tool-button"));
const swatchButtons = Array.from(document.querySelectorAll(".swatch"));

const TAU = Math.PI * 2;
const SHAPE_TOOLS = new Set(["line", "rect", "circle", "triangle", "star"]);
const SELECTION_HANDLE_RADIUS = 10;
const WHEEL_ZOOM_INTENSITY = 0.008;
const KEYBOARD_ZOOM_STEP = 1.32;
const PINCH_ZOOM_SENSITIVITY = 2;

const state = {
  drawing: false,
  pointerId: null,
  tool: "brush",
  color: colorPicker.value,
  size: Number(sizeSlider.value),
  shapeFill: false,
  layers: [],
  nextLayerId: 1,
  activeLayerId: null,
  layerSelection: {
    selectedIds: new Set(),
    anchorId: null,
  },
  layerReorder: {
    dragging: false,
    draggedIds: [],
    overId: null,
    suppressClickUntil: 0,
  },
  layerDrag: {
    active: false,
    pointerId: null,
    startPointerX: 0,
    startPointerY: 0,
    startLayerX: 0,
    startLayerY: 0,
    historyPushed: false,
  },
  history: [],
  maxHistory: 10,
  lastX: 0,
  lastY: 0,
  lastShiftKey: false,
  startX: 0,
  startY: 0,
  previewSnapshot: null,
  world: {
    width: 0,
    height: 0,
    minWidth: 3600,
    minHeight: 2400,
    scaleFactor: 3.4,
    initialized: false,
  },
  view: {
    scale: 1,
    minScale: 0.55,
    maxScale: 4,
    offsetX: 0,
    offsetY: 0,
    initialized: false,
    panning: false,
    panPointerId: null,
    panStartClientX: 0,
    panStartClientY: 0,
    panStartOffsetX: 0,
    panStartOffsetY: 0,
    spacePressed: false,
    touchPoints: new Map(),
    touchGesture: {
      active: false,
      startDistance: 0,
      startScale: 1,
      startMidClientX: 0,
      startMidClientY: 0,
      startOffsetX: 0,
      startOffsetY: 0,
    },
  },
  text: {
    family: textFontFamily.value,
    weight: Number(textFontWeight.value),
    size: Number(textSizeSlider.value),
    editing: false,
    editorEl: null,
    editingLayerId: null,
    x: 0,
    y: 0,
  },
  selection: {
    active: false,
    creating: false,
    dragging: false,
    resizing: false,
    resizeHandle: null,
    layerId: null,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    layer: null,
    baseSnapshot: null,
    offsetX: 0,
    offsetY: 0,
    resizeStartX: 0,
    resizeStartY: 0,
    resizeStartRect: null,
  },
  render: {
    pending: false,
  },
  panel: {
    dragging: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 0,
    startTop: 0,
    manual: false,
  },
  panelText: {
    layerId: null,
    historyPushed: false,
  },
};

function getLayerById(layerId) {
  return state.layers.find((layer) => layer.id === layerId) || null;
}

function getActiveLayer() {
  return getLayerById(state.activeLayerId);
}

function getLayerDisplayOrderIds() {
  return [...state.layers].reverse().map((layer) => layer.id);
}

function getSelectedLayerIds() {
  const validIds = [];
  for (const layerId of state.layerSelection.selectedIds) {
    if (getLayerById(layerId)) {
      validIds.push(layerId);
    }
  }
  if (state.activeLayerId && getLayerById(state.activeLayerId) && !validIds.includes(state.activeLayerId)) {
    validIds.push(state.activeLayerId);
  }
  return validIds;
}

function applyLayerSelection(selectedIds, activeLayerId, anchorId = activeLayerId) {
  const selectedSet = new Set();
  for (const layerId of selectedIds) {
    if (getLayerById(layerId)) {
      selectedSet.add(layerId);
    }
  }

  let nextActiveId = activeLayerId;
  if (!nextActiveId || !getLayerById(nextActiveId)) {
    nextActiveId = selectedSet.size > 0 ? [...selectedSet][0] : state.layers[0]?.id ?? null;
  }
  if (!nextActiveId || !getLayerById(nextActiveId)) return;

  if (!selectedSet.has(nextActiveId)) {
    selectedSet.add(nextActiveId);
  }

  if (state.selection.active && state.selection.layerId && state.selection.layerId !== nextActiveId) {
    commitSelectionToCanvas(true);
  }

  state.activeLayerId = nextActiveId;
  state.layerSelection.selectedIds = selectedSet;
  state.layerSelection.anchorId = getLayerById(anchorId) ? anchorId : nextActiveId;

  const layer = getLayerById(nextActiveId);
  syncTextControlsFromLayer(layer);
  renderLayersList();
  syncLayerTextPanel();
  setToolUI();
  renderComposite();
}

function handleLayerRowClick(layerId, event) {
  if (Date.now() < state.layerReorder.suppressClickUntil) {
    event.preventDefault();
    return;
  }
  const layer = getLayerById(layerId);
  if (!layer) return;

  const isToggleMulti = event.ctrlKey || event.metaKey;
  const isRangeMulti = event.shiftKey;
  const currentSelected = new Set(getSelectedLayerIds());
  const displayIds = getLayerDisplayOrderIds();

  if (isRangeMulti) {
    const fallbackAnchor = state.activeLayerId || layerId;
    const anchorId = getLayerById(state.layerSelection.anchorId) ? state.layerSelection.anchorId : fallbackAnchor;
    const anchorIndex = displayIds.indexOf(anchorId);
    const targetIndex = displayIds.indexOf(layerId);
    if (anchorIndex < 0 || targetIndex < 0) {
      applyLayerSelection([layerId], layerId, layerId);
      return;
    }
    const rangeIds = displayIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1);
    const nextSet = isToggleMulti ? new Set([...currentSelected, ...rangeIds]) : new Set(rangeIds);
    applyLayerSelection(nextSet, layerId, anchorId);
    return;
  }

  if (isToggleMulti) {
    if (currentSelected.has(layerId) && currentSelected.size > 1) {
      currentSelected.delete(layerId);
      const fallbackActive = layerId === state.activeLayerId ? [...currentSelected][0] : state.activeLayerId;
      applyLayerSelection(currentSelected, fallbackActive, layerId);
      return;
    }
    currentSelected.add(layerId);
    applyLayerSelection(currentSelected, layerId, layerId);
    return;
  }

  applyLayerSelection([layerId], layerId, layerId);
}

function clearLayerDragVisuals() {
  if (!layersList) return;
  layersList.querySelectorAll(".layer-item.drag-over").forEach((row) => row.classList.remove("drag-over"));
  layersList.querySelectorAll(".layer-item.drag-source").forEach((row) => row.classList.remove("drag-source"));
}

function setLayerDragOverVisual(layerId) {
  if (!layersList) return;
  clearLayerDragVisuals();
  const draggedSet = new Set(state.layerReorder.draggedIds);
  for (const draggedId of draggedSet) {
    const sourceRow = layersList.querySelector(`.layer-item[data-layer-id="${draggedId}"]`);
    if (sourceRow) {
      sourceRow.classList.add("drag-source");
    }
  }
  const overRow = layersList.querySelector(`.layer-item[data-layer-id="${layerId}"]`);
  if (overRow && !draggedSet.has(layerId)) {
    overRow.classList.add("drag-over");
  }
}

function buildSwappedDisplayOrder(displayIds, draggedIds, targetId) {
  const draggedSet = new Set(draggedIds);
  if (draggedSet.size === 0 || draggedSet.has(targetId)) return null;
  if (!displayIds.includes(targetId)) return null;

  const orderedDragged = displayIds.filter((id) => draggedSet.has(id));
  if (orderedDragged.length === 0) return null;

  const originalTargetIndex = displayIds.indexOf(targetId);
  const originalFirstDraggedIndex = displayIds.indexOf(orderedDragged[0]);
  const removedSet = new Set([...orderedDragged, targetId]);
  const removedIndices = displayIds
    .map((id, index) => (removedSet.has(id) ? index : -1))
    .filter((index) => index >= 0);
  const countRemovedBefore = (index) => removedIndices.filter((removedIndex) => removedIndex < index).length;

  const base = displayIds.filter((id) => !removedSet.has(id));
  const insertDraggedAt = originalTargetIndex - countRemovedBefore(originalTargetIndex);
  const withDragged = [...base];
  withDragged.splice(insertDraggedAt, 0, ...orderedDragged);

  let insertTargetAt = originalFirstDraggedIndex - countRemovedBefore(originalFirstDraggedIndex);
  if (insertTargetAt >= insertDraggedAt) {
    insertTargetAt += orderedDragged.length;
  }
  withDragged.splice(insertTargetAt, 0, targetId);
  return withDragged;
}

function swapLayerOrderByDrop(targetId) {
  const draggedIds = state.layerReorder.draggedIds.filter((id) => getLayerById(id));
  if (draggedIds.length === 0) return false;
  if (draggedIds.includes(targetId)) return false;

  const displayIds = getLayerDisplayOrderIds();
  const swappedDisplayIds = buildSwappedDisplayOrder(displayIds, draggedIds, targetId);
  if (!swappedDisplayIds || swappedDisplayIds.length !== displayIds.length) return false;

  const layerMap = new Map(state.layers.map((layer) => [layer.id, layer]));
  const nextLayerOrder = swappedDisplayIds
    .slice()
    .reverse()
    .map((layerId) => layerMap.get(layerId))
    .filter(Boolean);
  if (nextLayerOrder.length !== state.layers.length) return false;

  state.layers = nextLayerOrder;
  const nextActiveId =
    state.activeLayerId && draggedIds.includes(state.activeLayerId)
      ? state.activeLayerId
      : draggedIds[0];
  applyLayerSelection(draggedIds, nextActiveId, state.layerSelection.anchorId || nextActiveId);
  return true;
}

function handleLayerRowDragStart(layerId, event) {
  const selectedIds = new Set(getSelectedLayerIds());
  const dragIds = selectedIds.has(layerId) ? [...selectedIds] : [layerId];
  state.layerReorder.dragging = true;
  state.layerReorder.draggedIds = dragIds;
  state.layerReorder.overId = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(layerId));
  }
  setLayerDragOverVisual(null);
}

function handleLayerRowDragOver(layerId, event) {
  if (!state.layerReorder.dragging) return;
  if (state.layerReorder.draggedIds.includes(layerId)) {
    state.layerReorder.overId = null;
    setLayerDragOverVisual(null);
    return;
  }
  event.preventDefault();
  state.layerReorder.overId = layerId;
  setLayerDragOverVisual(layerId);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleLayerRowDrop(layerId, event) {
  if (!state.layerReorder.dragging) return;
  event.preventDefault();
  const changed = swapLayerOrderByDrop(layerId);
  state.layerReorder.suppressClickUntil = Date.now() + 160;
  state.layerReorder.dragging = false;
  state.layerReorder.draggedIds = [];
  state.layerReorder.overId = null;
  clearLayerDragVisuals();
  if (changed) {
    showStatus("레이어 순서를 교환했습니다.");
  }
}

function handleLayerRowDragEnd() {
  state.layerReorder.dragging = false;
  state.layerReorder.draggedIds = [];
  state.layerReorder.overId = null;
  clearLayerDragVisuals();
}

function getLayerTypeLabel(layer) {
  if (!layer) return "";
  return layer.type === "text" ? "텍스트" : "래스터";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getEditingContext() {
  const layer = getActiveLayer();
  if (layer && layer.type === "raster") {
    return layer.ctx;
  }
  return viewCtx;
}

const ctx = new Proxy(
  {},
  {
    get(_target, property) {
      const context = getEditingContext();
      const value = context[property];
      return typeof value === "function" ? value.bind(context) : value;
    },
    set(_target, property, value) {
      const context = getEditingContext();
      context[property] = value;
      return true;
    },
  },
);

function createRasterLayer(name = null) {
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = state.world.width || Math.max(1, canvas.clientWidth || 1);
  layerCanvas.height = state.world.height || Math.max(1, canvas.clientHeight || 1);
  const layerCtx = layerCanvas.getContext("2d", { willReadFrequently: true });
  layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  const layer = {
    id: state.nextLayerId++,
    name: name || `레이어 ${state.nextLayerId - 1}`,
    type: "raster",
    visible: true,
    x: 0,
    y: 0,
    canvas: layerCanvas,
    ctx: layerCtx,
  };
  return layer;
}

function createTextLayer(text, x, y) {
  return {
    id: state.nextLayerId++,
    name: text,
    type: "text",
    visible: true,
    x,
    y,
    text,
    color: state.color,
    fontFamily: state.text.family,
    fontWeight: state.text.weight,
    fontSize: state.text.size,
  };
}

function renderLayersList() {
  if (!layersList) return;
  layersList.innerHTML = "";
  const selectedIds = new Set(getSelectedLayerIds());

  const sortedLayers = [...state.layers].reverse();
  sortedLayers.forEach((layer) => {
    const row = document.createElement("button");
    row.type = "button";
    row.draggable = true;
    const isActive = layer.id === state.activeLayerId;
    const isSelected = selectedIds.has(layer.id);
    const isDragSource = state.layerReorder.dragging && state.layerReorder.draggedIds.includes(layer.id);
    const isDragOver = state.layerReorder.dragging && state.layerReorder.overId === layer.id && !isDragSource;
    row.className = `layer-item${isActive ? " active" : ""}${isSelected ? " selected" : ""}${isDragSource ? " drag-source" : ""}${isDragOver ? " drag-over" : ""}`;
    row.dataset.layerId = String(layer.id);
    const safeLayerName = escapeHtml(layer.name);
    row.innerHTML = `
      <span class="layer-meta">
        <span class="layer-name">${safeLayerName}</span>
        <span class="layer-type">${getLayerTypeLabel(layer)}</span>
      </span>
      <span>${layer.visible ? "◉" : "○"}</span>
    `;
    row.addEventListener("click", (event) => {
      handleLayerRowClick(layer.id, event);
    });
    row.addEventListener("dragstart", (event) => {
      handleLayerRowDragStart(layer.id, event);
    });
    row.addEventListener("dragover", (event) => {
      handleLayerRowDragOver(layer.id, event);
    });
    row.addEventListener("drop", (event) => {
      handleLayerRowDrop(layer.id, event);
    });
    row.addEventListener("dragend", () => {
      handleLayerRowDragEnd();
    });
    layersList.appendChild(row);
  });
}

function syncLayerTextPanel() {
  if (!layerTextControls || !layerTextInput) return;
  const layer = getActiveLayer();
  const selectedLayerCount = getSelectedLayerIds().length;
  const isTextLayer = Boolean(layer && layer.type === "text" && selectedLayerCount === 1);
  layerTextControls.hidden = !isTextLayer;
  layerTextControls.style.display = isTextLayer ? "flex" : "none";

  if (!isTextLayer) {
    state.panelText.layerId = null;
    state.panelText.historyPushed = false;
    layerTextInput.value = "";
    return;
  }

  const currentEditing = document.activeElement === layerTextInput;
  if (!currentEditing || state.panelText.layerId !== layer.id) {
    layerTextInput.value = layer.text || "";
  }
  state.panelText.layerId = layer.id;
}

function applyLayerTextFromPanel(forceHistory = false) {
  if (!layerTextInput) return;
  const layer = getActiveLayer();
  if (!layer || layer.type !== "text") return;
  const nextText = layerTextInput.value ?? "";
  if (layer.text === nextText) return;
  if (forceHistory || !state.panelText.historyPushed || state.panelText.layerId !== layer.id) {
    pushHistory({ layerId: layer.id });
    state.panelText.historyPushed = true;
  }
  layer.text = nextText;
  layer.name = nextText;
  renderComposite();
  renderLayersList();
}

function syncTextControlsFromLayer(layer) {
  if (!layer || layer.type !== "text") return;
  state.text.family = layer.fontFamily;
  state.text.weight = layer.fontWeight;
  state.text.size = layer.fontSize;
  state.color = layer.color;
  textFontFamily.value = layer.fontFamily;
  textFontWeight.value = String(layer.fontWeight);
  textSizeSlider.value = String(layer.fontSize);
  colorPicker.value = layer.color;
}

function setActiveLayer(layerId) {
  applyLayerSelection([layerId], layerId, layerId);
}

function addRasterLayer() {
  const layer = createRasterLayer();
  state.layers.push(layer);
  setActiveLayer(layer.id);
  showStatus("새 래스터 레이어를 추가했습니다.");
}

function deleteActiveLayer() {
  const layer = getActiveLayer();
  if (!layer) return;
  if (state.text.editing && state.text.editingLayerId === layer.id) {
    closeTextEditor(false);
  }
  if (state.layers.length <= 1) {
    showStatus("최소 1개 레이어는 유지해야 합니다.", true);
    return;
  }
  const index = state.layers.findIndex((candidate) => candidate.id === layer.id);
  if (index < 0) return;
  state.layers.splice(index, 1);
  const nextLayer = state.layers[Math.max(0, index - 1)] || state.layers[0];
  if (!nextLayer) return;
  setActiveLayer(nextLayer.id);
}

function ensureActiveRasterLayer() {
  const activeLayer = getActiveLayer();
  if (activeLayer && activeLayer.type === "raster") {
    return activeLayer;
  }
  const layer = createRasterLayer();
  state.layers.push(layer);
  setActiveLayer(layer.id);
  showStatus("텍스트 레이어에서는 그릴 수 없어 새 래스터 레이어를 만들었습니다.");
  return layer;
}

function resizeRasterLayers() {
  state.layers.forEach((layer) => {
    if (layer.type !== "raster" || !layer.canvas) return;
    if (layer.canvas.width === state.world.width && layer.canvas.height === state.world.height) return;
    const prev = document.createElement("canvas");
    prev.width = layer.canvas.width;
    prev.height = layer.canvas.height;
    prev.getContext("2d").drawImage(layer.canvas, 0, 0);

    layer.canvas.width = state.world.width;
    layer.canvas.height = state.world.height;
    layer.ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
    layer.ctx.drawImage(prev, 0, 0);
  });
}

function drawTextLayer(layer, targetCtx = viewCtx) {
  if (!layer || layer.type !== "text" || !layer.visible || !layer.text) return;
  targetCtx.save();
  targetCtx.globalCompositeOperation = "source-over";
  targetCtx.fillStyle = layer.color;
  targetCtx.font = `${layer.fontWeight} ${layer.fontSize}px ${getTextFamilyCssName(layer.fontFamily)}`;
  targetCtx.textBaseline = "top";
  const drawY = layer.y - layer.fontSize / 2;
  targetCtx.fillText(layer.text, layer.x, drawY);
  targetCtx.restore();
}

function mergeSelectedLayers() {
  if (state.text.editing) {
    closeTextEditor(true);
  }
  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }

  const selectedIds = getSelectedLayerIds();
  if (selectedIds.length < 2) {
    showStatus("병합할 레이어를 2개 이상 선택해 주세요.", true);
    return;
  }

  const selectedSet = new Set(selectedIds);
  const selectedEntries = state.layers
    .map((layer, index) => ({ layer, index }))
    .filter((entry) => selectedSet.has(entry.layer.id))
    .sort((a, b) => a.index - b.index);

  if (selectedEntries.length < 2) {
    showStatus("병합할 레이어를 2개 이상 선택해 주세요.", true);
    return;
  }

  const mergedLayer = createRasterLayer(`병합 레이어 ${state.nextLayerId}`);
  mergedLayer.ctx.clearRect(0, 0, mergedLayer.canvas.width, mergedLayer.canvas.height);

  for (const entry of selectedEntries) {
    const layer = entry.layer;
    if (!layer.visible) continue;
    if (layer.type === "raster" && layer.canvas) {
      mergedLayer.ctx.drawImage(layer.canvas, layer.x || 0, layer.y || 0);
    } else if (layer.type === "text") {
      drawTextLayer(layer, mergedLayer.ctx);
    }
  }

  const topmostIndex = selectedEntries[selectedEntries.length - 1].index;
  const removedBeforeTopmost = selectedEntries.filter((entry) => entry.index < topmostIndex).length;
  const insertIndex = topmostIndex - removedBeforeTopmost;

  state.layers = state.layers.filter((layer) => !selectedSet.has(layer.id));
  state.layers.splice(insertIndex, 0, mergedLayer);
  setActiveLayer(mergedLayer.id);
  showStatus(`선택 레이어 ${selectedEntries.length}개를 병합했습니다.`);
}

function drawCompositeNow() {
  const dpr = getViewDpr();
  viewCtx.save();
  viewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  viewCtx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  viewCtx.fillStyle = "#ffffff";
  viewCtx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  for (const layer of state.layers) {
    if (!layer.visible) continue;
    if (layer.type === "raster") {
      viewCtx.drawImage(layer.canvas, layer.x, layer.y);
    } else if (layer.type === "text") {
      drawTextLayer(layer, viewCtx);
    }
  }
  viewCtx.restore();
}

function renderComposite(immediate = false) {
  if (immediate) {
    state.render.pending = false;
    drawCompositeNow();
    return;
  }
  if (state.render.pending) return;
  state.render.pending = true;
  const schedule = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame : (cb) => setTimeout(cb, 16);
  schedule(() => {
    state.render.pending = false;
    drawCompositeNow();
  });
}

function clampPanelPosition(left, top) {
  if (!layersPanel) return { left, top };
  const maxLeft = Math.max(0, canvasWrap.clientWidth - layersPanel.offsetWidth - 8);
  const maxTop = Math.max(0, canvasWrap.clientHeight - layersPanel.offsetHeight - 8);
  return {
    left: clampNumber(left, 8, maxLeft),
    top: clampNumber(top, 8, maxTop),
  };
}

function applyPanelPosition(left, top) {
  if (!layersPanel) return;
  const next = clampPanelPosition(left, top);
  layersPanel.style.left = `${next.left}px`;
  layersPanel.style.top = `${next.top}px`;
  layersPanel.style.right = "auto";
}

function startPanelDrag(event) {
  if (!layersPanel || !layersPanelHeader) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest("button")) return;
  event.preventDefault();
  event.stopPropagation();

  const wrapRect = canvasWrap.getBoundingClientRect();
  const panelRect = layersPanel.getBoundingClientRect();
  state.panel.dragging = true;
  state.panel.pointerId = event.pointerId;
  state.panel.startClientX = event.clientX;
  state.panel.startClientY = event.clientY;
  state.panel.startLeft = panelRect.left - wrapRect.left;
  state.panel.startTop = panelRect.top - wrapRect.top;
  state.panel.manual = true;
  layersPanelHeader.style.cursor = "grabbing";
  try {
    layersPanelHeader.setPointerCapture(event.pointerId);
  } catch {
    // ignore
  }
}

function movePanelDrag(event) {
  if (!state.panel.dragging || event.pointerId !== state.panel.pointerId) return;
  event.preventDefault();
  const dx = event.clientX - state.panel.startClientX;
  const dy = event.clientY - state.panel.startClientY;
  applyPanelPosition(state.panel.startLeft + dx, state.panel.startTop + dy);
}

function endPanelDrag(event) {
  if (!state.panel.dragging) return;
  if (event && event.pointerId !== state.panel.pointerId) return;
  if (layersPanelHeader && state.panel.pointerId !== null) {
    try {
      if (layersPanelHeader.hasPointerCapture(state.panel.pointerId)) {
        layersPanelHeader.releasePointerCapture(state.panel.pointerId);
      }
    } catch {
      // ignore
    }
  }
  state.panel.dragging = false;
  state.panel.pointerId = null;
  if (layersPanelHeader) {
    layersPanelHeader.style.cursor = "grab";
  }
}

function showStatus(message, isError = false) {
  if (!toastContainer) return;
  while (toastContainer.children.length >= 4) {
    toastContainer.firstElementChild.remove();
  }
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-6px) scale(0.98)";
    setTimeout(() => {
      toast.remove();
    }, 180);
  }, 1900);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampViewOffset() {
  const viewportWidth = canvasWrap.clientWidth;
  const viewportHeight = canvasWrap.clientHeight;
  const scaledWidth = canvas.clientWidth * state.view.scale;
  const scaledHeight = canvas.clientHeight * state.view.scale;
  const overflowMargin = 0;

  let minX;
  let maxX;
  if (scaledWidth <= viewportWidth) {
    const centeredX = (viewportWidth - scaledWidth) / 2;
    minX = centeredX;
    maxX = centeredX;
  } else {
    minX = viewportWidth - scaledWidth - overflowMargin;
    maxX = overflowMargin;
  }

  let minY;
  let maxY;
  if (scaledHeight <= viewportHeight) {
    const centeredY = (viewportHeight - scaledHeight) / 2;
    minY = centeredY;
    maxY = centeredY;
  } else {
    minY = viewportHeight - scaledHeight - overflowMargin;
    maxY = overflowMargin;
  }

  state.view.offsetX = clampNumber(state.view.offsetX, minX, maxX);
  state.view.offsetY = clampNumber(state.view.offsetY, minY, maxY);
}

function getViewDpr() {
  const nativeDpr = Math.min(window.devicePixelRatio || 1, 2);
  const worldWidth = state.world.width || canvas.clientWidth || 1;
  const worldHeight = state.world.height || canvas.clientHeight || 1;
  const estimatedPixels = worldWidth * worldHeight * nativeDpr * nativeDpr;
  if (estimatedPixels > 20000000) return 1;
  return nativeDpr;
}

function getDefaultViewScale() {
  return clampNumber(1, state.view.minScale, state.view.maxScale);
}

function centerViewOn(worldX, worldY) {
  const viewportWidth = canvasWrap.clientWidth;
  const viewportHeight = canvasWrap.clientHeight;
  state.view.offsetX = viewportWidth / 2 - worldX * state.view.scale;
  state.view.offsetY = viewportHeight / 2 - worldY * state.view.scale;
}

function canvasPointToViewport(x, y) {
  return {
    x: state.view.offsetX + x * state.view.scale,
    y: state.view.offsetY + y * state.view.scale,
  };
}

function positionTextEditor() {
  if (!state.text.editorEl) return;
  const point = canvasPointToViewport(state.text.x, state.text.y);
  const halfHeight = (state.text.editorEl.offsetHeight || Math.max(24, state.text.size)) / 2;
  state.text.editorEl.style.left = `${point.x}px`;
  state.text.editorEl.style.top = `${point.y - halfHeight}px`;
}

function applyViewTransform() {
  clampViewOffset();
  canvas.style.transformOrigin = "0 0";
  canvas.style.transform = `translate(${state.view.offsetX}px, ${state.view.offsetY}px) scale(${state.view.scale})`;
  positionTextEditor();
}

function updateCanvasCursor() {
  let cursor = "crosshair";
  if (state.view.touchGesture.active || state.view.panning) {
    cursor = "grabbing";
  } else if (state.view.spacePressed) {
    cursor = "grab";
  } else if (state.tool === "text") {
    cursor = "text";
  } else if (state.tool === "select") {
    cursor = "move";
  }
  canvas.style.cursor = cursor;
  canvasWrap.style.cursor = cursor;
}

function releasePointerCaptureSafe(pointerId) {
  if (pointerId === null || pointerId === undefined) return;
  try {
    if (canvasWrap.hasPointerCapture(pointerId)) {
      canvasWrap.releasePointerCapture(pointerId);
    }
  } catch {
    // ignore
  }
}

function shouldStartPan(event) {
  if (event.pointerType !== "mouse") return false;
  return event.button === 1 || (event.button === 0 && state.view.spacePressed);
}

function startPan(event) {
  state.view.panning = true;
  state.view.panPointerId = event.pointerId;
  state.view.panStartClientX = event.clientX;
  state.view.panStartClientY = event.clientY;
  state.view.panStartOffsetX = state.view.offsetX;
  state.view.panStartOffsetY = state.view.offsetY;
  canvasWrap.setPointerCapture(event.pointerId);
  updateCanvasCursor();
}

function stopPan() {
  releasePointerCaptureSafe(state.view.panPointerId);
  state.view.panning = false;
  state.view.panPointerId = null;
  updateCanvasCursor();
}

function collectTouchPair() {
  const points = Array.from(state.view.touchPoints.values());
  if (points.length < 2) return null;
  return [points[0], points[1]];
}

function calculateDistanceAndMidpoint(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    distance: Math.max(12, Math.hypot(dx, dy)),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  };
}

function beginTouchGesture() {
  const pair = collectTouchPair();
  if (!pair) return;

  if (state.drawing) {
    endDraw({ pointerId: state.pointerId });
  }
  if (state.view.panning) {
    stopPan();
  }

  const metrics = calculateDistanceAndMidpoint(pair[0], pair[1]);
  state.view.touchGesture.active = true;
  state.view.touchGesture.startDistance = metrics.distance;
  state.view.touchGesture.startScale = state.view.scale;
  state.view.touchGesture.startMidClientX = metrics.midX;
  state.view.touchGesture.startMidClientY = metrics.midY;
  state.view.touchGesture.startOffsetX = state.view.offsetX;
  state.view.touchGesture.startOffsetY = state.view.offsetY;
  updateCanvasCursor();
}

function updateTouchGesture() {
  const pair = collectTouchPair();
  if (!pair) return false;

  if (!state.view.touchGesture.active) {
    beginTouchGesture();
  }
  if (!state.view.touchGesture.active) return false;

  const metrics = calculateDistanceAndMidpoint(pair[0], pair[1]);
  const gesture = state.view.touchGesture;
  const rect = canvasWrap.getBoundingClientRect();

  const startAnchorX = gesture.startMidClientX - rect.left;
  const startAnchorY = gesture.startMidClientY - rect.top;
  const worldX = (startAnchorX - gesture.startOffsetX) / gesture.startScale;
  const worldY = (startAnchorY - gesture.startOffsetY) / gesture.startScale;

  const distanceRatio = metrics.distance / gesture.startDistance;
  const adjustedRatio = Math.max(0.1, 1 + (distanceRatio - 1) * PINCH_ZOOM_SENSITIVITY);
  state.view.scale = clampNumber(
    gesture.startScale * adjustedRatio,
    state.view.minScale,
    state.view.maxScale,
  );

  const panDeltaX = metrics.midX - gesture.startMidClientX;
  const panDeltaY = metrics.midY - gesture.startMidClientY;
  const zoomOffsetX = startAnchorX - worldX * state.view.scale - gesture.startOffsetX;
  const zoomOffsetY = startAnchorY - worldY * state.view.scale - gesture.startOffsetY;

  // Dual gesture: midpoint movement pans, finger distance changes zoom in/out.
  state.view.offsetX = gesture.startOffsetX + panDeltaX + zoomOffsetX;
  state.view.offsetY = gesture.startOffsetY + panDeltaY + zoomOffsetY;
  applyViewTransform();
  return true;
}

function endTouchGesture() {
  state.view.touchGesture.active = false;
  updateCanvasCursor();
}

function zoomAtClientPoint(clientX, clientY, nextScale) {
  const rect = canvasWrap.getBoundingClientRect();
  const anchorX = clientX - rect.left;
  const anchorY = clientY - rect.top;
  const previousScale = state.view.scale;
  const clampedScale = clampNumber(nextScale, state.view.minScale, state.view.maxScale);
  if (Math.abs(clampedScale - previousScale) < 0.0001) return;

  const worldX = (anchorX - state.view.offsetX) / previousScale;
  const worldY = (anchorY - state.view.offsetY) / previousScale;
  state.view.scale = clampedScale;
  state.view.offsetX = anchorX - worldX * state.view.scale;
  state.view.offsetY = anchorY - worldY * state.view.scale;
  applyViewTransform();
}

function resetView() {
  state.view.scale = getDefaultViewScale();
  centerViewOn(canvas.clientWidth / 2, canvas.clientHeight / 2);
  applyViewTransform();
}

function handleWheel(event) {
  if (isEventFromCanvasOverlayControls(event.target)) return;
  event.preventDefault();
  if (event.ctrlKey) {
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_INTENSITY);
    zoomAtClientPoint(event.clientX, event.clientY, state.view.scale * factor);
    return;
  }
  state.view.offsetX -= event.deltaX;
  state.view.offsetY -= event.deltaY;
  applyViewTransform();
}

function handleKeyDown(event) {
  if (event.code !== "Space") return;
  if (getTargetIsTypingElement(event.target)) return;
  event.preventDefault();
  if (!state.view.spacePressed) {
    state.view.spacePressed = true;
    updateCanvasCursor();
  }
}

function handleKeyUp(event) {
  if (event.code !== "Space") return;
  state.view.spacePressed = false;
  updateCanvasCursor();
}

function getCanvasScale() {
  return 1;
}

function canvasToPngBlob(targetCanvas) {
  return new Promise((resolve, reject) => {
    targetCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("blob_generation_failed"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
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

function getSelectionLayer() {
  if (!state.selection.layerId) return null;
  const layer = getLayerById(state.selection.layerId);
  if (!layer || layer.type !== "raster") return null;
  return layer;
}

function getSelectionHandleAtPoint(pointX, pointY) {
  if (!state.selection.active) return null;
  const left = state.selection.x;
  const right = state.selection.x + state.selection.w;
  const top = state.selection.y;
  const bottom = state.selection.y + state.selection.h;
  const r = SELECTION_HANDLE_RADIUS;

  const nearLeft = Math.abs(pointX - left) <= r;
  const nearRight = Math.abs(pointX - right) <= r;
  const nearTop = Math.abs(pointY - top) <= r;
  const nearBottom = Math.abs(pointY - bottom) <= r;
  const inVertical = pointY >= top - r && pointY <= bottom + r;
  const inHorizontal = pointX >= left - r && pointX <= right + r;

  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearLeft && inVertical) return "w";
  if (nearRight && inVertical) return "e";
  if (nearTop && inHorizontal) return "n";
  if (nearBottom && inHorizontal) return "s";
  return null;
}

function clearSelectionState() {
  state.selection.active = false;
  state.selection.creating = false;
  state.selection.dragging = false;
  state.selection.resizing = false;
  state.selection.resizeHandle = null;
  state.selection.layerId = null;
  state.selection.x = 0;
  state.selection.y = 0;
  state.selection.w = 0;
  state.selection.h = 0;
  state.selection.layer = null;
  state.selection.baseSnapshot = null;
  state.selection.offsetX = 0;
  state.selection.offsetY = 0;
  state.selection.resizeStartX = 0;
  state.selection.resizeStartY = 0;
  state.selection.resizeStartRect = null;
}

function getTextFamilyCssName(family) {
  if (family === "Paperlogy") {
    return '"Paperlogy", "Pretendard", sans-serif';
  }
  return '"Pretendard", sans-serif';
}

function getTextFontCss() {
  return `${state.text.weight} ${state.text.size}px ${getTextFamilyCssName(state.text.family)}`;
}

function updateEditorVisual() {
  if (!state.text.editorEl) return;
  state.text.editorEl.style.fontFamily = getTextFamilyCssName(state.text.family);
  state.text.editorEl.style.fontWeight = String(state.text.weight);
  state.text.editorEl.style.fontSize = `${state.text.size}px`;
  state.text.editorEl.style.color = state.color;
  positionTextEditor();
}

function closeTextEditor(commit) {
  const editor = state.text.editorEl;
  if (!editor) return;

  const text = editor.value.trim();
  const x = state.text.x;
  const y = state.text.y;
  const editingLayerId = state.text.editingLayerId;

  editor.remove();
  state.text.editorEl = null;
  state.text.editing = false;
  state.text.editingLayerId = null;

  if (!commit) return;

  if (text.length === 0) {
    if (editingLayerId) {
      const index = state.layers.findIndex((candidate) => candidate.id === editingLayerId);
      if (index >= 0) {
        pushHistory();
        state.layers.splice(index, 1);
        if (state.layers.length === 0) {
          const fallback = createRasterLayer("배경 레이어");
          state.layers.push(fallback);
        }
        setActiveLayer(state.layers[Math.max(0, index - 1)].id);
      }
    }
    return;
  }

  pushHistory();
  const existing = editingLayerId ? getLayerById(editingLayerId) : null;
  if (existing && existing.type === "text") {
    existing.text = text;
    existing.name = text;
    existing.x = x;
    existing.y = y;
    existing.color = state.color;
    existing.fontFamily = state.text.family;
    existing.fontWeight = state.text.weight;
    existing.fontSize = state.text.size;
    setActiveLayer(existing.id);
  } else {
    const textLayer = createTextLayer(text, x, y);
    state.layers.push(textLayer);
    setActiveLayer(textLayer.id);
  }
  renderLayersList();
}

function openTextEditor(x, y, editingLayer = null) {
  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }
  if (state.text.editing) {
    closeTextEditor(true);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-editor";
  input.placeholder = "텍스트 입력 후 Enter";

  if (editingLayer && editingLayer.type === "text") {
    state.text.family = editingLayer.fontFamily;
    state.text.weight = editingLayer.fontWeight;
    state.text.size = editingLayer.fontSize;
    state.color = editingLayer.color;
    textFontFamily.value = editingLayer.fontFamily;
    textFontWeight.value = String(editingLayer.fontWeight);
    textSizeSlider.value = String(editingLayer.fontSize);
    colorPicker.value = editingLayer.color;
    input.value = editingLayer.text || "";
    state.text.editingLayerId = editingLayer.id;
  } else {
    state.text.editingLayerId = null;
  }

  state.text.x = clampNumber(x, 0, canvas.clientWidth - 1);
  state.text.y = clampNumber(y, 0, canvas.clientHeight - 1);
  state.text.editorEl = input;
  state.text.editing = true;

  canvasWrap.appendChild(input);
  updateEditorVisual();
  input.focus();

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeTextEditor(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeTextEditor(false);
    }
  });

  input.addEventListener("blur", () => {
    if (state.text.editing) {
      closeTextEditor(true);
    }
  });
}

function editActiveTextLayer() {
  const layer = getActiveLayer();
  if (!layer || layer.type !== "text") return;
  openTextEditor(layer.x, layer.y, layer);
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
  const targetLayer = getSelectionLayer();
  if (!targetLayer || !state.selection.active || !state.selection.baseSnapshot || !state.selection.layer) return;
  targetLayer.ctx.putImageData(state.selection.baseSnapshot, 0, 0);
  targetLayer.ctx.drawImage(state.selection.layer, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
  const left = state.selection.x;
  const right = state.selection.x + state.selection.w;
  const top = state.selection.y;
  const bottom = state.selection.y + state.selection.h;
  const centerX = left + state.selection.w / 2;
  const centerY = top + state.selection.h / 2;
  targetLayer.ctx.save();
  targetLayer.ctx.strokeStyle = "#2563eb";
  targetLayer.ctx.lineWidth = 1;
  targetLayer.ctx.setLineDash([6, 4]);
  targetLayer.ctx.strokeRect(state.selection.x + 0.5, state.selection.y + 0.5, state.selection.w, state.selection.h);
  targetLayer.ctx.setLineDash([]);
  targetLayer.ctx.fillStyle = "#2563eb";
  const handleRadius = 3;
  const handles = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
    [centerX, top],
    [centerX, bottom],
    [left, centerY],
    [right, centerY],
  ];
  for (const [hx, hy] of handles) {
    targetLayer.ctx.beginPath();
    targetLayer.ctx.arc(hx, hy, handleRadius, 0, TAU);
    targetLayer.ctx.fill();
  }
  targetLayer.ctx.fillStyle = "rgba(37, 99, 235, 0.78)";
  targetLayer.ctx.beginPath();
  targetLayer.ctx.arc(centerX, centerY, 4, 0, TAU);
  targetLayer.ctx.fill();
  targetLayer.ctx.restore();
  renderComposite();
}

function commitSelectionToCanvas(clearAfter = true) {
  const targetLayer = getSelectionLayer();
  if (!targetLayer || !state.selection.active || !state.selection.baseSnapshot || !state.selection.layer) {
    if (clearAfter) clearSelectionState();
    return;
  }
  targetLayer.ctx.putImageData(state.selection.baseSnapshot, 0, 0);
  targetLayer.ctx.drawImage(state.selection.layer, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
  if (clearAfter) {
    clearSelectionState();
  }
  renderComposite();
}

function resizeCanvas() {
  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }
  if (state.text.editing) {
    closeTextEditor(true);
  }

  const viewportWidth = Math.max(1, canvasWrap.clientWidth);
  const viewportHeight = Math.max(1, canvasWrap.clientHeight);
  const prevScale = state.view.scale || 1;
  const previousCenterX = (viewportWidth / 2 - state.view.offsetX) / prevScale;
  const previousCenterY = (viewportHeight / 2 - state.view.offsetY) / prevScale;

  if (!state.world.initialized) {
    state.world.width = Math.max(Math.round(viewportWidth * state.world.scaleFactor), state.world.minWidth);
    state.world.height = Math.max(Math.round(viewportHeight * state.world.scaleFactor), state.world.minHeight);
    state.world.initialized = true;
  } else {
    state.world.width = Math.max(state.world.width, Math.round(viewportWidth * 1.35));
    state.world.height = Math.max(state.world.height, Math.round(viewportHeight * 1.35));
  }
  state.maxHistory = state.world.width * state.world.height > 12000000 ? 5 : 10;
  const dpr = getViewDpr();

  canvas.style.width = `${state.world.width}px`;
  canvas.style.height = `${state.world.height}px`;

  canvas.width = Math.floor(state.world.width * dpr);
  canvas.height = Math.floor(state.world.height * dpr);
  viewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  viewCtx.lineCap = "round";
  viewCtx.lineJoin = "round";

  if (state.layers.length === 0) {
    const baseLayer = createRasterLayer("배경 레이어");
    state.layers.push(baseLayer);
    state.activeLayerId = baseLayer.id;
    state.layerSelection.selectedIds = new Set([baseLayer.id]);
    state.layerSelection.anchorId = baseLayer.id;
    renderLayersList();
  } else {
    resizeRasterLayers();
  }

  const fitScale = Math.max(viewportWidth / canvas.clientWidth, viewportHeight / canvas.clientHeight);
  state.view.minScale = clampNumber(Math.max(0.2, fitScale), 0.1, state.view.maxScale);

  if (!state.view.initialized) {
    state.view.scale = getDefaultViewScale();
    centerViewOn(canvas.clientWidth / 2, canvas.clientHeight / 2);
    state.view.initialized = true;
  } else {
    state.view.scale = clampNumber(state.view.scale, state.view.minScale, state.view.maxScale);
    const centerX = Number.isFinite(previousCenterX) ? previousCenterX : canvas.clientWidth / 2;
    const centerY = Number.isFinite(previousCenterY) ? previousCenterY : canvas.clientHeight / 2;
    centerViewOn(clampNumber(centerX, 0, canvas.clientWidth), clampNumber(centerY, 0, canvas.clientHeight));
  }

  applyViewTransform();
  if (state.panel.manual && layersPanel) {
    const left = Number.parseFloat(layersPanel.style.left);
    const top = Number.parseFloat(layersPanel.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      applyPanelPosition(left, top);
    }
  }
  renderComposite(true);
}

function setTool(tool) {
  if (state.tool === "text" && tool !== "text" && state.text.editing) {
    closeTextEditor(true);
  }
  if (state.tool === "select" && tool !== "select") {
    state.layerDrag.active = false;
    state.layerDrag.pointerId = null;
    state.layerDrag.historyPushed = false;
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
  textWeightValue.textContent = `${state.text.weight}`;
  textSizeValue.textContent = `${state.text.size}px`;
  toolButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === state.tool);
  });
  swatchButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.color.toLowerCase() === state.color.toLowerCase());
  });
  strokeModeButton.classList.toggle("active", !state.shapeFill);
  fillModeButton.classList.toggle("active", state.shapeFill);
  if (deleteLayerButton) {
    deleteLayerButton.disabled = state.layers.length <= 1;
  }
  if (mergeLayersButton) {
    mergeLayersButton.disabled = getSelectedLayerIds().length < 2;
  }
  updateEditorVisual();
  syncLayerTextPanel();
  updateCanvasCursor();
}

function captureRasterImageData(layer, includeSelection = false) {
  if (!layer || layer.type !== "raster" || !layer.canvas || !layer.ctx) return null;
  if (
    !includeSelection ||
    !state.selection.active ||
    state.selection.layerId !== layer.id ||
    !state.selection.baseSnapshot ||
    !state.selection.layer
  ) {
    return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  }
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = layer.canvas.width;
  tempCanvas.height = layer.canvas.height;
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  tempCtx.putImageData(state.selection.baseSnapshot, 0, 0);
  tempCtx.drawImage(state.selection.layer, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
  return tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
}

function pushHistory(options = {}) {
  const preserveSelection = Boolean(options.preserveSelection);
  const targetLayerId = Number.isFinite(options.layerId) ? options.layerId : null;
  if (state.selection.active && !preserveSelection) {
    commitSelectionToCanvas(true);
  }
  const layer = targetLayerId !== null ? getLayerById(targetLayerId) : getActiveLayer();
  if (!layer) return;
  try {
    let snapshot;
    if (layer.type === "raster") {
      const imageData = captureRasterImageData(layer, preserveSelection);
      if (!imageData) return;
      snapshot = {
        kind: "raster",
        layerId: layer.id,
        x: layer.x,
        y: layer.y,
        imageData,
      };
    } else {
      snapshot = {
        kind: "text",
        layerId: layer.id,
        x: layer.x,
        y: layer.y,
        text: layer.text,
        color: layer.color,
        fontFamily: layer.fontFamily,
        fontWeight: layer.fontWeight,
        fontSize: layer.fontSize,
      };
    }
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
  const width = rect.width || 1;
  const height = rect.height || 1;
  const rawX = ((event.clientX - rect.left) / width) * canvas.clientWidth;
  const rawY = ((event.clientY - rect.top) / height) * canvas.clientHeight;
  return {
    x: clampNumber(rawX, 0, canvas.clientWidth),
    y: clampNumber(rawY, 0, canvas.clientHeight),
  };
}

function getPointUnclamped(event) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: ((event.clientX - rect.left) / width) * canvas.clientWidth,
    y: ((event.clientY - rect.top) / height) * canvas.clientHeight,
  };
}

function toLayerLocal(point, layer = getActiveLayer()) {
  if (!layer) return { x: point.x, y: point.y };
  return {
    x: point.x - (layer.x || 0),
    y: point.y - (layer.y || 0),
  };
}

function keepPointInteractive(event) {
  const rect = canvasWrap.getBoundingClientRect();
  const rawX = (event.clientX - rect.left - state.view.offsetX) / state.view.scale;
  const rawY = (event.clientY - rect.top - state.view.offsetY) / state.view.scale;
  let moved = false;

  if (rawX < 0) {
    state.view.offsetX += rawX * state.view.scale;
    moved = true;
  } else if (rawX > canvas.clientWidth) {
    state.view.offsetX += (rawX - canvas.clientWidth) * state.view.scale;
    moved = true;
  }

  if (rawY < 0) {
    state.view.offsetY += rawY * state.view.scale;
    moved = true;
  } else if (rawY > canvas.clientHeight) {
    state.view.offsetY += (rawY - canvas.clientHeight) * state.view.scale;
    moved = true;
  }

  if (moved) {
    applyViewTransform();
  }
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

function createSelectionLayer(targetLayer, rect) {
  const sx = Math.round(rect.x);
  const sy = Math.round(rect.y);
  const sw = Math.max(1, Math.round(rect.w));
  const sh = Math.max(1, Math.round(rect.h));
  const imageData = targetLayer.ctx.getImageData(sx, sy, sw, sh);
  const layer = document.createElement("canvas");
  layer.width = sw;
  layer.height = sh;
  layer.getContext("2d").putImageData(imageData, 0, 0);
  return layer;
}

function beginSelectionFromRect(targetLayer, rect) {
  const layer = createSelectionLayer(targetLayer, rect);
  targetLayer.ctx.clearRect(rect.x, rect.y, rect.w, rect.h);

  state.selection.active = true;
  state.selection.creating = false;
  state.selection.dragging = false;
  state.selection.resizing = false;
  state.selection.resizeHandle = null;
  state.selection.layerId = targetLayer.id;
  state.selection.x = rect.x;
  state.selection.y = rect.y;
  state.selection.w = rect.w;
  state.selection.h = rect.h;
  state.selection.layer = layer;
  state.selection.baseSnapshot = targetLayer.ctx.getImageData(0, 0, targetLayer.canvas.width, targetLayer.canvas.height);
  state.selection.offsetX = 0;
  state.selection.offsetY = 0;
  state.selection.resizeStartX = 0;
  state.selection.resizeStartY = 0;
  state.selection.resizeStartRect = null;

  renderFloatingSelection();
}

function isEventFromCanvasOverlayControls(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest(".layers-panel")) return true;
  if (state.text.editorEl && (target === state.text.editorEl || state.text.editorEl.contains(target))) return true;
  return false;
}

function beginDraw(event) {
  if (isEventFromCanvasOverlayControls(event.target)) {
    return;
  }
  if (event.pointerType === "touch") {
    event.preventDefault();
    state.view.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      canvasWrap.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    if (state.view.touchPoints.size >= 2) {
      beginTouchGesture();
      return;
    }
  }

  if (shouldStartPan(event)) {
    event.preventDefault();
    startPan(event);
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  keepPointInteractive(event);
  const worldPoint = getPoint(event);
  const activeLayer = getActiveLayer();

  if (state.tool === "select") {
    if (!activeLayer) return;
    if (event.pointerType === "mouse" && event.detail >= 2 && activeLayer.type === "text") {
      editActiveTextLayer();
      return;
    }
    state.drawing = true;
    state.pointerId = event.pointerId;
    canvasWrap.setPointerCapture(event.pointerId);

    if (activeLayer.type === "text") {
      state.layerDrag.active = true;
      state.layerDrag.pointerId = event.pointerId;
      state.layerDrag.startPointerX = worldPoint.x;
      state.layerDrag.startPointerY = worldPoint.y;
      state.layerDrag.startLayerX = activeLayer.x || 0;
      state.layerDrag.startLayerY = activeLayer.y || 0;
      state.layerDrag.historyPushed = false;
      return;
    }

    const p = toLayerLocal(worldPoint, activeLayer);
    state.startX = p.x;
    state.startY = p.y;
    state.lastX = p.x;
    state.lastY = p.y;

    if (state.selection.active && state.selection.layerId !== activeLayer.id) {
      commitSelectionToCanvas(true);
    }

    if (state.selection.active && state.selection.layerId === activeLayer.id) {
      const handle = getSelectionHandleAtPoint(p.x, p.y);
      if (handle) {
        pushHistory({ preserveSelection: true, layerId: activeLayer.id });
        state.selection.resizing = true;
        state.selection.resizeHandle = handle;
        state.selection.resizeStartX = p.x;
        state.selection.resizeStartY = p.y;
        state.selection.resizeStartRect = {
          x: state.selection.x,
          y: state.selection.y,
          w: state.selection.w,
          h: state.selection.h,
        };
        return;
      }

      const centerInset = Math.min(SELECTION_HANDLE_RADIUS, Math.max(2, Math.min(state.selection.w, state.selection.h) / 3));
      const centerRect = {
        x: state.selection.x + centerInset,
        y: state.selection.y + centerInset,
        w: Math.max(0, state.selection.w - centerInset * 2),
        h: Math.max(0, state.selection.h - centerInset * 2),
      };
      const canDragSelection = pointInRect(p.x, p.y, centerRect) || (centerRect.w < 1 && centerRect.h < 1 && pointInRect(p.x, p.y, state.selection));
      if (canDragSelection) {
        pushHistory({ preserveSelection: true, layerId: activeLayer.id });
        state.selection.dragging = true;
        state.selection.offsetX = p.x - state.selection.x;
        state.selection.offsetY = p.y - state.selection.y;
        return;
      }

      commitSelectionToCanvas(true);
    }

    state.selection.creating = true;
    state.previewSnapshot = activeLayer.ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
    return;
  }

  if (state.tool === "text") {
    if (activeLayer && activeLayer.type === "text" && event.pointerType === "mouse" && event.detail >= 2) {
      editActiveTextLayer();
      return;
    }
    openTextEditor(worldPoint.x, worldPoint.y);
    return;
  }

  const rasterLayer = ensureActiveRasterLayer();
  const p = toLayerLocal(worldPoint, rasterLayer);

  state.drawing = true;
  state.pointerId = event.pointerId;
  state.startX = p.x;
  state.startY = p.y;
  state.lastX = p.x;
  state.lastY = p.y;
  state.lastShiftKey = event.shiftKey;
  canvasWrap.setPointerCapture(event.pointerId);

  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }

  pushHistory();

  if (SHAPE_TOOLS.has(state.tool)) {
    state.previewSnapshot = ctx.getImageData(0, 0, rasterLayer.canvas.width, rasterLayer.canvas.height);
    return;
  }

  applyStrokeStyle();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + 0.001, p.y + 0.001);
  ctx.stroke();
  renderComposite();
}

function draw(event) {
  if (event.pointerType === "touch" && state.view.touchPoints.has(event.pointerId)) {
    state.view.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.view.touchGesture.active || state.view.touchPoints.size >= 2) {
      event.preventDefault();
      updateTouchGesture();
      return;
    }
  }

  if (state.view.panning) {
    if (event.pointerId !== state.view.panPointerId) return;
    event.preventDefault();
    state.view.offsetX = state.view.panStartOffsetX + (event.clientX - state.view.panStartClientX);
    state.view.offsetY = state.view.panStartOffsetY + (event.clientY - state.view.panStartClientY);
    applyViewTransform();
    return;
  }
  if (!state.drawing || event.pointerId !== state.pointerId) return;
  event.preventDefault();
  keepPointInteractive(event);
  const worldPoint = getPoint(event);
  const worldPointUnclamped = getPointUnclamped(event);

  if (state.tool === "select") {
    const layer = getActiveLayer();
    if (!layer) return;

    if (layer.type === "text" && state.layerDrag.active) {
      const deltaX = worldPointUnclamped.x - state.layerDrag.startPointerX;
      const deltaY = worldPointUnclamped.y - state.layerDrag.startPointerY;
      if (!state.layerDrag.historyPushed && (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5)) {
        pushHistory();
        state.layerDrag.historyPushed = true;
      }
      layer.x = state.layerDrag.startLayerX + deltaX;
      layer.y = state.layerDrag.startLayerY + deltaY;
      renderComposite();
      return;
    }

    if (layer.type !== "raster") return;
    const p = toLayerLocal(worldPoint, layer);
    const pUnclamped = toLayerLocal(worldPointUnclamped, layer);
    const clampedP = {
      x: clampNumber(p.x, 0, layer.canvas.width),
      y: clampNumber(p.y, 0, layer.canvas.height),
    };

    if (state.selection.creating) {
      if (!state.previewSnapshot) return;
      layer.ctx.putImageData(state.previewSnapshot, 0, 0);
      const rect = normalizeRect(state.startX, state.startY, clampedP.x, clampedP.y);
      layer.ctx.save();
      layer.ctx.strokeStyle = "#2563eb";
      layer.ctx.lineWidth = 1;
      layer.ctx.setLineDash([6, 4]);
      layer.ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
      layer.ctx.restore();
      state.lastX = clampedP.x;
      state.lastY = clampedP.y;
      renderComposite();
      return;
    }

    if (state.selection.dragging && state.selection.layerId === layer.id) {
      state.selection.x = pUnclamped.x - state.selection.offsetX;
      state.selection.y = pUnclamped.y - state.selection.offsetY;
      state.lastX = pUnclamped.x;
      state.lastY = pUnclamped.y;
      renderFloatingSelection();
      return;
    }

    if (state.selection.resizing && state.selection.layerId === layer.id && state.selection.resizeStartRect) {
      const start = state.selection.resizeStartRect;
      const handle = state.selection.resizeHandle || "";
      const dx = pUnclamped.x - state.selection.resizeStartX;
      const dy = pUnclamped.y - state.selection.resizeStartY;
      let left = start.x;
      let right = start.x + start.w;
      let top = start.y;
      let bottom = start.y + start.h;

      if (handle.includes("w")) left += dx;
      if (handle.includes("e")) right += dx;
      if (handle.includes("n")) top += dy;
      if (handle.includes("s")) bottom += dy;

      const minSize = 2;
      if (right - left < minSize) {
        if (handle.includes("w")) left = right - minSize;
        else right = left + minSize;
      }
      if (bottom - top < minSize) {
        if (handle.includes("n")) top = bottom - minSize;
        else bottom = top + minSize;
      }

      state.selection.x = left;
      state.selection.y = top;
      state.selection.w = right - left;
      state.selection.h = bottom - top;
      state.lastX = pUnclamped.x;
      state.lastY = pUnclamped.y;
      renderFloatingSelection();
      return;
    }

    return;
  }

  const layer = getActiveLayer();
  if (!layer || layer.type !== "raster") return;
  const pRaw = toLayerLocal(worldPoint, layer);
  const p = {
    x: clampNumber(pRaw.x, 0, layer.canvas.width),
    y: clampNumber(pRaw.y, 0, layer.canvas.height),
  };
  const prevX = state.lastX;
  const prevY = state.lastY;
  state.lastShiftKey = event.shiftKey;

  if (SHAPE_TOOLS.has(state.tool)) {
    if (!state.previewSnapshot) return;
    const constrained = constrainPoint(state.tool, state.startX, state.startY, p.x, p.y, event.shiftKey);
    ctx.putImageData(state.previewSnapshot, 0, 0);
    drawShape(state.tool, state.startX, state.startY, constrained.x, constrained.y);
    state.lastX = p.x;
    state.lastY = p.y;
    renderComposite();
    return;
  }

  applyStrokeStyle();
  ctx.beginPath();
  ctx.moveTo(prevX, prevY);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  state.lastX = p.x;
  state.lastY = p.y;
  renderComposite();
}

function endDraw(event) {
  if (event && event.pointerType === "touch") {
    state.view.touchPoints.delete(event.pointerId);
    releasePointerCaptureSafe(event.pointerId);
    if (state.view.touchGesture.active) {
      if (state.view.touchPoints.size < 2) {
        endTouchGesture();
      }
      if (!state.drawing) {
        return;
      }
    }
  }

  if (state.view.panning) {
    if (event && state.view.panPointerId !== null && event.pointerId !== state.view.panPointerId) return;
    stopPan();
    return;
  }
  if (!state.drawing) return;
  if (event && state.pointerId !== null && event.pointerId !== state.pointerId) return;

  if (state.tool === "select") {
    const activeLayer = getActiveLayer();
    if (activeLayer && activeLayer.type === "text" && state.layerDrag.active) {
      state.layerDrag.active = false;
      state.layerDrag.pointerId = null;
      state.layerDrag.historyPushed = false;
      renderComposite();
    } else if (activeLayer && activeLayer.type === "raster") {
      if (state.selection.creating && state.previewSnapshot) {
        activeLayer.ctx.putImageData(state.previewSnapshot, 0, 0);
        const endX = Number.isFinite(state.lastX) ? state.lastX : state.startX;
        const endY = Number.isFinite(state.lastY) ? state.lastY : state.startY;
        const rect = normalizeRect(state.startX, state.startY, endX, endY);
        if (rect.w >= 3 && rect.h >= 3) {
          pushHistory();
          beginSelectionFromRect(activeLayer, rect);
        } else {
          renderComposite();
        }
      } else if (state.selection.dragging || state.selection.resizing) {
        state.selection.dragging = false;
        state.selection.resizing = false;
        state.selection.resizeHandle = null;
        state.selection.resizeStartRect = null;
        renderFloatingSelection();
      }
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
    renderComposite();
  }

  state.drawing = false;
  state.previewSnapshot = null;
  state.selection.creating = false;
  releasePointerCaptureSafe(state.pointerId);
  state.pointerId = null;
  ctx.globalCompositeOperation = "source-over";
}

function undo() {
  if (state.text.editing) {
    closeTextEditor(false);
  }
  if (state.selection.active) {
    clearSelectionState();
  }
  const snapshot = state.history.pop();
  if (!snapshot) return;
  const layer = getLayerById(snapshot.layerId);
  if (!layer) return;

  if (snapshot.kind === "raster" && layer.type === "raster" && snapshot.imageData) {
    layer.ctx.putImageData(snapshot.imageData, 0, 0);
    layer.x = snapshot.x || 0;
    layer.y = snapshot.y || 0;
  } else if (snapshot.kind === "text" && layer.type === "text") {
    layer.x = snapshot.x;
    layer.y = snapshot.y;
    layer.text = snapshot.text;
    layer.name = snapshot.text;
    layer.color = snapshot.color;
    layer.fontFamily = snapshot.fontFamily;
    layer.fontWeight = snapshot.fontWeight;
    layer.fontSize = snapshot.fontSize;
  }
  syncLayerTextPanel();
  renderComposite();
}

function clearCanvas() {
  if (state.text.editing) {
    closeTextEditor(true);
  }
  const layer = ensureActiveRasterLayer();
  pushHistory();
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  renderComposite();
}

function savePng() {
  if (state.text.editing) {
    closeTextEditor(true);
  }
  if (state.selection.active) {
    renderFloatingSelection();
  }
  renderComposite(true);
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
    renderComposite(true);
    let sourceCanvas = canvas;

    if (state.selection.active && state.selection.layer) {
      const selectedCanvas = document.createElement("canvas");
      selectedCanvas.width = state.selection.layer.width;
      selectedCanvas.height = state.selection.layer.height;
      const selectedCtx = selectedCanvas.getContext("2d");
      selectedCtx.fillStyle = "#ffffff";
      selectedCtx.fillRect(0, 0, selectedCanvas.width, selectedCanvas.height);
      selectedCtx.drawImage(state.selection.layer, 0, 0);
      sourceCanvas = selectedCanvas;
    } else if (state.selection.active) {
      renderFloatingSelection();
    } else if (state.text.editing) {
      closeTextEditor(true);
    }

    const blob = await canvasToPngBlob(sourceCanvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showStatus(state.selection.active ? "선택 영역을 클립보드에 복사했습니다." : "캔버스를 클립보드에 복사했습니다.");
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
    if (state.text.editing) {
      closeTextEditor(true);
    }
    const image = await loadBlobToImage(blob);
    pushHistory();

    // Paste at native size (100%) regardless of current zoom level.
    const drawWidth = Math.max(1, image.naturalWidth || image.width);
    const drawHeight = Math.max(1, image.naturalHeight || image.height);
    const viewCenterX = (canvasWrap.clientWidth / 2 - state.view.offsetX) / state.view.scale;
    const viewCenterY = (canvasWrap.clientHeight / 2 - state.view.offsetY) / state.view.scale;
    const x = Math.round(viewCenterX - drawWidth / 2);
    const y = Math.round(viewCenterY - drawHeight / 2);

    const rasterLayer = ensureActiveRasterLayer();
    rasterLayer.ctx.drawImage(image, x - (rasterLayer.x || 0), y - (rasterLayer.y || 0));
    renderComposite();
    showStatus("이미지를 활성 레이어에 붙여넣었습니다.");
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

function selectAllOnActiveLayer() {
  if (state.text.editing) {
    closeTextEditor(true);
  }
  const layer = getActiveLayer();
  if (!layer) return;

  setTool("select");
  if (layer.type !== "raster" || !layer.canvas) {
    showStatus("현재 레이어는 영역 선택 대신 이동 모드로 전환했습니다.");
    return;
  }

  if (state.selection.active) {
    commitSelectionToCanvas(true);
  }
  const rect = {
    x: 0,
    y: 0,
    w: layer.canvas.width,
    h: layer.canvas.height,
  };
  if (rect.w < 1 || rect.h < 1) return;
  pushHistory();
  beginSelectionFromRect(layer, rect);
}

function handleShortcuts(event) {
  const isMacLike = navigator.platform.toLowerCase().includes("mac");
  const meta = isMacLike ? event.metaKey : event.ctrlKey;

  if (event.key === "Enter" && state.tool === "select") {
    const layer = getActiveLayer();
    if (layer && layer.type === "text" && !state.text.editing && !getTargetIsTypingElement(event.target)) {
      event.preventDefault();
      editActiveTextLayer();
      return;
    }
  }

  if (event.key === "Escape" && state.selection.active) {
    commitSelectionToCanvas(true);
    return;
  }

  if (!meta) return;
  if (getTargetIsTypingElement(event.target)) return;

  const key = event.key.toLowerCase();
  const zoomInPressed =
    key === "=" ||
    key === "+" ||
    event.code === "Equal" ||
    event.code === "NumpadAdd";
  const zoomOutPressed =
    key === "-" ||
    key === "_" ||
    event.code === "Minus" ||
    event.code === "NumpadSubtract";
  if (key === "c") {
    event.preventDefault();
    copyCanvasToClipboard();
  } else if (key === "a") {
    event.preventDefault();
    selectAllOnActiveLayer();
  } else if (key === "z") {
    event.preventDefault();
    undo();
  } else if (zoomInPressed) {
    event.preventDefault();
    const rect = canvasWrap.getBoundingClientRect();
    zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, state.view.scale * KEYBOARD_ZOOM_STEP);
  } else if (zoomOutPressed) {
    event.preventDefault();
    const rect = canvasWrap.getBoundingClientRect();
    zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, state.view.scale / KEYBOARD_ZOOM_STEP);
  } else if (key === "0") {
    event.preventDefault();
    resetView();
  }
}

function initEvents() {
  canvasWrap.addEventListener("pointerdown", beginDraw, { passive: false });
  canvasWrap.addEventListener("pointermove", draw, { passive: false });
  canvasWrap.addEventListener("pointerup", endDraw);
  canvasWrap.addEventListener("pointerleave", endDraw);
  canvasWrap.addEventListener("pointercancel", endDraw);
  canvasWrap.addEventListener("wheel", handleWheel, { passive: false });
  if (layersPanelHeader) {
    layersPanelHeader.addEventListener("pointerdown", startPanelDrag, { passive: false });
    layersPanelHeader.addEventListener("pointermove", movePanelDrag, { passive: false });
    layersPanelHeader.addEventListener("pointerup", endPanelDrag);
    layersPanelHeader.addEventListener("pointercancel", endPanelDrag);
    layersPanelHeader.addEventListener("lostpointercapture", endPanelDrag);
  }
  window.addEventListener("pointermove", movePanelDrag, { passive: false });
  window.addEventListener("pointerup", endPanelDrag);
  window.addEventListener("pointercancel", endPanelDrag);
  canvasWrap.addEventListener("dblclick", (event) => {
    if (isEventFromCanvasOverlayControls(event.target)) return;
    const activeLayer = getActiveLayer();
    if (activeLayer && activeLayer.type === "text" && (state.tool === "select" || state.tool === "text")) {
      event.preventDefault();
      editActiveTextLayer();
    }
  });

  colorPicker.addEventListener("change", () => {
    state.color = colorPicker.value;
    const activeLayer = getActiveLayer();
    if (activeLayer && activeLayer.type === "text" && !state.text.editing) {
      activeLayer.color = state.color;
      renderComposite();
    }
    if (state.tool === "eraser") {
      setTool("brush");
    }
    updateEditorVisual();
    setToolUI();
  });

  sizeSlider.addEventListener("input", () => {
    state.size = Number(sizeSlider.value);
    setToolUI();
  });

  textFontFamily.addEventListener("change", () => {
    state.text.family = textFontFamily.value;
    const activeLayer = getActiveLayer();
    if (activeLayer && activeLayer.type === "text" && !state.text.editing) {
      activeLayer.fontFamily = state.text.family;
      renderComposite();
    }
    updateEditorVisual();
    setToolUI();
  });

  textFontWeight.addEventListener("input", () => {
    state.text.weight = Number(textFontWeight.value);
    const activeLayer = getActiveLayer();
    if (activeLayer && activeLayer.type === "text" && !state.text.editing) {
      activeLayer.fontWeight = state.text.weight;
      renderComposite();
    }
    updateEditorVisual();
    setToolUI();
  });

  textSizeSlider.addEventListener("input", () => {
    state.text.size = Number(textSizeSlider.value);
    const activeLayer = getActiveLayer();
    if (activeLayer && activeLayer.type === "text" && !state.text.editing) {
      activeLayer.fontSize = state.text.size;
      renderComposite();
    }
    updateEditorVisual();
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
      const activeLayer = getActiveLayer();
      if (activeLayer && activeLayer.type === "text" && !state.text.editing) {
        activeLayer.color = state.color;
        renderComposite();
      }
      if (state.tool === "eraser") {
        setTool("brush");
      } else {
        updateEditorVisual();
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

  undoButton.addEventListener("click", undo);
  clearButton.addEventListener("click", clearCanvas);
  saveButton.addEventListener("click", savePng);
  if (addLayerButton) {
    addLayerButton.addEventListener("click", addRasterLayer);
  }
  if (mergeLayersButton) {
    mergeLayersButton.addEventListener("click", mergeSelectedLayers);
  }
  if (deleteLayerButton) {
    deleteLayerButton.addEventListener("click", deleteActiveLayer);
  }
  if (layersList) {
    layersList.addEventListener("dblclick", (event) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest(".layer-item");
      if (!target) return;
      const layerId = Number(target.dataset.layerId);
      const layer = getLayerById(layerId);
      if (!layer) return;
      setActiveLayer(layer.id);
      if (layer.type === "text") {
        editActiveTextLayer();
      }
    });
  }
  if (layerTextInput) {
    layerTextInput.addEventListener("focus", () => {
      state.panelText.historyPushed = false;
      const layer = getActiveLayer();
      state.panelText.layerId = layer ? layer.id : null;
    });
    layerTextInput.addEventListener("input", () => {
      applyLayerTextFromPanel(false);
    });
    layerTextInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyLayerTextFromPanel(true);
        layerTextInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        syncLayerTextPanel();
        layerTextInput.blur();
      }
    });
    layerTextInput.addEventListener("blur", () => {
      state.panelText.historyPushed = false;
      syncLayerTextPanel();
    });
  }

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keydown", handleShortcuts);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", () => {
    state.view.spacePressed = false;
    state.view.touchPoints.clear();
    if (state.view.touchGesture.active) {
      endTouchGesture();
    }
    if (state.view.panning) {
      stopPan();
    }
    updateCanvasCursor();
  });
  window.addEventListener("paste", handlePasteEvent);
}

resizeCanvas();
setToolUI();
initEvents();
syncLayerTextPanel();
