// upload.js — File handling, arrange grid, OCR metadata, PDF generation & Firebase upload
import { db, storage, collection, addDoc, doc, setDoc, serverTimestamp, ref, uploadBytes, getDownloadURL } from './firebase.js';
import { checkSimilarityWithDatabase } from './similarity.js';
import { openCropView, init as initCrop } from './crop.js';

// === Daily rate limiting (no login needed, localStorage-based) ===
const RATE_LIMIT = 20;
const RATE_KEY = 'pyq_upload_count';
const RATE_DATE_KEY = 'pyq_upload_date';

function getTodayStr() {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function getUploadCount() {
    const storedDate = localStorage.getItem(RATE_DATE_KEY);
    if (storedDate !== getTodayStr()) {
        // New day — reset
        localStorage.setItem(RATE_DATE_KEY, getTodayStr());
        localStorage.setItem(RATE_KEY, '0');
        return 0;
    }
    return parseInt(localStorage.getItem(RATE_KEY) || '0', 10);
}

function incrementUploadCount() {
    const count = getUploadCount() + 1;
    localStorage.setItem(RATE_KEY, String(count));
    localStorage.setItem(RATE_DATE_KEY, getTodayStr());
    return count;
}

function checkRateLimit() {
    const count = getUploadCount();
    const banner = document.getElementById('rate-limit-banner');
    const btn = document.getElementById('btn-upload-final');
    if (count >= RATE_LIMIT) {
        banner?.classList.remove('hidden');
        if (btn) btn.disabled = true;
        return false;
    }
    banner?.classList.add('hidden');
    if (btn) btn.disabled = false;
    return true;
}

// Run rate limit check on load
checkRateLimit();

// State
let pagesArray = [];

// DOM Elements
const fileInputMulti = document.getElementById('file-input-multi');
const cameraInput = document.getElementById('camera-input');
const pagesGrid = document.getElementById('pages-grid');
const btnNextMetadata = document.getElementById('btn-next-metadata');
const btnUpload = document.getElementById('btn-upload');
const btnCamera = document.getElementById('btn-camera');
const btnAddGallery = document.getElementById('btn-add-gallery');
const btnAddCamera = document.getElementById('btn-add-camera');

// View management (set from app.js)
let _showView = null;

export function init(showView) {
    _showView = showView;
    initCrop(pagesArray, showView, renderArrangeGrid);
}

export function getPagesArray() { return pagesArray; }

// === Utilities ===
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showMsg(msg, type) {
    const el = document.getElementById('global-message');
    el.innerText = msg;
    el.className = type;
    setTimeout(() => el.innerText='', 4000);
}

function setButtonLoading(button, loading, loadingText = 'Please wait...') {
    if (!button) return;
    if (loading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.innerHTML;
        }
        button.innerHTML = loadingText;
        button.classList.add('is-loading');
        button.disabled = true;
    } else {
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
        }
        button.classList.remove('is-loading');
        button.disabled = false;
    }
}

// === File Selection ===
document.getElementById('btn-camera').addEventListener('click', () => cameraInput.click());
document.getElementById('btn-upload').addEventListener('click', () => fileInputMulti.click());

