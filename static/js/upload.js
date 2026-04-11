// upload.js — File handling, arrange grid, OCR metadata, PDF generation & Firebase upload
import { db, storage, collection, addDoc, doc, setDoc, updateDoc, serverTimestamp, ref, uploadBytes, getDownloadURL, increment } from './firebase.js';
import { checkSimilarityWithDatabase } from './similarity.js';
import { openCropView, init as initCrop } from './crop.js';
import { getCurrentUser, onAuthChange } from './auth.js';

// === Daily rate limiting (no login needed, localStorage-based) ===
const RATE_LIMIT = 5;
const RATE_KEY = 'pyq_upload_count';
const RATE_DATE_KEY = 'pyq_upload_date';
const SHOW_EXTRACTED_TEXT_PREVIEW = true;
const PENDING_REQUEST_KEY = 'pyq_pending_request';

const GEMINI_LIMIT = 60;
const GEMINI_KEY = 'pyq_gemini_count';
const GEMINI_DATE_KEY = 'pyq_gemini_date';

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

function getGeminiCount() {
    const storedDate = localStorage.getItem(GEMINI_DATE_KEY);
    if (storedDate !== getTodayStr()) {
        localStorage.setItem(GEMINI_DATE_KEY, getTodayStr());
        localStorage.setItem(GEMINI_KEY, '0');
        return 0;
    }
    return parseInt(localStorage.getItem(GEMINI_KEY) || '0', 10);
}

function incrementGeminiCount() {
    const count = getGeminiCount() + 1;
    localStorage.setItem(GEMINI_KEY, String(count));
    localStorage.setItem(GEMINI_DATE_KEY, getTodayStr());
    return count;
}

function checkRateLimit() {
    const user = getCurrentUser();
    const limit = user ? 50 : RATE_LIMIT;
    const count = getUploadCount();
    const banner = document.getElementById('rate-limit-banner');
    const btn = document.getElementById('btn-upload-final');
    
    // Toggle the "Why sign in?" features note based on auth
    const authNote = document.getElementById('auth-features-note');
    if (authNote) {
        if (user) authNote.classList.add('hidden');
        else authNote.classList.remove('hidden');
    }

    if (count >= limit) {
        if (banner) {
            banner.innerHTML = `<span class="material-symbols-outlined">warning</span><span>Daily upload limit reached (${limit}/day). ${user ? '' : 'Sign in to upload up to 50/day!'}</span>`;
            banner.classList.remove('hidden');
        }
        if (btn) btn.disabled = true;
        return false;
    }
    banner?.classList.add('hidden');
    if (btn) btn.disabled = false;
    return true;
}

// Run rate limit check on load & auth change
checkRateLimit();
onAuthChange(() => checkRateLimit());

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
const btnCancelMetadata = document.getElementById('btn-cancel-metadata');
const btnCancelRequestFlow = document.getElementById('btn-cancel-request-flow');
const extractedTextGroup = document.getElementById('extracted-text-group');
const pendingRequestNotice = document.getElementById('pending-request-notice');
const pendingRequestText = document.getElementById('pending-request-text');

function applyExtractedTextVisibility() {
    if (!extractedTextGroup) return;
    extractedTextGroup.classList.toggle('hidden', !SHOW_EXTRACTED_TEXT_PREVIEW);
}

applyExtractedTextVisibility();

function renderPendingRequestNotice(prefill) {
    if (!pendingRequestNotice || !pendingRequestText) return;
    if (prefill?.id) {
        const examText = prefill.examName ? ` · ${prefill.examName}` : '';
        const slotText = prefill.slot ? ` · Slot ${prefill.slot}` : '';
        pendingRequestText.innerText = `Uploading for request: ${prefill.courseCombined || 'Requested paper'}${examText}${slotText}`;
        pendingRequestNotice.classList.remove('hidden');
        return;
    }
    pendingRequestText.innerText = 'Uploading for request';
    pendingRequestNotice.classList.add('hidden');
}

renderPendingRequestNotice(getPendingRequestPrefill());
document.getElementById('tab-upload')?.addEventListener('click', () => {
    renderPendingRequestNotice(getPendingRequestPrefill());
});

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

