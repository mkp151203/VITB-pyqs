import { db, collection, getDocs } from './firebase.js';
import { loadCourseCatalog } from './courses.js';
import { openCollectionModal } from './account.js';

let searchArchives = [];
let groupedBySubject = {};

let currentSearchLevel = 'subject'; 
let currentSelectedSubject = null;
let currentSelectedExam = null;
let currentSelectedSubjectCode = null;

// Pagination state
const SUBJECTS_PER_PAGE = 6;
let currentPage = 1;
let filteredKeys = [];

function getCurrentSearchFilter() {
    return String(document.getElementById('search-input')?.value || '').trim();
}

function pushSearchLevelState(level, extra = {}) {
    window.history.pushState({
        appNav: true,
        tab: 'search',
        searchLevel: level,
        filter: getCurrentSearchFilter(),
        ...extra
    }, '', window.location.href);
}

export async function restoreSearchStateFromHistory(state) {
    const targetLevel = String(state?.searchLevel || 'subject');
    const targetFilter = String(state?.filter || '').toLowerCase();

    if (!Object.keys(groupedBySubject).length) {
        await loadAllSearchablePapers(targetFilter);
    }

    if (targetLevel === 'subject') {
        currentSearchLevel = 'subject';
        currentSelectedSubject = null;
        currentSelectedExam = null;
        currentSelectedSubjectCode = null;
        currentPage = 1;
        renderSubjects(targetFilter);
        return;
    }

    const subjectCode = String(state?.subjectCode || '').trim();
    const subjectData = groupedBySubject[subjectCode];
    if (!subjectData) {
        currentSearchLevel = 'subject';
        currentSelectedSubject = null;
        currentSelectedExam = null;
        currentSelectedSubjectCode = null;
        currentPage = 1;
        renderSubjects(targetFilter);
        return;
    }

    currentSelectedSubject = subjectData;
    currentSelectedSubjectCode = subjectCode;

    if (targetLevel === 'exam') {
        currentSearchLevel = 'exam';
        renderExamTypes();
        return;
    }

    const targetExam = String(state?.examName || '').toLowerCase().includes('mid') ? 'Midterm' : 'Term End';
    currentSearchLevel = 'paper';
    currentSelectedExam = targetExam;
    renderPapersList(targetExam === 'Midterm' ? subjectData.midterm : subjectData.termEnd);
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

function sanitizePart(value = '') {
    return String(value).replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '_') || 'paper';
}

function getNormalizedSlot(paper) {
    const value = String(paper?.slot || paper?.slotInfo || '').trim();
    return value || 'NA';
}

function getPaperExt(paper) {
    const explicitType = (paper.fileType || '').toLowerCase();
    if (explicitType === 'image') return 'webp';
    if (explicitType === 'pdf') return 'pdf';
    const fileUrl = String(paper.fileUrl || '').toLowerCase();
    if (fileUrl.includes('.pdf')) return 'pdf';
    if (fileUrl.includes('.png')) return 'png';
    if (fileUrl.includes('.jpg') || fileUrl.includes('.jpeg')) return 'jpg';
    if (fileUrl.includes('.webp')) return 'webp';
    return 'bin';
}

function buildPaperFileName(paper, index) {
    const ext = getPaperExt(paper);
    const exam = sanitizePart(paper.examName || 'Exam');
    const date = paper.createdAt ? new Date(paper.createdAt).toISOString().slice(0, 10) : 'unknown-date';
    return `${String(index + 1).padStart(2, '0')}_${exam}_${date}.${ext}`;
}

async function fetchPaperBlob(fileUrl) {
    if (!fileUrl) throw new Error('Missing file URL');
    const urlToFetch = fileUrl.includes('firebasestorage.googleapis.com')
        ? `/api/proxy-file?url=${encodeURIComponent(fileUrl)}`
        : fileUrl;
    const response = await fetch(urlToFetch);
    if (!response.ok) throw new Error(`Failed to fetch file (${response.status})`);
    return response.blob();
}

