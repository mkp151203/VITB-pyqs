// crop.js — Perspective-transform crop engine with rotation + edge handles

// State
let cropCanvas = document.getElementById('crop-canvas');
let ctx = cropCanvas.getContext('2d');
let currentImg = new Image();
let cropPoints = [];
let imgScaleX=1, imgScaleY=1, offsetX=0, offsetY=0;
let currentCropId = null;

// Corner handles: TL=0, TR=1, BR=2, BL=3
const handles = [
    document.getElementById('handle-tl'),
    document.getElementById('handle-tr'),
    document.getElementById('handle-br'),
    document.getElementById('handle-bl')
];

// Edge handles: top=0, right=1, bottom=2, left=3
// Each moves both corners that share that edge
const edgeHandles = [
    document.getElementById('handle-top'),
    document.getElementById('handle-right'),
    document.getElementById('handle-bottom'),
    document.getElementById('handle-left')
];

// Edge index → which two corner indices it connects
// top: TL(0)+TR(1), right: TR(1)+BR(2), bottom: BR(2)+BL(3), left: BL(3)+TL(0)
const EDGE_CORNERS = [[0,1],[1,2],[2,3],[3,0]];

// Drag state
// type: 'corner' | 'edge' | null
let dragType = null;
let dragIndex = -1;
// For edge drag: store the two corners' start positions and the pointer start
let edgeDragStart = null; // { c0: {x,y}, c1: {x,y}, px, py }

let pendingCroppedDataUrl = null;
let pendingBlob = null;

// Dependencies injected by upload.js
let _pagesArray = null;
let _showView = null;
let _renderArrangeGrid = null;

export function init(pagesArray, showView, renderArrangeGrid) {
    _pagesArray = pagesArray;
    _showView = showView;
    _renderArrangeGrid = renderArrangeGrid;
}

export function openCropView(pageId) {
    currentCropId = pageId;
    const page = _pagesArray.find(p => p.id === pageId);
    _showView('crop');
    
    document.getElementById('crop-title').innerText = 'Adjust Corners';
    document.getElementById('crop-actions-1').classList.remove('hidden');
    document.getElementById('crop-actions-2').classList.add('hidden');
    document.getElementById('crop-container').classList.remove('hidden');
    document.getElementById('preview-container').classList.add('hidden');
    
    currentImg.onload = () => {
        resizeCanvasAndRender();
        cropPoints = page.cropPoints
            ? JSON.parse(JSON.stringify(page.cropPoints))
            : getDefaultCorners();
        positionAllHandles();
    };
    currentImg.src = page.originalDataUrl;
}

document.getElementById('btn-cancel-crop').addEventListener('click', () => {
    _showView('arrange');
    currentCropId = null;
});

// ---- Rotation ----
function rotateImage(degrees) {
    document.getElementById('opencv-status').innerText = 'Rotating...';
    const page = _pagesArray.find(p => p.id === currentCropId);
    if(!page) return;

    const canvas = document.createElement('canvas');
    canvas.width = (degrees === 90 || degrees === -90) ? currentImg.height : currentImg.width;
    canvas.height = (degrees === 90 || degrees === -90) ? currentImg.width : currentImg.height;
    const rCtx = canvas.getContext('2d');
    rCtx.translate(canvas.width / 2, canvas.height / 2);
    rCtx.rotate(degrees * Math.PI / 180);
    rCtx.drawImage(currentImg, -currentImg.width / 2, -currentImg.height / 2);
    
    const rotDataUrl = canvas.toDataURL('image/webp', 0.85);
    page.originalDataUrl = rotDataUrl;
    page.displayDataUrl = rotDataUrl;
    page.cropPoints = null;
    page.rotation = (page.rotation || 0) + degrees;
    
    currentImg.onload = () => {
        resizeCanvasAndRender();
        cropPoints = getDefaultCorners();
        positionAllHandles();
        document.getElementById('opencv-status').innerText = 'Ready to adjust corners.';
    };
    currentImg.src = rotDataUrl;
}

document.getElementById('btn-rotate-left').addEventListener('click', () => rotateImage(-90));
document.getElementById('btn-rotate-right').addEventListener('click', () => rotateImage(90));

