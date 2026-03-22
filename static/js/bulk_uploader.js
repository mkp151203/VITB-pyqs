import { auth, db, storage, collection, addDoc, getDoc, doc, onAuthStateChanged, ref, uploadBytes, getDownloadURL } from './firebase.js';
import { checkSimilarityWithDatabase } from './similarity.js';

const folderInput = document.getElementById('folder-input');
const bulkImageList = document.getElementById('bulk-image-list');
const queueSummary = document.getElementById('queue-summary');
const selectedList = document.getElementById('selected-list');
const reviewImage = document.getElementById('review-image');
const reviewStatus = document.getElementById('review-status');
const previewPosition = document.getElementById('preview-position');
const reviewForm = document.getElementById('review-form');
const reviewCourse = document.getElementById('review-course');
const reviewExam = document.getElementById('review-exam');
const reviewSlot = document.getElementById('review-slot');
const reviewCourseOptions = document.getElementById('review-course-options');

const btnSelectAll = document.getElementById('btn-select-all');
const btnClearAll = document.getElementById('btn-clear-all');
const btnRemoveSelected = document.getElementById('btn-remove-selected');
const btnProcessSelected = document.getElementById('btn-process-selected');
const btnCancelReview = document.getElementById('btn-cancel-review');
const btnUploadBatch = document.getElementById('btn-upload-batch');
const btnPreviewPrev = document.getElementById('btn-preview-prev');
const btnPreviewNext = document.getElementById('btn-preview-next');

let queue = [];
let selectedIds = new Set();
let selectedOrder = [];
let currentBatch = [];
let currentDetectedText = '';
let courseCatalog = [];
let previewIndex = 0;
const MIN_ALLOWED_DATE_STAMP = 20221025;
let adminVerified = false;

function setBulkControlsDisabled(disabled) {
    [
        folderInput,
        btnSelectAll,
        btnClearAll,
        btnRemoveSelected,
        btnProcessSelected,
        btnCancelReview,
        btnUploadBatch,
        btnPreviewPrev,
        btnPreviewNext,
        reviewCourse,
        reviewExam,
        reviewSlot
    ].forEach((el) => {
        if (el) el.disabled = disabled;
    });
}

async function isAdminUid(uid) {
    if (!db || !uid) return false;
    const adminDoc = await getDoc(doc(db, 'admin_users', uid));
    return adminDoc.exists();
}

function showMsg(msg, type = 'success') {
    const el = document.getElementById('global-message');
    if (!el) return;
    el.innerText = msg;
    el.className = type;
    setTimeout(() => {
        el.innerText = '';
        el.className = '';
    }, 4500);
}

function setButtonLoading(button, loading, loadingText = 'Please wait...') {
    if (!button) return;
    if (loading) {
        if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
        button.innerHTML = loadingText;
        button.classList.add('is-loading');
        button.disabled = true;
    } else {
        if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
        button.classList.remove('is-loading');
        button.disabled = false;
    }
}