async function handleFiles(files, fromCamera=false) {
    const primaryBtn = fromCamera ? btnCamera : btnUpload;
    const secondaryBtn = fromCamera ? btnAddCamera : btnAddGallery;

    if (!files.length) return;
    setButtonLoading(primaryBtn, true, fromCamera ? 'Processing...' : 'Uploading...');
    setButtonLoading(secondaryBtn, true, fromCamera ? 'Processing...' : 'Uploading...');
    
    try {
        if (pagesArray.length + files.length > 10) {
            alert("Maximum limit of 10 pages allowed per document. Only the first 10 pages will be kept.");
            files = files.slice(0, Math.max(0, 10 - pagesArray.length));
            if (files.length === 0) return;
        }
        
        let lastAddedId = null;
        for (const file of files) {
            let dataUrl = await fileToDataUrl(file);
            
            dataUrl = await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const maxSize = 1600;
                    let w = img.width;
                    let h = img.height;
                    
                    if (w > maxSize || h > maxSize) {
                        if (w > h) { h = Math.round(h * (maxSize / w)); w = maxSize; }
                        else { w = Math.round(w * (maxSize / h)); h = maxSize; }
                    }
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    
                    let quality = 0.85;
                    let resUrl = canvas.toDataURL('image/webp', quality);
                    let kb = Math.round((resUrl.length * 0.75) / 1024);
                    
                    while (kb > 200 && quality > 0.3) {
                        quality -= 0.15;
                        resUrl = canvas.toDataURL('image/webp', quality);
                        kb = Math.round((resUrl.length * 0.75) / 1024);
                    }
                    
                    while (kb > 200 && w > 800) {
                        w = Math.round(w * 0.85);
                        h = Math.round(h * 0.85);
                        canvas.width = w;
                        canvas.height = h;
                        ctx.drawImage(img, 0, 0, w, h);
                        resUrl = canvas.toDataURL('image/webp', quality);
                        kb = Math.round((resUrl.length * 0.75) / 1024);
                    }

                    resolve(resUrl);
                };
                img.src = dataUrl;
            });

            lastAddedId = 'page_' + Date.now() + Math.random().toString(36).substr(2, 5);
            pagesArray.push({
                id: lastAddedId,
                originalFile: file,
                originalDataUrl: dataUrl,
                displayDataUrl: dataUrl,
                croppedBlob: null,
                cropPoints: null,
                rotation: 0
            });
        }
        fileInputMulti.value = '';
        cameraInput.value = '';
        renderArrangeGrid();
        if (fromCamera && lastAddedId) {
            openCropView(lastAddedId);
        } else {
            _showView('arrange');
        }
    } finally {
        setButtonLoading(primaryBtn, false);
        setButtonLoading(secondaryBtn, false);
    }
}

fileInputMulti.addEventListener('change', (e) => handleFiles(Array.from(e.target.files), false));
cameraInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files), true));

document.getElementById('btn-add-camera').addEventListener('click', () => cameraInput.click());
document.getElementById('btn-add-gallery').addEventListener('click', () => fileInputMulti.click());

function renderArrangeGrid() {
    pagesGrid.innerHTML = '';
    pagesArray.forEach((page, index) => {
        const div = document.createElement('div');
        div.className = 'page-thumb';
        div.dataset.id = page.id;
        
        const approxKB = Math.round((page.displayDataUrl.length * (3/4)) / 1024);
        div.innerHTML = `
            <span class="page-num">${index + 1}</span>
            <span class="size-badge">${approxKB} KB</span>
            <button class="delete-btn" data-delete-id="${page.id}">×</button>
            <img src="${page.displayDataUrl}">
        `;
        div.addEventListener('click', (e) => {
            if(!e.target.classList.contains('delete-btn')) openCropView(page.id);
        });
        pagesGrid.appendChild(div);
    });

    btnNextMetadata.disabled = pagesArray.length === 0;
}

// Event delegation for page deletion
pagesGrid.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-delete-id]');
    if (deleteBtn) {
        e.stopPropagation();
        const id = deleteBtn.dataset.deleteId;
        pagesArray = pagesArray.filter(p => p.id !== id);
        // Sync crop module's reference
        initCrop(pagesArray, _showView, renderArrangeGrid);
        if (pagesArray.length === 0) _showView('upload');
        else renderArrangeGrid();
    }
});

// Enable Drag and Drop Sorting
new Sortable(pagesGrid, {
    animation: 150,
    delay: 250,
    delayOnTouchOnly: false,
    touchStartThreshold: 3,
    onEnd: function(evt) {
        const newArray = [];
        Array.from(pagesGrid.children).forEach(child => {
            const pageId = child.dataset.id;
            newArray.push(pagesArray.find(p => p.id === pageId));
        });
        pagesArray = newArray;
        initCrop(pagesArray, _showView, renderArrangeGrid);
        renderArrangeGrid();
    }
});