// ---- Canvas sizing ----
function resizeCanvasAndRender() {
    const container = document.getElementById('crop-container');
    const padding = 20;
    const maxW = Math.max(1, container.clientWidth - padding * 2);
    const maxH = Math.max(1, container.clientHeight - padding * 2);
    const imgRatio = currentImg.width / currentImg.height;
    const contRatio = maxW / maxH;
    let renderW, renderH;
    if (imgRatio > contRatio) { renderW = maxW; renderH = maxW / imgRatio; }
    else { renderH = maxH; renderW = maxH * imgRatio; }
    cropCanvas.width = currentImg.width;
    cropCanvas.height = currentImg.height;
    cropCanvas.style.width = renderW + 'px';
    cropCanvas.style.height = renderH + 'px';
    offsetX = (container.clientWidth - renderW) / 2;
    offsetY = (container.clientHeight - renderH) / 2;
    imgScaleX = renderW / currentImg.width;
    imgScaleY = renderH / currentImg.height;
    ctx.drawImage(currentImg, 0, 0);
}

function getDefaultCorners() {
    const w = currentImg.width, h = currentImg.height;
    return [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
}

// ---- Render overlay ----
function drawOverlay() {
    if (cropPoints.length !== 4) return;
    ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.drawImage(currentImg, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.beginPath();
    ctx.moveTo(cropPoints[0].x, cropPoints[0].y);
    ctx.lineTo(cropPoints[1].x, cropPoints[1].y);
    ctx.lineTo(cropPoints[2].x, cropPoints[2].y);
    ctx.lineTo(cropPoints[3].x, cropPoints[3].y);
    ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.drawImage(currentImg, 0, 0);
    ctx.restore();
    ctx.strokeStyle = '#007aff';
    ctx.lineWidth = Math.max(3, currentImg.width * 0.003);
    ctx.stroke();
}

// ---- Position handles ----
function imgToScreen(pt) {
    return {
        x: offsetX + pt.x * imgScaleX,
        y: offsetY + pt.y * imgScaleY
    };
}

function positionAllHandles() {
    drawOverlay();
    // Corner handles
    cropPoints.forEach((pt, i) => {
        const s = imgToScreen(pt);
        handles[i].style.left = s.x + 'px';
        handles[i].style.top  = s.y + 'px';
    });
    // Edge handles at midpoint of each edge
    EDGE_CORNERS.forEach(([a, b], ei) => {
        const mx = (cropPoints[a].x + cropPoints[b].x) / 2;
        const my = (cropPoints[a].y + cropPoints[b].y) / 2;
        const s = imgToScreen({x: mx, y: my});
        edgeHandles[ei].style.left = s.x + 'px';
        edgeHandles[ei].style.top  = s.y + 'px';
    });
}

// ---- Pointer math ----
function screenToImg(rx, ry) {
    return {
        x: Math.max(0, Math.min((rx - offsetX) / imgScaleX, currentImg.width)),
        y: Math.max(0, Math.min((ry - offsetY) / imgScaleY, currentImg.height))
    };
}

function getClientPos(e) {
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

// ---- Detect which handle was touched ----
const HIT_RADIUS = 44; // px — generous for fingers

function detectHit(screenX, screenY) {
    const containerRect = document.getElementById('crop-container').getBoundingClientRect();
    const px = screenX - containerRect.left;
    const py = screenY - containerRect.top;

    // Corner handles
    let best = -1, minD = HIT_RADIUS;
    handles.forEach((h, i) => {
        const d = Math.hypot(parseFloat(h.style.left) - px, parseFloat(h.style.top) - py);
        if (d < minD) { minD = d; best = i; }
    });
    if (best >= 0) return { type: 'corner', index: best };

    // Edge handles
    minD = HIT_RADIUS;
    let bestE = -1;
    edgeHandles.forEach((h, i) => {
        const d = Math.hypot(parseFloat(h.style.left) - px, parseFloat(h.style.top) - py);
        if (d < minD) { minD = d; bestE = i; }
    });
    if (bestE >= 0) return { type: 'edge', index: bestE };

    return null;
}

// ---- Event listeners ----
const cropContainer = document.getElementById('crop-container');

function onPointerDown(e) {
    const { x, y } = getClientPos(e);
    const hit = detectHit(x, y);
    if (!hit) { dragType = null; return; }

    const containerRect = document.getElementById('crop-container').getBoundingClientRect();
    const px = x - containerRect.left;
    const py = y - containerRect.top;

    dragType = hit.type;
    dragIndex = hit.index;

    if (hit.type === 'edge') {
        const [a, b] = EDGE_CORNERS[hit.index];
        edgeDragStart = {
            c0: {...cropPoints[a]},
            c1: {...cropPoints[b]},
            px, py
        };
    }
}

function onPointerMove(e) {
    if (!dragType) return;
    if (e.cancelable) e.preventDefault();

    const { x, y } = getClientPos(e);
    const containerRect = document.getElementById('crop-container').getBoundingClientRect();
    const rx = x - containerRect.left;
    const ry = y - containerRect.top;

    if (dragType === 'corner') {
        cropPoints[dragIndex] = screenToImg(rx, ry);
    } else if (dragType === 'edge') {
        // Delta in image-space coordinates
        const [a, b] = EDGE_CORNERS[dragIndex];
        const dx = (rx - edgeDragStart.px) / imgScaleX;
        const dy = (ry - edgeDragStart.py) / imgScaleY;

        // Determine which axis this edge primarily moves along
        const isHorizontalEdge = dragIndex === 0 || dragIndex === 2; // top/bottom
        const isVerticalEdge   = dragIndex === 1 || dragIndex === 3; // right/left

        // Move both corners, but constrain each to the relevant axis
        const newA = {...edgeDragStart.c0};
        const newB = {...edgeDragStart.c1};

        if (isHorizontalEdge) {
            // Top/Bottom edge: only move Y
            newA.y = Math.max(0, Math.min(edgeDragStart.c0.y + dy, currentImg.height));
            newB.y = Math.max(0, Math.min(edgeDragStart.c1.y + dy, currentImg.height));
        }
        if (isVerticalEdge) {
            // Left/Right edge: only move X
            newA.x = Math.max(0, Math.min(edgeDragStart.c0.x + dx, currentImg.width));
            newB.x = Math.max(0, Math.min(edgeDragStart.c1.x + dx, currentImg.width));
        }

        cropPoints[a] = newA;
        cropPoints[b] = newB;
    }
    positionAllHandles();
}

function onPointerUp() {
    dragType = null;
    dragIndex = -1;
    edgeDragStart = null;
}

cropContainer.addEventListener('touchstart', onPointerDown, {passive: true});
cropContainer.addEventListener('mousedown',  onPointerDown);
cropContainer.addEventListener('touchmove',  onPointerMove, {passive: false});
cropContainer.addEventListener('mousemove',  onPointerMove);
cropContainer.addEventListener('touchend',   onPointerUp);
cropContainer.addEventListener('mouseup',    onPointerUp);

// ---- Perspective Warp math ----
function getPerspectiveTransform(src, dst) {
    let a = [], b = [];
    for (let i = 0; i < 4; i++) {
        a.push([src[i].x,src[i].y,1,0,0,0,-src[i].x*dst[i].x,-src[i].y*dst[i].x]);
        a.push([0,0,0,src[i].x,src[i].y,1,-src[i].x*dst[i].y,-src[i].y*dst[i].y]);
        b.push(dst[i].x); b.push(dst[i].y);
    }
    const n = 8;
    for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let j = i+1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[maxRow][i])) maxRow = j;
        [a[i],a[maxRow]] = [a[maxRow],a[i]]; [b[i],b[maxRow]] = [b[maxRow],b[i]];
        for (let j = i+1; j < n; j++) {
            const f = a[j][i]/a[i][i]; b[j] -= f*b[i];
            for (let k = i; k < n; k++) a[j][k] -= f*a[i][k];
        }
    }
    const x = new Array(8).fill(0);
    for (let i = n-1; i >= 0; i--) {
        let s = 0; for (let j = i+1; j < n; j++) s += a[i][j]*x[j];
        x[i] = (b[i]-s)/a[i][i];
    }
    return [...x, 1];
}