function sanitizeText(rawText) {
    return String(rawText || '')
        .replace(/[^A-Za-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractDateKey(name) {
    const match = String(name || '').match(/IMG-(\d{8})-WA(\d+)/i);
    if (!match) return { stamp: 0, seq: 0 };
    return {
        stamp: Number(match[1]) || 0,
        seq: Number(match[2]) || 0
    };
}

function hideDuplicateWarning() {
    const warningEl = document.getElementById('duplicate-warning');
    if (!warningEl) return;
    warningEl.classList.add('hidden');
    warningEl.innerHTML = '';
}

function sortQueue(items) {
    items.sort((a, b) => {
        if (a.dateKey.stamp !== b.dateKey.stamp) return a.dateKey.stamp - b.dateKey.stamp;
        if (a.dateKey.seq !== b.dateKey.seq) return a.dateKey.seq - b.dateKey.seq;
        return a.name.localeCompare(b.name);
    });
}

function fileToPreviewUrl(file) {
    return URL.createObjectURL(file);
}

function parseCourseCode(courseCombined = '') {
    if (courseCombined.includes(' - ')) return courseCombined.split(' - ')[0].trim().toUpperCase();
    return courseCombined.substring(0, 10).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function getSelectedSortedItems() {
    const byId = new Map(queue.map((item) => [item.id, item]));
    return selectedOrder
        .map((id) => byId.get(id))
        .filter(Boolean);
}

function updatePreviewNavigation(selected) {
    const total = selected.length;
    if (!total) {
        previewIndex = 0;
        previewPosition.innerText = '0 / 0';
        btnPreviewPrev.disabled = true;
        btnPreviewNext.disabled = true;
        reviewImage.removeAttribute('src');
        return;
    }

    if (previewIndex < 0) previewIndex = 0;
    if (previewIndex >= total) previewIndex = total - 1;

    const current = selected[previewIndex];
    if (current?.previewUrl) {
        reviewImage.src = current.previewUrl;
    }

    previewPosition.innerText = `${previewIndex + 1} / ${total}`;
    btnPreviewPrev.disabled = previewIndex === 0;
    btnPreviewNext.disabled = previewIndex === total - 1;
}

async function loadCourses() {
    try {
        const res = await fetch('/api/courses');
        if (!res.ok) throw new Error('Failed to fetch courses');
        const list = await res.json();
        if (!Array.isArray(list)) return;
        courseCatalog = list;
        reviewCourseOptions.innerHTML = '';
        list.forEach((course) => {
            const option = document.createElement('option');
            option.value = course;
            reviewCourseOptions.appendChild(option);
        });
    } catch (e) {
        console.warn('Course catalog unavailable:', e);
    }
}

function renderQueue() {
    bulkImageList.innerHTML = '';

    queueSummary.innerText = `${queue.length} image(s) in queue · ${selectedIds.size} selected`;
    if (!queue.length) {
        bulkImageList.innerHTML = '<p>No pending images.</p>';
        selectedList.innerHTML = '';
        reviewStatus.innerText = 'All images processed.';
        reviewForm.classList.add('hidden');
        reviewImage.removeAttribute('src');
        return;
    }

    queue.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'bulk-item';
        const checked = selectedIds.has(item.id) ? 'checked' : '';
        row.innerHTML = `
            <input type="checkbox" data-id="${item.id}" ${checked}>
            <img src="${item.previewUrl}" alt="${item.name}">
            <div class="bulk-item-meta">
                <p><strong>${item.name}</strong></p>
                <p>Date key: ${item.dateKey.stamp || 'N/A'} · Seq: ${item.dateKey.seq || 'N/A'}</p>
            </div>
        `;
        bulkImageList.appendChild(row);
    });

    bulkImageList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-id');
            if (cb.checked) {
                selectedIds.add(id);
                if (!selectedOrder.includes(id)) selectedOrder.push(id);
            } else {
                selectedIds.delete(id);
                selectedOrder = selectedOrder.filter((itemId) => itemId !== id);
            }
            renderSelectedList();
            queueSummary.innerText = `${queue.length} image(s) in queue · ${selectedIds.size} selected`;
        });
    });

    renderSelectedList();
}

function removeSelectedFromQueue() {
    if (!selectedOrder.length) {
        showMsg('No selected images to remove.', 'error');
        return;
    }

    const idsToRemove = new Set(selectedOrder);
    queue
        .filter((item) => idsToRemove.has(item.id))
        .forEach((item) => {
            if (item.previewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(item.previewUrl);
            }
        });

    queue = queue.filter((item) => !idsToRemove.has(item.id));
    selectedIds.clear();
    selectedOrder = [];
    previewIndex = 0;
    hideDuplicateWarning();
    renderQueue();
    showMsg('Selected images removed from queue.', 'success');
}

function renderSelectedList() {
    selectedList.innerHTML = '';
    const selected = getSelectedSortedItems();
    if (!selected.length) {
        selectedList.innerHTML = '<p style="margin:0;color:#777;font-size:0.82rem;">No images selected.</p>';
        updatePreviewNavigation([]);
        return;
    }

    selected.forEach((item, index) => {
        const chip = document.createElement('div');
        chip.className = 'bulk-selected-chip';
        chip.innerText = `${index + 1}. ${item.name}`;
        chip.style.cursor = 'pointer';
        chip.addEventListener('click', () => {
            previewIndex = index;
            updatePreviewNavigation(selected);
        });
        selectedList.appendChild(chip);
    });

    updatePreviewNavigation(selected);
    reviewStatus.innerText = 'Use Previous/Next to scroll selected image previews. Click Process Selected to run OCR on the first selected image.';
}

folderInput.addEventListener('change', async (e) => {
    if (!adminVerified) {
        showMsg('Admin access required for bulk uploader.', 'error');
        return;
    }

    const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
        showMsg('No images found in selected folder.', 'error');
        return;
    }

    setButtonLoading(btnProcessSelected, true, 'Loading folder...');
    try {
        const items = await Promise.all(files.map(async (file, idx) => ({
            id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
            file,
            name: file.name,
            dateKey: extractDateKey(file.name),
            previewUrl: fileToPreviewUrl(file)
        })));

        const filteredItems = items.filter((item) => item.dateKey.stamp >= MIN_ALLOWED_DATE_STAMP);
        const removedCount = items.length - filteredItems.length;

        sortQueue(filteredItems);
        queue = filteredItems;
        selectedIds = new Set();
        selectedOrder = [];
        currentBatch = [];
        currentDetectedText = '';
        hideDuplicateWarning();
        reviewForm.classList.add('hidden');
        reviewImage.removeAttribute('src');
        reviewStatus.innerText = removedCount > 0
            ? `${removedCount} image(s) skipped before IMG-${MIN_ALLOWED_DATE_STAMP}. Select images and click Process Selected.`
            : 'Select images and click Process Selected.';
        renderQueue();
    } finally {
        setButtonLoading(btnProcessSelected, false);
    }
});