function sanitizeExtractedText(rawText) {
    return String(rawText || '')
        .replace(/[^A-Za-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPendingRequestPrefill() {
    try {
        const raw = localStorage.getItem(PENDING_REQUEST_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return {
            id: parsed?.id || '',
            courseCombined: String(parsed?.courseCombined || '').trim(),
            examName: String(parsed?.examName || '').trim(),
            slot: String(parsed?.slot || '').trim().toUpperCase()
        };
    } catch {
        return null;
    }
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
        const validFiles = files.filter(f => f.type.startsWith('image/'));
        if (validFiles.length !== files.length) {
            alert("Only image files are allowed. Unsupported files were ignored.");
        }
        files = validFiles;
        if (!files.length) {
            setButtonLoading(primaryBtn, false);
            setButtonLoading(secondaryBtn, false);
            return;
        }

        if (pagesArray.length + files.length > 10) {
            alert("Maximum limit of 10 pages allowed per document. Only the first 10 pages will be kept.");
            files = files.slice(0, Math.max(0, 10 - pagesArray.length));
            if (files.length === 0) {
                setButtonLoading(primaryBtn, false);
                setButtonLoading(secondaryBtn, false);
                return;
            }
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
        let structuredData;
        const geminiCount = getGeminiCount();
        
        if (geminiCount < GEMINI_LIMIT) {
            let parseRes = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: "", image_base64: imageToScan })
            });
            structuredData = await parseRes.json();
            
            if (!structuredData.gemini_api_failed) {
                incrementGeminiCount();
            }
        } else {
            // Force fallback if daily limit reached
            structuredData = { gemini_api_failed: true, limit_reached: true };
        }
        
        if (structuredData.gemini_api_failed) {
            const tempWel = document.getElementById('ocr-warning');
            if (tempWel) {
                 if (structuredData.limit_reached) {
                     tempWel.innerText = `Daily AI analysis limit reached (${GEMINI_LIMIT}/day). Running offline fallback OCR...`;
                 } else {
                     tempWel.innerText = "AI parser busy. Running local Tesseract OCR fallback...";
                 }
                 tempWel.classList.remove('hidden');
            }
            const { data: { text } } = await Tesseract.recognize(imageToScan, 'eng');
            const cleanedText = sanitizeExtractedText(text);
            
            if (geminiCount < GEMINI_LIMIT) {
                // We reached here because Gemini failed for some reason other than quota
                // But we shouldn't burn another quota count for the fallback text structuring.
            }
            
            // Text ONLY fallback — this explicitly disables Gemini on the backend (image_base64="") 
            // and uses the built-in python Regex parsing instead, costing 0 API quota!
            let parseRes = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: cleanedText, image_base64: "" })
            });
            structuredData = await parseRes.json();
        }
        
        let textSource = structuredData.processed_text || "";
        page1.text = textSource;

        const pendingRequest = getPendingRequestPrefill();
        renderPendingRequestNotice(pendingRequest);
        const selectedCourseFromDetection = pendingRequest?.courseCombined || structuredData.course_combined || '';
        const selectedExamFromDetection = pendingRequest?.examName || structuredData.exam_name || '';
        const selectedSlotFromRequest = pendingRequest?.slot || structuredData.slot || '';
        
        document.getElementById('course-title').value = selectedCourseFromDetection;
        if (document.getElementById('course-select-text')) {
            document.getElementById('course-select-text').innerText = selectedCourseFromDetection || 'Select a course...';
        }
        document.getElementById('exam-name').value = selectedExamFromDetection;
        if (selectedSlotFromRequest && selectedSlotFromRequest !== 'NA' && document.getElementById('slot-info')) {
            document.getElementById('slot-info').value = selectedSlotFromRequest;
        }
        document.getElementById('extracted-text-pg1').value = page1.text;
        
        const wEl = document.getElementById('ocr-warning');
        const uploadBtn = document.getElementById('btn-upload-final');
        
        if (structuredData.is_question_paper === false) {
            wEl.innerText = "Image is not a question paper. Upload blocked.";
            wEl.classList.remove('hidden');
            wEl.style.color = "red";
            if (uploadBtn) {
                uploadBtn.disabled = true;
                uploadBtn.style.opacity = '0.5';
                uploadBtn.style.cursor = 'not-allowed';
            }
        } else {
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.style.opacity = '1';
                uploadBtn.style.cursor = 'pointer';
            }
            if (selectedCourseFromDetection) {
                wEl.classList.add('hidden');
                wEl.style.color = "";
                checkSimilarityWithDatabase(selectedCourseFromDetection, textSource);
                if (pendingRequest?.courseCombined) {
                    wEl.innerText = 'Prefilled from selected request. You can still change course/exam before upload.';
                    wEl.classList.remove('hidden');
                }
            } else {
                wEl.innerText = "Course not detected please select a course. Please do not upload any image other than question paper";
                wEl.classList.remove('hidden');
                wEl.style.color = "";
            }
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

