// search.js — 3-level search navigation (subjects → exam types → papers)
import { db, collection, getDocs } from './firebase.js';
import { loadCourseCatalog } from './courses.js';

let searchArchives = [];
let groupedBySubject = {};

let currentSearchLevel = 'subject'; 
let currentSelectedSubject = null;
let currentSelectedExam = null;

// Pagination state
const SUBJECTS_PER_PAGE = 6;
let currentPage = 1;
let filteredKeys = [];

export async function loadAllSearchablePapers() {
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
        renderSubjects();
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
                <span class="material-symbols-outlined" style="font-size:1.4rem; color:#ccc; flex-shrink:0;">chevron_right</span>
            </div>
        `;
        div.addEventListener('click', () => {
            currentSearchLevel = 'exam';
            currentSelectedSubject = data;
            renderExamTypes();
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
    midDiv.innerHTML = `<h3>Mid-term Exam</h3><p style="color:#888; margin:0; font-size:0.85rem;">${currentSelectedSubject.midterm.length} paper${currentSelectedSubject.midterm.length !== 1 ? 's' : ''}</p>`;
    midDiv.addEventListener('click', () => {
        currentSearchLevel = 'paper';
        currentSelectedExam = 'Midterm';
        renderPapersList(currentSelectedSubject.midterm);
    });
    grid.appendChild(midDiv);
    
    const termDiv = document.createElement('div');
    termDiv.className = 'paper-card';
    termDiv.style.cursor = 'pointer';
    termDiv.innerHTML = `<h3>Term-End Exam</h3><p style="color:#888; margin:0; font-size:0.85rem;">${currentSelectedSubject.termEnd.length} paper${currentSelectedSubject.termEnd.length !== 1 ? 's' : ''}</p>`;
    termDiv.addEventListener('click', () => {
        currentSearchLevel = 'paper';
        currentSelectedExam = 'Term End';
        renderPapersList(currentSelectedSubject.termEnd);
    });
    grid.appendChild(termDiv);
}

function renderPapersList(papers) {
    const grid = document.getElementById('search-results');
    grid.innerHTML = '';
    
    document.getElementById('search-breadcrumb').innerText = `Subjects / ${currentSelectedSubject.courseTitle} / ${currentSelectedExam}`;
    
    if(!papers.length) { grid.innerHTML = '<p>No papers found in this category.</p>'; return; }
    
    papers.forEach(p => {
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
                ${previewHtml}
            </div>
            <div class="paper-actions">
                <a href="${fileUrl}" target="_blank" class="btn-dl">
                    <span class="material-symbols-outlined" style="font-size:1rem;">download</span>
                    ${isPdf ? 'Download PDF' : 'Open Image'}
                </a>
                <button class="btn-report">
                    Report
                </button>
            </div>
        `;
        grid.appendChild(div);

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
    if (currentSearchLevel === 'paper') {
        currentSearchLevel = 'exam';
        renderExamTypes();
    } else if (currentSearchLevel === 'exam') {
        currentSearchLevel = 'subject';
        renderSubjects(document.getElementById('search-input').value.toLowerCase());
    }
});

document.getElementById('search-input').addEventListener('input', e => {
    if (currentSearchLevel === 'subject') {
        currentPage = 1; // Reset to first page on new search
        renderSubjects(e.target.value.toLowerCase());
    }
});