// === OCR on Page 1 (Metadata) ===
btnNextMetadata.addEventListener('click', async () => {
    if (pagesArray.length === 0) return;
    setButtonLoading(btnNextMetadata, true, 'Detecting...');
    _showView('metadata');
    document.getElementById('metadata-loading').classList.remove('hidden');
    document.getElementById('metadata-form').classList.add('hidden');
    
    const page1 = pagesArray[0];
    const imageToScan = page1.displayDataUrl;
    
    try {
        const { data: { text } } = await Tesseract.recognize(imageToScan, 'eng');
        page1.text = text;
        
        const parseRes = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        
        const structuredData = await parseRes.json();
        
        document.getElementById('course-title').value = structuredData.course_combined || '';
        if (document.getElementById('course-select-text')) {
            document.getElementById('course-select-text').innerText = structuredData.course_combined || 'Select a course...';
        }
        document.getElementById('exam-name').value = structuredData.exam_name || '';
        document.getElementById('extracted-text-pg1').value = text;
        
        const wEl = document.getElementById('ocr-warning');
        if (structuredData.course_combined) {
            wEl.classList.add('hidden');
            checkSimilarityWithDatabase(structuredData.course_combined, text);
        } else {
            wEl.innerText = "course not detected please select a course. Please do not upload any image other than question paper";
            wEl.classList.remove('hidden');
        }
        
    } catch (e) {
        console.error("Page 1 OCR Failed", e);
        document.getElementById('extracted-text-pg1').value = "OCR Failed or image unreadable.";
    } finally {
        setButtonLoading(btnNextMetadata, false);
    }
    
    document.getElementById('metadata-loading').classList.add('hidden');
    document.getElementById('metadata-form').classList.remove('hidden');
});

document.getElementById('course-title').addEventListener('change', (e) => {
    const courseComb = e.target.value;
    const text = document.getElementById('extracted-text-pg1').value;
    if (courseComb === '__other__') return;
    if (courseComb && text) {
        checkSimilarityWithDatabase(courseComb, text);
    }
});