btnCancelMetadata?.addEventListener('click', () => {
    const courseDropdown = document.getElementById('course-select-dropdown');
    courseDropdown?.classList.add('hidden');

    if (pagesArray.length > 0) {
        _showView('arrange');
    } else {
        _showView('upload');
    }
});

btnCancelRequestFlow?.addEventListener('click', () => {
    localStorage.removeItem(PENDING_REQUEST_KEY);
    renderPendingRequestNotice(null);

    const warningEl = document.getElementById('ocr-warning');
    if (warningEl && warningEl.innerText.includes('Prefilled from selected request')) {
        warningEl.classList.add('hidden');
        warningEl.innerText = '';
    }

    showMsg('Request fulfillment cancelled. Upload will continue as normal.', 'success');
});

// === Process & Upload File ===
document.getElementById('metadata-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const uploadBtn = document.getElementById('btn-upload-final');
    if (!db || !storage) { showMsg("Firebase is disabled or misconfigured.", "error"); return; }
    
    // Rate limit guard
    if (!checkRateLimit()) {
        const user = getCurrentUser();
        const limit = user ? 50 : 5;
        showMsg(`Daily upload limit of ${limit} reached. Try again tomorrow.`, "error");
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

    const pendingRequest = getPendingRequestPrefill();

    setButtonLoading(uploadBtn, true, uploadBtn?.innerHTML || 'Process All Pages &amp; Upload');
    
    _showView('processing');
    const pTitle = document.getElementById('processing-title');
    const pStatus = document.getElementById('processing-status');
    const pBar = document.getElementById('progress-bar');
    
    try {
        const courseCombined = courseCombinedVal || 'UNKNOWN';
        const examName = document.getElementById('exam-name').value || 'UNKNOWN';
        const slotInfo = ((document.getElementById('slot-info')?.value || '').trim() || 'NA').toUpperCase();
        
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
        
        const currentUser = getCurrentUser();

        const uploadedPaperRef = await addDoc(collection(db, "question_papers_multi"), {
            courseTitle: courseCombined,
            courseCode: courseCode,
            examName: examName,
            slot: slotInfo,
            fullExtractedText: fullExtractedText,
            pageCount: total,
            fileType: fileType,
            fileUrl: downloadUrl,
            uploadedBy: currentUser ? currentUser.uid : null,
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

        if (pendingRequest?.id) {
            try {
                await updateDoc(doc(db, 'paper_requests', pendingRequest.id), {
                    status: 'fulfilled',
                    fulfilledAt: new Date().toISOString(),
                    fulfilledPaperId: uploadedPaperRef.id,
                    fulfilledCourseCombined: courseCombined,
                    fulfilledExamName: examName
                });
            } catch (requestUpdateError) {
                console.warn('Uploaded paper but failed to mark request fulfilled:', requestUpdateError);
            }
        }

        if (currentUser) {
            try {
                const userDocRef = doc(db, 'user_profiles', currentUser.uid);
                await setDoc(userDocRef, { 
                    uploadCount: increment(1),
                    lastActive: new Date().toISOString()
                }, { merge: true });
            } catch (e) {
                console.warn('Failed to increment user metrics:', e);
            }
        }

        localStorage.removeItem(PENDING_REQUEST_KEY);
        renderPendingRequestNotice(null);
        
        // Increment the daily upload counter
        const uploadsToday = incrementUploadCount();
        
        pBar.style.width = '100%';
        pTitle.innerText = "Uploaded!";
        const limit = currentUser ? 50 : 5;
        pStatus.innerText = `Archived successfully! (${uploadsToday}/${limit} uploads today)`;
        
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