async function downloadPapersZip({ zipName, folders }) {
    if (!window.JSZip) throw new Error('JSZip not loaded');
    const zip = new window.JSZip();

    for (const folderItem of folders) {
        const folder = zip.folder(folderItem.name);
        const papers = folderItem.papers || [];
        for (let i = 0; i < papers.length; i++) {
            const paper = papers[i];
            if (!paper.fileUrl) continue;
            const blob = await fetchPaperBlob(paper.fileUrl);
            folder.file(buildPaperFileName(paper, i), blob);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizePart(zipName)}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export async function loadAllSearchablePapers(initialFilter = '') {
    if (!db) return;
    const grid = document.getElementById('search-results');
    grid.innerHTML = '<div class="loader"></div>';
    
    try {
        const querySnapshot = await getDocs(collection(db, "question_papers_multi"));
        searchArchives = [];
        querySnapshot.forEach(doc => searchArchives.push({ id: doc.id, ...doc.data() }));
        searchArchives.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        const catalog = await loadCourseCatalog();
        
        groupedBySubject = {};
        searchArchives.forEach(p => {
            const key = p.courseCode || 'UNKNOWN';
            if (!groupedBySubject[key]) {
                groupedBySubject[key] = {
                    courseTitle: p.courseTitle || p.courseCode || key,
                    midterm: [],
                    termEnd: []
                };
            }
            if (p.examName && p.examName.toLowerCase().includes('mid')) {
                groupedBySubject[key].midterm.push(p);
            } else {
                groupedBySubject[key].termEnd.push(p);
            }
        });

        catalog.forEach((entry) => {
            const value = String(entry || '').trim();
            if (!value) return;

            let code = value;
            let title = value;
            if (value.includes(' - ')) {
                const split = value.split(' - ');
                code = (split[0] || '').trim() || value;
                title = split.slice(1).join(' - ').trim() || value;
            }

            if (!groupedBySubject[code]) {
                groupedBySubject[code] = {
                    courseTitle: title,
                    midterm: [],
                    termEnd: []
                };
            } else if (!groupedBySubject[code].courseTitle || groupedBySubject[code].courseTitle === code) {
                groupedBySubject[code].courseTitle = title;
            }
        });
        
        currentSearchLevel = 'subject';
        currentPage = 1;
        currentSelectedSubject = null;
        currentSelectedExam = null;
        currentSelectedSubjectCode = null;
        renderSubjects(String(initialFilter || '').toLowerCase());
    } catch(e) {
        grid.innerHTML = '<p class="error">Failed to load archives.</p>';
        console.error(e);
    }
}

function renderSubjects(filterQuery = '') {
    const grid = document.getElementById('search-results');
    grid.innerHTML = '';
    
    document.getElementById('search-navigation').classList.add('hidden');
    document.getElementById('search-bar-container').classList.remove('hidden');
    document.getElementById('search-input').value = filterQuery;
    
    // Build full filtered list
    filteredKeys = Object.keys(groupedBySubject).filter(key => {
        if (!filterQuery) return true;
        const data = groupedBySubject[key];
        return (data.courseTitle + ' ' + key).toLowerCase().includes(filterQuery);
    });

    const totalPages = Math.max(1, Math.ceil(filteredKeys.length / SUBJECTS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;

    const pageKeys = filteredKeys.slice((currentPage - 1) * SUBJECTS_PER_PAGE, currentPage * SUBJECTS_PER_PAGE);

    if (filteredKeys.length === 0) {
        grid.innerHTML = '<p>No subjects found.</p>';
        return;
    }

    pageKeys.forEach(key => {
        const data = groupedBySubject[key];
        const total = data.midterm.length + data.termEnd.length;
        const div = document.createElement('div');
        div.className = 'paper-card';
        div.style.cursor = 'pointer';
        div.innerHTML = `
            <div class="paper-details" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h3>${data.courseTitle}</h3>
                    <p style="margin: 4px 0 0; color:#888; font-size: 0.82rem;">${total} paper${total !== 1 ? 's' : ''} available</p>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn btn-secondary btn-sm" type="button" data-zip-course="${key}">Download ZIP</button>
                    <span class="material-symbols-outlined" style="font-size:1.4rem; color:#ccc; flex-shrink:0;">chevron_right</span>
                </div>
            </div>
        `;
        div.addEventListener('click', (event) => {
            if (event.target.closest('[data-zip-course]')) return;
            currentSearchLevel = 'exam';
            currentSelectedSubject = data;
            currentSelectedSubjectCode = key;
            renderExamTypes();
            pushSearchLevelState('exam', { subjectCode: key });
        });

        const zipCourseBtn = div.querySelector('[data-zip-course]');
        zipCourseBtn?.addEventListener('click', async () => {
            setButtonLoading(zipCourseBtn, true, 'Preparing ZIP...');
            try {
                await downloadPapersZip({
                    zipName: `${key}_${data.courseTitle}_all`,
                    folders: [
                        { name: 'Midterm', papers: data.midterm },
                        { name: 'Term End', papers: data.termEnd }
                    ]
                });
            } catch (error) {
                console.error('Course ZIP failed:', error);
            } finally {
                setButtonLoading(zipCourseBtn, false);
            }
        });
        grid.appendChild(div);
    });

    // Render pagination if more than one page
    if (totalPages > 1) {
        renderPagination(totalPages, filterQuery);
    }
}

function renderPagination(totalPages, filterQuery) {
    const grid = document.getElementById('search-results');
    const nav = document.createElement('div');
    nav.className = 'pagination';

    // Previous button
    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;">chevron_left</span>';
    prev.disabled = currentPage === 1;
    prev.addEventListener('click', () => { currentPage--; renderSubjects(filterQuery); });
    nav.appendChild(prev);

    // Page number buttons (show max 5 pages around current)
    const start = Math.max(1, currentPage - 2);
    const end   = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
        btn.textContent = i;
        const page = i;
        btn.addEventListener('click', () => { currentPage = page; renderSubjects(filterQuery); });
        nav.appendChild(btn);
    }

    // Next button
    const next = document.createElement('button');
    next.className = 'page-btn';
    next.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;">chevron_right</span>';
    next.disabled = currentPage === totalPages;
    next.addEventListener('click', () => { currentPage++; renderSubjects(filterQuery); });
    nav.appendChild(next);

    grid.appendChild(nav);
}

function renderExamTypes() {
    const grid = document.getElementById('search-results');
    grid.innerHTML = '';
    
    document.getElementById('search-navigation').classList.remove('hidden');
    document.getElementById('search-bar-container').classList.add('hidden');
    document.getElementById('search-breadcrumb').innerText = `Subjects / ${currentSelectedSubject.courseTitle}`;
    
    const midDiv = document.createElement('div');
    midDiv.className = 'paper-card';
    midDiv.style.cursor = 'pointer';
    midDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div>
                <h3>Mid-term Exam</h3>
                <p style="color:#888; margin:0; font-size:0.85rem;">${currentSelectedSubject.midterm.length} paper${currentSelectedSubject.midterm.length !== 1 ? 's' : ''}</p>
            </div>
            <button class="btn btn-secondary btn-sm" type="button" data-zip-exam="midterm">Download ZIP</button>
        </div>
    `;
    midDiv.addEventListener('click', () => {
        currentSearchLevel = 'paper';
        currentSelectedExam = 'Midterm';
        renderPapersList(currentSelectedSubject.midterm);
        pushSearchLevelState('paper', { subjectCode: currentSelectedSubjectCode, examName: 'Midterm' });
    });
    const midZipBtn = midDiv.querySelector('[data-zip-exam="midterm"]');
    midZipBtn?.addEventListener('click', async (event) => {
        event.stopPropagation();
        setButtonLoading(midZipBtn, true, 'Preparing ZIP...');
        try {
            await downloadPapersZip({
                zipName: `${currentSelectedSubjectCode || 'course'}_${currentSelectedSubject.courseTitle}_midterm`,
                folders: [{ name: 'Midterm', papers: currentSelectedSubject.midterm }]
            });
        } catch (error) {
            console.error('Midterm ZIP failed:', error);
        } finally {
            setButtonLoading(midZipBtn, false);
        }
    });
    grid.appendChild(midDiv);
    
    const termDiv = document.createElement('div');
    termDiv.className = 'paper-card';
    termDiv.style.cursor = 'pointer';
    termDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div>
                <h3>Term-End Exam</h3>
                <p style="color:#888; margin:0; font-size:0.85rem;">${currentSelectedSubject.termEnd.length} paper${currentSelectedSubject.termEnd.length !== 1 ? 's' : ''}</p>
            </div>
            <button class="btn btn-secondary btn-sm" type="button" data-zip-exam="termend">Download ZIP</button>
        </div>
    `;
    termDiv.addEventListener('click', () => {
        currentSearchLevel = 'paper';
        currentSelectedExam = 'Term End';
        renderPapersList(currentSelectedSubject.termEnd);
        pushSearchLevelState('paper', { subjectCode: currentSelectedSubjectCode, examName: 'Term End' });
    });
    const termZipBtn = termDiv.querySelector('[data-zip-exam="termend"]');
    termZipBtn?.addEventListener('click', async (event) => {
        event.stopPropagation();
        setButtonLoading(termZipBtn, true, 'Preparing ZIP...');
        try {
            await downloadPapersZip({
                zipName: `${currentSelectedSubjectCode || 'course'}_${currentSelectedSubject.courseTitle}_termend`,
                folders: [{ name: 'Term End', papers: currentSelectedSubject.termEnd }]
            });
        } catch (error) {
            console.error('Term-End ZIP failed:', error);
        } finally {
            setButtonLoading(termZipBtn, false);
        }
    });
    grid.appendChild(termDiv);
}

function renderPapersList(papers) {
    const grid = document.getElementById('search-results');
    grid.innerHTML = '';
    
    document.getElementById('search-breadcrumb').innerText = `Subjects / ${currentSelectedSubject.courseTitle} / ${currentSelectedExam}`;
    
    if(!papers.length) { grid.innerHTML = '<p>No papers found in this category.</p>'; return; }

    const slotValues = [...new Set(papers.map(getNormalizedSlot))].sort((a, b) => a.localeCompare(b));
    const slotFilterWrap = document.createElement('div');
    slotFilterWrap.className = 'form-group';
    slotFilterWrap.style.marginBottom = '10px';
    slotFilterWrap.innerHTML = `
        <label for="slot-filter-select">
            <span class="material-symbols-outlined label-icon">tune</span>
            Filter by Slot
        </label>
        <select id="slot-filter-select">
            <option value="ALL">All Slots</option>
            ${slotValues.map((slot) => `<option value="${slot}">${slot}</option>`).join('')}
        </select>
    `;
    grid.appendChild(slotFilterWrap);

    const papersContainer = document.createElement('div');
    papersContainer.className = 'results-grid';
    grid.appendChild(papersContainer);

    const renderFilteredPapers = () => {
        const selectedSlot = document.getElementById('slot-filter-select')?.value || 'ALL';
        papersContainer.innerHTML = '';

        const filteredPapers = selectedSlot === 'ALL'
            ? papers
            : papers.filter((paper) => getNormalizedSlot(paper) === selectedSlot);

        if (!filteredPapers.length) {
            papersContainer.innerHTML = '<p>No papers found for selected slot.</p>';
            return;
        }

        filteredPapers.forEach(p => {
        const div = document.createElement('div');
        div.className = 'paper-card';
        
        const fileUrl = p.fileUrl || '';
        const explicitType = (p.fileType || '').toLowerCase();
        const isPdf = explicitType ? explicitType === 'pdf' : fileUrl.toLowerCase().includes('.pdf');
        const isSingleImage = explicitType === 'image' || (!isPdf && (p.pageCount || 1) === 1);
        
        // PDF preview: PDF.js renders page 1 to a canvas — works on iOS/Android/all browsers
        let previewHtml = '';
        const cardId = 'pdf-card-' + Math.random().toString(36).substr(2, 8);
        if (fileUrl) {
            if (isPdf) {
                previewHtml = `
                <div style="position:relative;height:220px;overflow:hidden;border-radius:8px;margin-top:10px;border:1px solid #e0e0e0;background:#f0f0f0;display:flex;align-items:flex-start;justify-content:center;">
                    <canvas id="${cardId}" style="width:100%;height:100%;object-fit:contain;display:block;"></canvas>
                    <div id="${cardId}-loader" style="position:absolute;display:flex;flex-direction:column;align-items:center;gap:8px;color:#999;font-size:0.8rem;">
                        <div class="loader" style="width:24px;height:24px;border-width:3px;"></div>
                        Loading preview...
                    </div>
                    <div onclick="window.open('${fileUrl}', '_blank')"
                         style="position:absolute;inset:0;cursor:pointer;display:flex;align-items:flex-end;">
                        <div style="width:100%;padding:8px;background:linear-gradient(transparent,rgba(0,0,0,0.7));color:white;font-size:0.8rem;text-align:center;">
                            Tap to open full PDF →
                        </div>
                    </div>
                </div>`;

            } else {
                previewHtml = `
                <div class="img-preview-wrap ${isSingleImage ? 'single-image-preview' : ''}" onclick="window.open('${fileUrl}', '_blank')" style="margin-top:10px;height:220px;border-radius:8px;overflow:hidden;position:relative;cursor:pointer;">
                    <img src="${fileUrl}" alt="Paper preview" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:top;">
                    <div style="position:absolute;bottom:0;left:0;right:0;padding:8px;background:linear-gradient(transparent,rgba(0,0,0,0.7));color:white;font-size:0.8rem;text-align:center;">
                        ${isSingleImage ? 'Single image paper · Tap to open →' : 'Tap to open →'}
                    </div>
                </div>`;
            }
        }

        div.innerHTML = `
            <div class="paper-details">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="badge">
                        <span class="material-symbols-outlined" style="font-size:0.85rem;margin-right:3px;">${isSingleImage ? 'image' : 'description'}</span>
                        ${isSingleImage ? 'Single Image' : `${p.pageCount || 1} page${(p.pageCount||1)>1?'s':''}`}
                    </span>
                    <span style="font-size:0.8rem; color:#999;">${new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                <p style="margin:8px 0 0; color:#777; font-size:0.82rem;">Slot: <strong>${getNormalizedSlot(p)}</strong></p>
                ${previewHtml}
            </div>
            <div class="paper-actions" style="display:flex; gap:8px;">
                <a href="${fileUrl}" target="_blank" class="btn-dl" style="flex:2; text-align:center;">
                    <span class="material-symbols-outlined" style="font-size:1rem;">download</span>
                    ${isPdf ? 'Download PDF' : 'Open Image'}
                </a>
                <button class="btn-save-collection" style="flex:0 0 auto; padding: 6px 12px; background: #222; color: white; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Save to Collection">
                    <span class="material-symbols-outlined" style="font-size: 1.2rem;">bookmark</span>
                </button>
                <button class="btn-report" style="flex:1;">
                    Report
                </button>
            </div>
        `;
        grid.appendChild(div);

        const saveBtn = div.querySelector('.btn-save-collection');
        saveBtn?.addEventListener('click', () => {
            openCollectionModal(p);
        });

        const reportBtn = div.querySelector('.btn-report');
        reportBtn?.addEventListener('click', () => {
            if (typeof window.openReportModal === 'function') {
                window.openReportModal(p);
            }
        });

        // Kick off PDF.js canvas render after the card is in the DOM
        if (isPdf && fileUrl) {
            renderPdfPreview(fileUrl, cardId);
        }
        });
    };

    document.getElementById('slot-filter-select')?.addEventListener('change', renderFilteredPapers);
    renderFilteredPapers();
}

// Render the first page of a PDF to a canvas using PDF.js
async function renderPdfPreview(fileUrl, cardId) {
    const canvas = document.getElementById(cardId);
    const loader = document.getElementById(cardId + '-loader');
    if (!canvas || typeof pdfjsLib === 'undefined') return;

    // Set worker from same CDN
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    try {
        const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(fileUrl)}`;
        const pdfDoc = await pdfjsLib.getDocument(proxyUrl).promise;
        const page = await pdfDoc.getPage(1);

        // Scale to fit the 220px tall preview container
        const containerWidth = canvas.parentElement?.clientWidth || 300;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport
        }).promise;

        if (loader) loader.style.display = 'none';
    } catch (err) {
        console.warn('PDF preview failed for', fileUrl, err);
        if (canvas) canvas.style.display = 'none';
        if (loader) loader.innerHTML = `
            <span class="material-symbols-outlined" style="font-size:2rem;color:#ccc;">picture_as_pdf</span>
            <span style="font-size:0.8rem;color:#aaa;">Tap to open PDF</span>`;
    }
}

document.getElementById('btn-search-back')?.addEventListener('click', () => {
    const currentState = window.history.state;
    if (currentState?.appNav && currentState?.tab === 'search' && (currentState?.searchLevel === 'paper' || currentState?.searchLevel === 'exam')) {
        window.history.back();
        return;
    }

    if (currentSearchLevel === 'paper') {
        currentSearchLevel = 'exam';
        renderExamTypes();
    } else if (currentSearchLevel === 'exam') {
        currentSearchLevel = 'subject';
        currentSelectedSubjectCode = null;
        renderSubjects(document.getElementById('search-input').value.toLowerCase());
    }
});

document.getElementById('search-input').addEventListener('input', e => {
    if (currentSearchLevel === 'subject') {
        currentPage = 1; // Reset to first page on new search
        renderSubjects(e.target.value.toLowerCase());
    }
});