btnSelectAll.addEventListener('click', () => {
    if (!adminVerified) return;
    selectedIds = new Set();
    selectedOrder = [];
    queue.forEach((item) => {
        selectedIds.add(item.id);
        selectedOrder.push(item.id);
    });
    renderQueue();
});

btnClearAll.addEventListener('click', () => {
    if (!adminVerified) return;
    selectedIds.clear();
    selectedOrder = [];
    renderQueue();
});

btnRemoveSelected.addEventListener('click', () => {
    if (!adminVerified) return;
    removeSelectedFromQueue();
});

btnCancelReview.addEventListener('click', () => {
    if (!adminVerified) return;
    reviewForm.classList.add('hidden');
    reviewStatus.innerText = 'Batch review canceled. Adjust selection and process again.';
    currentBatch = [];
    currentDetectedText = '';
    hideDuplicateWarning();
    updatePreviewNavigation(getSelectedSortedItems());
});

btnPreviewPrev.addEventListener('click', () => {
    if (!adminVerified) return;
    const selected = getSelectedSortedItems();
    if (!selected.length || previewIndex <= 0) return;
    previewIndex -= 1;
    updatePreviewNavigation(selected);
});

btnPreviewNext.addEventListener('click', () => {
    if (!adminVerified) return;
    const selected = getSelectedSortedItems();
    if (!selected.length || previewIndex >= selected.length - 1) return;
    previewIndex += 1;
    updatePreviewNavigation(selected);
});

btnProcessSelected.addEventListener('click', async () => {
    if (!adminVerified) {
        showMsg('Admin access required for bulk uploader.', 'error');
        return;
    }

    const selected = getSelectedSortedItems();
    if (!selected.length) {
        showMsg('Select at least one image first.', 'error');
        return;
    }

    currentBatch = [...selected];
    previewIndex = 0;
    updatePreviewNavigation(currentBatch);

    setButtonLoading(btnProcessSelected, true, 'Detecting...');
    reviewForm.classList.add('hidden');
    hideDuplicateWarning();
    try {
        const first = currentBatch[0];
        reviewStatus.innerText = `Running OCR on first selected image: ${first.name}`;

        const ocrResult = await Tesseract.recognize(first.previewUrl, 'eng');
        currentDetectedText = sanitizeText(ocrResult?.data?.text || '');

        const parseRes = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: currentDetectedText })
        });

        if (!parseRes.ok) throw new Error('Course parse failed');
        const parsed = await parseRes.json();

        reviewCourse.value = parsed.course_combined || '';
        reviewExam.value = parsed.exam_name || '';
        if (reviewCourse.value && currentDetectedText) {
            await checkSimilarityWithDatabase(reviewCourse.value, currentDetectedText);
        }
        reviewStatus.innerText = 'Review detected course/exam and upload batch.';
        reviewForm.classList.remove('hidden');
    } catch (e) {
        console.error(e);
        showMsg('Detection failed. You can still enter course/exam manually.', 'error');
        reviewStatus.innerText = 'Detection failed. Fill course/exam manually.';
        reviewCourse.value = '';
        reviewExam.value = '';
        reviewForm.classList.remove('hidden');
    } finally {
        setButtonLoading(btnProcessSelected, false);
    }
});

reviewCourse.addEventListener('change', async () => {
    if (!adminVerified) return;
    const course = (reviewCourse.value || '').trim();
    if (!course || !currentDetectedText) {
        hideDuplicateWarning();
        return;
    }
    await checkSimilarityWithDatabase(course, currentDetectedText);
});