// === Process & Upload File ===
document.getElementById('metadata-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const uploadBtn = document.getElementById('btn-upload-final');
    if (!db || !storage) { showMsg("Firebase is disabled or misconfigured.", "error"); return; }
    
    // Rate limit guard
    if (!checkRateLimit()) {
        showMsg(`Daily upload limit of ${RATE_LIMIT} reached. Try again tomorrow.`, "error");
        return;
    }
    
    const selectedCourseValue = document.getElementById('course-title').value;
    const isCustomCourse = selectedCourseValue === '__other__';
    const customCourseCode = (document.getElementById('custom-course-code')?.value || '').trim().toUpperCase();
    const customCourseTitle = (document.getElementById('custom-course-title')?.value || '').trim();

    let courseCombinedVal = selectedCourseValue;
    let courseCodeVal = '';

    if (isCustomCourse) {
        if (!customCourseCode || !customCourseTitle) {
            showMsg('Please enter both course code and course title for Other.', 'error');
            return;
        }
        courseCodeVal = customCourseCode;
        courseCombinedVal = `${customCourseCode} - ${customCourseTitle}`;
    }

    if (!courseCombinedVal || courseCombinedVal.trim() === '') {
        showMsg("Course Name is mandatory. Please select a course.", "error");
        return;
    }
    
    const examNameVal = document.getElementById('exam-name').value;
    if (!examNameVal || examNameVal.trim() === '') {
        showMsg("Exam Name is mandatory. Please select an exam.", "error");
        return;
    }

    setButtonLoading(uploadBtn, true, uploadBtn?.innerHTML || 'Process All Pages &amp; Upload');
    
    _showView('processing');
    const pTitle = document.getElementById('processing-title');
    const pStatus = document.getElementById('processing-status');
    const pBar = document.getElementById('progress-bar');
    
    try {
        const courseCombined = courseCombinedVal || 'UNKNOWN';
        const examName = document.getElementById('exam-name').value || 'UNKNOWN';
        
        let courseCode = courseCodeVal || "UNKNOWN";
        if (!courseCodeVal) {
            if (courseCombined.includes(" - ")) courseCode = courseCombined.split(" - ")[0].trim();
            else courseCode = courseCombined.substring(0, 10).replace(/[^A-Za-z0-9]/g, '');
        }

        let fullExtractedText = pagesArray[0].text + "\n\n";

        let total = pagesArray.length;
        pStatus.innerText = `Preparing ${total} pages...`;
        pBar.style.width = '50%';
        
        let downloadUrl = '';
        let fileType = 'pdf';

        if (total === 1) {
            pStatus.innerText = 'Preparing single image upload...';
            pBar.style.width = '68%';

            const response = await fetch(pagesArray[0].displayDataUrl);
            const imageBlob = await response.blob();

            pStatus.innerText = 'Uploading image to Cloud Storage...';
            pBar.style.width = '85%';

            const safeName = `${courseCode}_${examName.replace(/[^A-Za-z0-9]/g,'')}_${Date.now()}.webp`;
            const fileRef = ref(storage, `papers_images/${safeName}`);
            await uploadBytes(fileRef, imageBlob, { contentType: imageBlob.type || 'image/webp' });
            downloadUrl = await getDownloadURL(fileRef);
            fileType = 'image';
        } else {
            pStatus.innerText = `Building PDF with ${total} page(s)...`;
            pBar.style.width = '60%';

            const { jsPDF } = window.jspdf;

            const getImgDimensions = (dataUrl) => new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
                img.src = dataUrl;
            });

            const firstDims = await getImgDimensions(pagesArray[0].displayDataUrl);
            const orientation = firstDims.w >= firstDims.h ? 'landscape' : 'portrait';
            const doc = new jsPDF({ orientation, unit: 'px', format: 'a4', compress: true });
            const pageW = doc.internal.pageSize.getWidth();
            const pageH = doc.internal.pageSize.getHeight();

            const toJpegDataUrl = (dataUrl, quality = 0.75) => new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    resolve({ jpegUrl: canvas.toDataURL('image/jpeg', quality), w: canvas.width, h: canvas.height });
                };
                img.src = dataUrl;
            });

            for (let i = 0; i < total; i++) {
                if (i > 0) doc.addPage();
                const { jpegUrl, w, h } = await toJpegDataUrl(pagesArray[i].displayDataUrl, 0.72);
                const scale = Math.min(pageW / w, pageH / h);
                const imgW = w * scale;
                const imgH = h * scale;
                const x = (pageW - imgW) / 2;
                const y = (pageH - imgH) / 2;
                doc.addImage(jpegUrl, 'JPEG', x, y, imgW, imgH, undefined, 'FAST');
                pStatus.innerText = `Building PDF... page ${i+1}/${total}`;
                pBar.style.width = `${60 + (i / total) * 20}%`;
            }

            const pdfBlob = doc.output('blob');

            pStatus.innerText = 'Uploading PDF to Cloud Storage...';
            pBar.style.width = '85%';
            const safeName = `${courseCode}_${examName.replace(/[^A-Za-z0-9]/g,'')}_${Date.now()}.pdf`;
            const fileRef = ref(storage, `papers_pdf/${safeName}`);
            await uploadBytes(fileRef, pdfBlob);
            downloadUrl = await getDownloadURL(fileRef);
            fileType = 'pdf';
        }
        
        pStatus.innerText = `Finalizing Database...`;
        pBar.style.width = '95%';
        
        await addDoc(collection(db, "question_papers_multi"), {
            courseTitle: courseCombined,
            courseCode: courseCode,
            examName: examName,
            fullExtractedText: fullExtractedText,
            pageCount: total,
            fileType: fileType,
            fileUrl: downloadUrl,
            createdAt: new Date().toISOString()
        });

        if (isCustomCourse) {
            try {
                const catalogId = courseCode.replace(/\//g, '-').replace(/\s+/g, '');
                await setDoc(doc(db, 'courses_catalog', catalogId), {
                    courseCode,
                    courseTitle: customCourseTitle,
                    courseCombined,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } catch (catalogError) {
                console.warn('Unable to sync custom course to courses_catalog:', catalogError);
            }
        }
        
        // Increment the daily upload counter
        const uploadsToday = incrementUploadCount();
        
        pBar.style.width = '100%';
        pTitle.innerText = "Uploaded!";
        pStatus.innerText = `Archived successfully! (${uploadsToday}/${RATE_LIMIT} uploads today)`;
        
        setTimeout(() => {
            pagesArray = [];
            initCrop(pagesArray, _showView, renderArrangeGrid);
            document.getElementById('metadata-form').reset();
            document.getElementById('course-select-text').innerText = 'Select a course...';
            document.getElementById('custom-course-fields')?.classList.add('hidden');
            renderArrangeGrid();
            // Re-check rate limit in case it was the 20th upload
            checkRateLimit();
            // Return to upload view (not search)
            document.getElementById('tab-upload').click();
        }, 2500);

    } catch (e) {
        console.error("Pipeline Error", e);
        pTitle.innerText = "Error Occurred";
        pStatus.innerText = e.message;
        pStatus.style.color = "red";
        setButtonLoading(uploadBtn, false);
    }
});