// ---- Preview ----
document.getElementById('btn-preview-crop').addEventListener('click', async () => {
    document.getElementById('opencv-status').innerText = 'Flattening image...';
    setTimeout(async () => {
        try {
            const w1 = Math.hypot(cropPoints[0].x-cropPoints[1].x, cropPoints[0].y-cropPoints[1].y);
            const w2 = Math.hypot(cropPoints[3].x-cropPoints[2].x, cropPoints[3].y-cropPoints[2].y);
            const dstW = Math.round(Math.max(w1,w2));
            const h1 = Math.hypot(cropPoints[0].x-cropPoints[3].x, cropPoints[0].y-cropPoints[3].y);
            const h2 = Math.hypot(cropPoints[1].x-cropPoints[2].x, cropPoints[1].y-cropPoints[2].y);
            const dstH = Math.round(Math.max(h1,h2));

            const srcCoords = cropPoints.map(p => ({...p}));
            const dstCoords = [{x:0,y:0},{x:dstW,y:0},{x:dstW,y:dstH},{x:0,y:dstH}];

            const osc = document.createElement('canvas');
            osc.width = currentImg.width; osc.height = currentImg.height;
            const oCtx = osc.getContext('2d', {willReadFrequently:true});
            oCtx.drawImage(currentImg, 0, 0);
            const sData = oCtx.getImageData(0,0,osc.width,osc.height).data;
            const sw = osc.width, sh = osc.height;

            const pc = document.getElementById('preview-canvas');
            pc.width = dstW; pc.height = dstH;
            const pCtx = pc.getContext('2d');
            const dImgData = pCtx.createImageData(dstW, dstH);
            const dData = dImgData.data;

            const M = getPerspectiveTransform(dstCoords, srcCoords);
            for (let y = 0; y < dstH; y++) {
                for (let x = 0; x < dstW; x++) {
                    const den = M[6]*x + M[7]*y + M[8];
                    const sx = Math.round((M[0]*x + M[1]*y + M[2]) / den);
                    const sy = Math.round((M[3]*x + M[4]*y + M[5]) / den);
                    if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
                        const di = (y*dstW+x)*4, si = (sy*sw+sx)*4;
                        dData[di]=sData[si]; dData[di+1]=sData[si+1]; dData[di+2]=sData[si+2]; dData[di+3]=255;
                    }
                }
            }
            pCtx.putImageData(dImgData, 0, 0);

            let quality = 0.85;
            pendingCroppedDataUrl = pc.toDataURL('image/webp', quality);
            let kb = Math.round((pendingCroppedDataUrl.length*0.75)/1024);
            while (kb > 200 && quality > 0.3) { quality -= 0.15; pendingCroppedDataUrl = pc.toDataURL('image/webp', quality); kb = Math.round((pendingCroppedDataUrl.length*0.75)/1024); }
            pendingBlob = await new Promise(res => pc.toBlob(res, 'image/webp', quality));

            document.getElementById('crop-title').innerText = 'Preview';
            document.getElementById('crop-actions-1').classList.add('hidden');
            document.getElementById('crop-actions-2').classList.remove('hidden');
            document.getElementById('crop-container').classList.add('hidden');
            document.getElementById('preview-container').classList.remove('hidden');
            document.getElementById('opencv-status').innerText = 'Ensure document looks correct.';
        } catch(e) {
            console.error(e);
            document.getElementById('opencv-status').innerText = 'Error flattening image.';
        }
    }, 50);
});

document.getElementById('btn-redo-crop').addEventListener('click', () => {
    document.getElementById('crop-title').innerText = 'Adjust Corners';
    document.getElementById('crop-actions-1').classList.remove('hidden');
    document.getElementById('crop-actions-2').classList.add('hidden');
    document.getElementById('crop-container').classList.remove('hidden');
    document.getElementById('preview-container').classList.add('hidden');
});

document.getElementById('btn-apply-crop').addEventListener('click', () => {
    const page = _pagesArray.find(p => p.id === currentCropId);
    page.displayDataUrl = pendingCroppedDataUrl;
    page.croppedBlob = pendingBlob;
    page.cropPoints = JSON.parse(JSON.stringify(cropPoints));
    document.getElementById('opencv-status').innerText = 'Done!';
    _renderArrangeGrid();
    _showView('arrange');
});