async function buildPdfFromBatch(batch) {
    const { jsPDF } = window.jspdf;

    const getImgDimensions = (dataUrl) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = dataUrl;
    });

    const toJpegDataUrl = (dataUrl, quality = 0.75) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(img, 0, 0);
            resolve({ jpegUrl: canvas.toDataURL('image/jpeg', quality), w: canvas.width, h: canvas.height });
        };
        img.src = dataUrl;
    });

    const firstDims = await getImgDimensions(batch[0].previewUrl);
    const orientation = firstDims.w >= firstDims.h ? 'landscape' : 'portrait';
    const doc = new jsPDF({ orientation, unit: 'px', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    for (let index = 0; index < batch.length; index++) {
        if (index > 0) doc.addPage();
        const { jpegUrl, w, h } = await toJpegDataUrl(batch[index].previewUrl, 0.72);
        const scale = Math.min(pageW / w, pageH / h);
        const imgW = w * scale;
        const imgH = h * scale;
        const x = (pageW - imgW) / 2;
        const y = (pageH - imgH) / 2;
        doc.addImage(jpegUrl, 'JPEG', x, y, imgW, imgH, undefined, 'FAST');
    }

    return doc.output('blob');
}

btnUploadBatch.addEventListener('click', async () => {
    if (!adminVerified) {
        showMsg('Admin access required for bulk uploader.', 'error');
        return;
    }

    if (!db || !storage) {
        showMsg('Firebase is not configured.', 'error');
        return;
    }

    if (!currentBatch.length) {
        showMsg('No active batch. Click Process Selected first.', 'error');
        return;
    }

    const courseCombined = (reviewCourse.value || '').trim();
    const examName = (reviewExam.value || '').trim();
    const slotInfo = ((reviewSlot?.value || '').trim() || 'NA').toUpperCase();
    if (!courseCombined) {
        showMsg('Course is required.', 'error');
        return;
    }
    if (!examName) {
        showMsg('Exam type is required.', 'error');
        return;
    }

    setButtonLoading(btnUploadBatch, true, 'Uploading...');
    try {
        const total = currentBatch.length;
        const courseCode = parseCourseCode(courseCombined) || 'UNKNOWN';
        let fileType = 'pdf';
        let fileUrl = '';

        if (total === 1) {
            const response = await fetch(currentBatch[0].previewUrl);
            const imageBlob = await response.blob();
            const safeName = `${courseCode}_${examName.replace(/[^A-Za-z0-9]/g, '')}_${Date.now()}.webp`;
            const fileRef = ref(storage, `papers_images/${safeName}`);
            await uploadBytes(fileRef, imageBlob, { contentType: imageBlob.type || 'image/webp' });
            fileUrl = await getDownloadURL(fileRef);
            fileType = 'image';
        } else {
            const pdfBlob = await buildPdfFromBatch(currentBatch);
            const safeName = `${courseCode}_${examName.replace(/[^A-Za-z0-9]/g, '')}_${Date.now()}.pdf`;
            const fileRef = ref(storage, `papers_pdf/${safeName}`);
            await uploadBytes(fileRef, pdfBlob);
            fileUrl = await getDownloadURL(fileRef);
            fileType = 'pdf';
        }

        await addDoc(collection(db, 'question_papers_multi'), {
            courseTitle: courseCombined,
            courseCode,
            examName,
            slot: slotInfo,
            fullExtractedText: currentDetectedText || '',
            pageCount: total,
            fileType,
            fileUrl,
            createdAt: new Date().toISOString()
        });

        const processedIds = new Set(currentBatch.map((item) => item.id));
        queue
            .filter((item) => processedIds.has(item.id))
            .forEach((item) => {
                if (item.previewUrl?.startsWith('blob:')) {
                    URL.revokeObjectURL(item.previewUrl);
                }
            });
        queue = queue.filter((item) => !processedIds.has(item.id));
        selectedIds = new Set();
        selectedOrder = [];
        currentBatch = [];
        currentDetectedText = '';
        hideDuplicateWarning();
        reviewForm.classList.add('hidden');
        reviewStatus.innerText = 'Batch uploaded. Select next images to process.';
        reviewImage.removeAttribute('src');
        renderQueue();
        showMsg('Batch uploaded successfully.', 'success');
    } catch (e) {
        console.error(e);
        showMsg(`Upload failed: ${e.message || 'Unknown error'}`, 'error');
    } finally {
        setButtonLoading(btnUploadBatch, false);
    }
});

setBulkControlsDisabled(true);
reviewStatus.innerText = 'Checking admin access...';

if (!auth) {
    showMsg('Firebase auth is not configured.', 'error');
    reviewStatus.innerText = 'Firebase auth is not configured.';
} else {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = '/admin';
            return;
        }

        try {
            const isAdmin = await isAdminUid(user.uid);
            if (!isAdmin) {
                window.location.href = '/admin';
                return;
            }

            adminVerified = true;
            setBulkControlsDisabled(false);
            reviewStatus.innerText = 'Admin verified. Select images and click Process Selected.';
            await loadCourses();
        } catch (error) {
            console.error('Admin verification failed:', error);
            window.location.href = '/admin';
        }
    });
}
