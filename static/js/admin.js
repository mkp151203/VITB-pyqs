import {
    auth,
    db,
    storage,
    collection,
    getDocs,
    getDoc,
    query,
    where,
    doc,
    deleteDoc,
    setDoc,
    serverTimestamp,
    ref,
    deleteObject,
    signOut,
    onAuthStateChanged
} from './firebase.js';

const reportedList = document.getElementById('reported-papers-list');
const supportList = document.getElementById('support-messages-list');
const allPapersList = document.getElementById('all-papers-list');
const adminRequestsList = document.getElementById('admin-requests-list');

const adminSearchInput = document.getElementById('admin-search-input');
const adminLogoutBtn = document.getElementById('admin-logout-btn');
const adminTabReported = document.getElementById('admin-tab-reported');
const adminTabMessages = document.getElementById('admin-tab-messages');
const adminTabPapers = document.getElementById('admin-tab-papers');
const adminTabRequests = document.getElementById('admin-tab-requests');
const adminReportedView = document.getElementById('admin-reported-view');
const adminMessagesView = document.getElementById('admin-messages-view');
const adminPapersView = document.getElementById('admin-papers-view');
const adminRequestsView = document.getElementById('admin-requests-view');
const adminSearchNav = document.getElementById('admin-search-navigation');
const adminSearchBarContainer = document.getElementById('admin-search-bar-container');
const adminSearchBreadcrumb = document.getElementById('admin-search-breadcrumb');
const adminSearchBackBtn = document.getElementById('admin-btn-search-back');
const adminNewCourseCodeInput = document.getElementById('admin-new-course-code');
const adminNewCourseTitleInput = document.getElementById('admin-new-course-title');
const adminAddCourseBtn = document.getElementById('admin-add-course-btn');

let allPapers = [];
let allReports = [];
let allSupportMessages = [];
let allRequests = [];
let groupedBySubject = {};
let catalogCourses = [];

let currentSearchLevel = 'subject';
let currentSelectedSubject = null;
let currentSelectedExam = null;
let currentPage = 1;
let filteredKeys = [];

const SUBJECTS_PER_PAGE = 6;

function showMessage(message, type = 'success') {
    const el = document.getElementById('global-message');
    if (!el) return;
    el.innerText = message;
    el.className = type;
    setTimeout(() => {
        el.innerText = '';
        el.className = '';
    }, 3500);
}

function escapeHtml(input = '') {
    return String(input)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function formatDate(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
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

function normalizeCourseEntry(raw) {
    const value = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!value) return null;

    if (value.includes(' - ')) {
        const split = value.split(' - ');
        const code = (split[0] || '').trim().toUpperCase();
        const title = split.slice(1).join(' - ').trim();
        if (!code) return null;
        return {
            courseCode: code,
            courseTitle: title || code,
            courseCombined: title ? `${code} - ${title}` : code
        };
    }

    const fallbackCode = value.split(' ')[0].toUpperCase();
    return {
        courseCode: fallbackCode,
        courseTitle: value,
        courseCombined: value
    };
}

function toCourseDocId(code = '') {
    return String(code).replace(/\//g, '-').replace(/\s+/g, '').toUpperCase();
}

function getMergedSubjects() {
    const mergedMap = new Map();

    Object.keys(groupedBySubject).forEach((key) => {
        const data = groupedBySubject[key];
        mergedMap.set(key, {
            courseCode: key,
            courseTitle: data.courseTitle || key,
            courseCombined: `${key} - ${data.courseTitle || key}`,
            midterm: data.midterm || [],
            termEnd: data.termEnd || [],
            inCatalog: catalogCourses.some((c) => c.courseCode === key || c.id === toCourseDocId(key))
        });
    });

    catalogCourses.forEach((course) => {
        const code = (course.courseCode || course.id || '').toString().trim().toUpperCase();
        if (!code) return;
        const existing = mergedMap.get(code);
        if (existing) {
            existing.inCatalog = true;
            if (!existing.courseTitle || existing.courseTitle === code) {
                existing.courseTitle = course.courseTitle || existing.courseTitle;
            }
            if (course.courseCombined) existing.courseCombined = course.courseCombined;
            return;
        }

        mergedMap.set(code, {
            courseCode: code,
            courseTitle: course.courseTitle || code,
            courseCombined: course.courseCombined || `${code} - ${course.courseTitle || code}`,
            midterm: [],
            termEnd: [],
            inCatalog: true
        });
    });

    return Array.from(mergedMap.values());
}

async function deleteCourseFromCatalog(courseCode, triggerButton) {
    if (!db || !courseCode) return;
    const docId = toCourseDocId(courseCode);
    const confirmed = window.confirm('Delete this course from catalog? This does not delete uploaded papers.');
    if (!confirmed) return;

    setButtonLoading(triggerButton, true, 'Deleting...');
    try {
        await deleteDoc(doc(db, 'courses_catalog', docId));
        catalogCourses = catalogCourses.filter((item) => item.id !== docId && item.courseCode !== courseCode);
        if (currentSearchLevel === 'subject') {
            renderSubjects((adminSearchInput?.value || '').toLowerCase());
        }
        showMessage('Course removed from catalog.', 'success');
    } catch (error) {
        console.error('Course deletion failed', error);
        showMessage('Failed to delete course.', 'error');
        setButtonLoading(triggerButton, false);
    }
}

async function addCourseToCatalog() {
    if (!db) {
        showMessage('Firestore is not configured.', 'error');
        return;
    }

    const code = (adminNewCourseCodeInput?.value || '').trim().toUpperCase();
    const title = (adminNewCourseTitleInput?.value || '').trim();

    if (!code || !title) {
        showMessage('Please enter both course code and course title.', 'error');
        return;
    }

    const courseCombined = `${code} - ${title}`;
    const docId = toCourseDocId(code);

    setButtonLoading(adminAddCourseBtn, true, 'Adding...');
    try {
        await setDoc(doc(db, 'courses_catalog', docId), {
            courseCode: code,
            courseTitle: title,
            courseCombined,
            updatedAt: serverTimestamp()
        }, { merge: true });

        const existingIndex = catalogCourses.findIndex((item) => item.id === docId);
        const nextEntry = {
            id: docId,
            courseCode: code,
            courseTitle: title,
            courseCombined
        };
        if (existingIndex >= 0) {
            catalogCourses[existingIndex] = nextEntry;
        } else {
            catalogCourses.push(nextEntry);
        }

        if (adminNewCourseCodeInput) adminNewCourseCodeInput.value = '';
        if (adminNewCourseTitleInput) adminNewCourseTitleInput.value = '';
        if (currentSearchLevel === 'subject') {
            renderSubjects((adminSearchInput?.value || '').toLowerCase());
        }
        showMessage('Course added to catalog.', 'success');
    } catch (error) {
        console.error('Course add failed', error);
        showMessage('Failed to add course.', 'error');
    } finally {
        setButtonLoading(adminAddCourseBtn, false);
    }
}

async function isAdminUid(uid) {
    if (!db || !uid) return false;
    const adminDoc = await getDoc(doc(db, 'admin_users', uid));
    return adminDoc.exists();
}

function setActiveTab(tab) {
    adminTabReported?.classList.toggle('active', tab === 'reported');
    adminTabMessages?.classList.toggle('active', tab === 'messages');
    adminTabPapers?.classList.toggle('active', tab === 'papers');
    adminTabRequests?.classList.toggle('active', tab === 'requests');

    adminReportedView?.classList.toggle('hidden', tab !== 'reported');
    adminMessagesView?.classList.toggle('hidden', tab !== 'messages');
    adminPapersView?.classList.toggle('hidden', tab !== 'papers');
    adminRequestsView?.classList.toggle('hidden', tab !== 'requests');
}

function buildGroupedBySubject() {
    groupedBySubject = {};
    allPapers.forEach((paper) => {
        const key = paper.courseCode || 'UNKNOWN';
        if (!groupedBySubject[key]) {
            groupedBySubject[key] = {
                courseCode: key,
                courseTitle: paper.courseTitle || paper.courseCode || 'Unknown Subject',
                midterm: [],
                termEnd: []
            };
        }

        if ((paper.examName || '').toLowerCase().includes('mid')) {
            groupedBySubject[key].midterm.push(paper);
        } else {
            groupedBySubject[key].termEnd.push(paper);
        }
    });
}

function renderReportedPapers() {
    reportedList.innerHTML = '';

    const grouped = {};
    allReports.forEach((report) => {
        if (!grouped[report.paperId]) grouped[report.paperId] = [];
        grouped[report.paperId].push(report);
    });

    const reportedPaperIds = Object.keys(grouped);
    if (!reportedPaperIds.length) {
        reportedList.innerHTML = '<p>No reported papers.</p>';
        return;
    }

    reportedPaperIds.forEach((paperId) => {
        const paper = allPapers.find((p) => p.id === paperId);
        const reportItems = grouped[paperId]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 3)
            .map((r) => `<li>${escapeHtml(r.reason)} <span style="color:#888;">(${formatDate(r.createdAt)})</span></li>`)
            .join('');

        const card = document.createElement('div');
        card.className = 'paper-card';
        card.innerHTML = `
            <div class="paper-details">
                <h3>${escapeHtml(paper?.courseTitle || 'Deleted Paper')}</h3>
                <p style="margin:4px 0 0;color:#777;font-size:0.85rem;">${escapeHtml(paper?.examName || 'Unknown Exam')} · ${grouped[paperId].length} report(s)</p>
                <ul style="margin:10px 0 0;padding-left:18px;">${reportItems}</ul>
            </div>
            <div class="paper-actions">
                ${paper?.fileUrl ? `<a class="btn-dl" href="${paper.fileUrl}" target="_blank">Open</a>` : '<span style="color:#999;font-size:0.85rem;">Paper removed</span>'}
                ${paper?.id ? `<button class="btn-report" data-delete-reported-paper="${paper.id}" type="button">Delete</button>` : ''}
            </div>
        `;
        reportedList.appendChild(card);
    });

    reportedList.querySelectorAll('[data-delete-reported-paper]').forEach((button) => {
        button.addEventListener('click', async () => {
            const paperId = button.getAttribute('data-delete-reported-paper');
            await deletePaperById(paperId, button);
        });
    });
}

function renderSupportMessages() {
    supportList.innerHTML = '';

    if (!allSupportMessages.length) {
        supportList.innerHTML = '<p>No support messages yet.</p>';
        return;
    }

    allSupportMessages
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .forEach((msg) => {
            const card = document.createElement('div');
            card.className = 'paper-card';
            card.innerHTML = `
                <div class="paper-details">
                    <p style="margin:0; white-space:pre-wrap;">${escapeHtml(msg.message || '')}</p>
                    <p style="margin:8px 0 0; color:#888; font-size:0.82rem;">${formatDate(msg.createdAt)}</p>
                </div>
            `;
            supportList.appendChild(card);
        });
}

async function deleteRequestById(requestId, triggerButton) {
    if (!db || !requestId) return;
    const confirmed = window.confirm('Delete this request?');
    if (!confirmed) return;

    setButtonLoading(triggerButton, true, 'Deleting...');
    try {
        await deleteDoc(doc(db, 'paper_requests', requestId));
        allRequests = allRequests.filter((item) => item.id !== requestId);
        renderRequests();
        showMessage('Request deleted.', 'success');
    } catch (error) {
        console.error('Request delete failed', error);
        showMessage('Failed to delete request.', 'error');
        setButtonLoading(triggerButton, false);
    }
}

function renderRequests() {
    if (!adminRequestsList) return;
    adminRequestsList.innerHTML = '';

    if (!allRequests.length) {
        adminRequestsList.innerHTML = '<p>No requests found.</p>';
        return;
    }

    allRequests
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .forEach((item) => {
            const card = document.createElement('div');
            card.className = 'paper-card';
            const status = item.status || 'open';
            const slot = String(item.slot || '').trim() || 'NA';
            card.innerHTML = `
                <div class="paper-details">
                    <h3>${escapeHtml(item.courseCombined || 'Course not specified')}</h3>
                    <p style="margin:4px 0 0;color:#777;font-size:0.84rem;">${escapeHtml(item.examName || 'Exam type not specified')} · Slot ${escapeHtml(slot)}</p>
                    <p style="margin:8px 0 0;color:#888;font-size:0.82rem;">Status: ${escapeHtml(status)} · ${formatDate(item.createdAt)}</p>
                </div>
                <div class="paper-actions">
                    <button class="btn-report" type="button" data-delete-request="${item.id}">Delete Request</button>
                </div>
            `;
            adminRequestsList.appendChild(card);
        });

    adminRequestsList.querySelectorAll('[data-delete-request]').forEach((button) => {
        button.addEventListener('click', async () => {
            const requestId = button.getAttribute('data-delete-request');
            await deleteRequestById(requestId, button);
        });
    });
}

function renderPagination(totalPages, filterQuery) {
    const nav = document.createElement('div');
    nav.className = 'pagination';

    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;">chevron_left</span>';
    prev.disabled = currentPage === 1;
    prev.addEventListener('click', () => {
        currentPage--;
        renderSubjects(filterQuery);
    });
    nav.appendChild(prev);

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
        btn.textContent = i;
        btn.addEventListener('click', () => {
            currentPage = i;
            renderSubjects(filterQuery);
        });
        nav.appendChild(btn);
    }

    const next = document.createElement('button');
    next.className = 'page-btn';
    next.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;">chevron_right</span>';
    next.disabled = currentPage === totalPages;
    next.addEventListener('click', () => {
        currentPage++;
        renderSubjects(filterQuery);
    });
    nav.appendChild(next);

    allPapersList.appendChild(nav);
}

function renderSubjects(filterQuery = '') {
    allPapersList.innerHTML = '';
    adminSearchNav?.classList.add('hidden');
    adminSearchBarContainer?.classList.remove('hidden');
    if (adminSearchInput) adminSearchInput.value = filterQuery;

    const mergedSubjects = getMergedSubjects();

    const filteredSubjects = mergedSubjects.filter((item) => {
        if (!filterQuery) return true;
        return (`${item.courseTitle} ${item.courseCode} ${item.courseCombined || ''}`).toLowerCase().includes(filterQuery);
    });

    const totalPages = Math.max(1, Math.ceil(filteredSubjects.length / SUBJECTS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageSubjects = filteredSubjects.slice((currentPage - 1) * SUBJECTS_PER_PAGE, currentPage * SUBJECTS_PER_PAGE);

    if (!filteredSubjects.length) {
        allPapersList.innerHTML = '<p>No subjects found.</p>';
        return;
    }

    pageSubjects.forEach((data) => {
        const total = data.midterm.length + data.termEnd.length;
        const canOpenPapers = total > 0;
        const cardTitle = data.courseCombined || `${data.courseCode} - ${data.courseTitle}`;
        const card = document.createElement('div');
        card.className = 'paper-card';
        card.style.cursor = canOpenPapers ? 'pointer' : 'default';
        card.innerHTML = `
            <div class="paper-details" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h3>${escapeHtml(cardTitle)}</h3>
                    <p style="margin: 4px 0 0; color:#888; font-size: 0.82rem;">${total} paper${total !== 1 ? 's' : ''} available</p>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    ${data.inCatalog ? `<button class="btn-report" data-delete-catalog="${escapeHtml(data.courseCode)}" type="button">Delete Catalog</button>` : ''}
                    <span class="material-symbols-outlined" style="font-size:1.4rem; color:#ccc; flex-shrink:0;">${canOpenPapers ? 'chevron_right' : 'remove'}</span>
                </div>
            </div>
        `;
        card.addEventListener('click', (event) => {
            if (event.target.closest('[data-delete-catalog]')) return;
            if (!canOpenPapers) return;
            currentSearchLevel = 'exam';
            currentSelectedSubject = data;
            renderExamTypes();
        });
        allPapersList.appendChild(card);
    });

    allPapersList.querySelectorAll('[data-delete-catalog]').forEach((button) => {
        button.addEventListener('click', async () => {
            const courseCode = button.getAttribute('data-delete-catalog');
            await deleteCourseFromCatalog(courseCode, button);
        });
    });

    if (totalPages > 1) {
        renderPagination(totalPages, filterQuery);
    }
}

function renderExamTypes() {
    allPapersList.innerHTML = '';
    adminSearchNav?.classList.remove('hidden');
    adminSearchBarContainer?.classList.add('hidden');
    if (adminSearchBreadcrumb) {
        adminSearchBreadcrumb.innerText = `Subjects / ${currentSelectedSubject.courseTitle}`;
    }

    const midCard = document.createElement('div');
    midCard.className = 'paper-card';
    midCard.style.cursor = 'pointer';
    midCard.innerHTML = `<h3>Mid-term Exam</h3><p style="color:#888; margin:0; font-size:0.85rem;">${currentSelectedSubject.midterm.length} paper${currentSelectedSubject.midterm.length !== 1 ? 's' : ''}</p>`;
    midCard.addEventListener('click', () => {
        currentSearchLevel = 'paper';
        currentSelectedExam = 'Midterm';
        renderPapersList(currentSelectedSubject.midterm);
    });
    allPapersList.appendChild(midCard);

    const termCard = document.createElement('div');
    termCard.className = 'paper-card';
    termCard.style.cursor = 'pointer';
    termCard.innerHTML = `<h3>Term-End Exam</h3><p style="color:#888; margin:0; font-size:0.85rem;">${currentSelectedSubject.termEnd.length} paper${currentSelectedSubject.termEnd.length !== 1 ? 's' : ''}</p>`;
    termCard.addEventListener('click', () => {
        currentSearchLevel = 'paper';
        currentSelectedExam = 'Term End';
        renderPapersList(currentSelectedSubject.termEnd);
    });
    allPapersList.appendChild(termCard);
}

async function deletePaperById(paperId, triggerButton) {
    const paper = allPapers.find((p) => p.id === paperId);
    if (!paperId || !paper) return;

    const confirmed = window.confirm('Delete this paper permanently?');
    if (!confirmed) return;

    setButtonLoading(triggerButton, true, 'Deleting...');

    try {
        if (paper.fileUrl && storage) {
            try {
                const storagePath = String(paper.storagePath || '').trim();
                if (storagePath) {
                    await deleteObject(ref(storage, storagePath));
                } else {
                    await deleteObject(ref(storage, paper.fileUrl));
                }
            } catch (storageErr) {
                // Legacy fallback: decode /o/<encodedPath> from Firebase download URL.
                try {
                    const parsed = new URL(String(paper.fileUrl || ''));
                    const markerIdx = parsed.pathname.indexOf('/o/');
                    if (markerIdx !== -1) {
                        const decodedPath = decodeURIComponent(parsed.pathname.slice(markerIdx + 3));
                        await deleteObject(ref(storage, decodedPath));
                    } else {
                        throw storageErr;
                    }
                } catch (fallbackErr) {
                    console.warn('Storage deletion warning:', fallbackErr);
                }
            }
        }

        await deleteDoc(doc(db, 'question_papers_multi', paperId));

        const reportsSnapshot = await getDocs(query(collection(db, 'paper_reports'), where('paperId', '==', paperId)));
        await Promise.all(reportsSnapshot.docs.map((item) => deleteDoc(doc(db, 'paper_reports', item.id))));

        allPapers = allPapers.filter((p) => p.id !== paperId);
        allReports = allReports.filter((r) => r.paperId !== paperId);
        buildGroupedBySubject();

        if (currentSearchLevel === 'paper' && currentSelectedSubject) {
            const refreshed = groupedBySubject[currentSelectedSubject.courseCode];
            if (!refreshed) {
                currentSearchLevel = 'subject';
                renderSubjects((adminSearchInput?.value || '').toLowerCase());
            } else {
                currentSelectedSubject = refreshed;
                if (currentSelectedExam === 'Midterm') {
                    renderPapersList(refreshed.midterm);
                } else {
                    renderPapersList(refreshed.termEnd);
                }
            }
        } else if (currentSearchLevel === 'exam' && currentSelectedSubject) {
            const refreshed = groupedBySubject[currentSelectedSubject.courseCode];
            if (!refreshed) {
                currentSearchLevel = 'subject';
                renderSubjects((adminSearchInput?.value || '').toLowerCase());
            } else {
                currentSelectedSubject = refreshed;
                renderExamTypes();
            }
        } else {
            renderSubjects((adminSearchInput?.value || '').toLowerCase());
        }

        renderReportedPapers();
        showMessage('Paper deleted.', 'success');
    } catch (error) {
        console.error('Delete failed', error);
        showMessage('Failed to delete paper.', 'error');
        setButtonLoading(triggerButton, false);
    }
}

function renderPapersList(papers) {
    allPapersList.innerHTML = '';
    adminSearchNav?.classList.remove('hidden');
    adminSearchBarContainer?.classList.add('hidden');

    if (adminSearchBreadcrumb) {
        adminSearchBreadcrumb.innerText = `Subjects / ${currentSelectedSubject.courseTitle} / ${currentSelectedExam}`;
    }

    if (!papers.length) {
        allPapersList.innerHTML = '<p>No papers found in this category.</p>';
        return;
    }

    papers
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .forEach((paper) => {
            const explicitType = (paper.fileType || '').toLowerCase();
            const isPdf = explicitType ? explicitType === 'pdf' : (paper.fileUrl || '').toLowerCase().includes('.pdf');
            const isSingleImage = explicitType === 'image' || (!isPdf && (paper.pageCount || 1) === 1);
            const card = document.createElement('div');
            card.className = 'paper-card';
            card.innerHTML = `
                <div class="paper-details">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="badge">
                            <span class="material-symbols-outlined" style="font-size:0.85rem;margin-right:3px;">${isSingleImage ? 'image' : 'description'}</span>
                            ${isSingleImage ? 'Single Image' : `${paper.pageCount || 1} page${(paper.pageCount || 1) > 1 ? 's' : ''}`}
                        </span>
                        <span style="font-size:0.8rem; color:#999;">${new Date(paper.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p style="margin:8px 0 0;color:#999;font-size:0.8rem;">Reported: ${paper.reportedCount || 0}</p>
                </div>
                <div class="paper-actions">
                    ${paper.fileUrl ? `<a href="${paper.fileUrl}" target="_blank" class="btn-dl">${isPdf ? 'Open PDF' : 'Open Image'}</a>` : '<span style="color:#999;font-size:0.82rem;">No file URL</span>'}
                    <button class="btn-report" data-delete-paper="${paper.id}">Delete</button>
                </div>
            `;
            allPapersList.appendChild(card);
        });

    allPapersList.querySelectorAll('[data-delete-paper]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const paperId = btn.getAttribute('data-delete-paper');
            await deletePaperById(paperId, btn);
        });
    });
}

async function loadAllData() {
    if (!db) {
        reportedList.innerHTML = '<p>Firebase is not configured.</p>';
        supportList.innerHTML = '<p>Firebase is not configured.</p>';
        allPapersList.innerHTML = '<p>Firebase is not configured.</p>';
        if (adminRequestsList) adminRequestsList.innerHTML = '<p>Firebase is not configured.</p>';
        return;
    }

    reportedList.innerHTML = '<div class="loader"></div>';
    supportList.innerHTML = '<div class="loader"></div>';
    allPapersList.innerHTML = '<div class="loader"></div>';
    if (adminRequestsList) adminRequestsList.innerHTML = '<div class="loader"></div>';

    try {
        const [papersSnapshot, reportsSnapshot, supportSnapshot, catalogSnapshot, requestsSnapshot] = await Promise.all([
            getDocs(collection(db, 'question_papers_multi')),
            getDocs(collection(db, 'paper_reports')),
            getDocs(collection(db, 'support_messages')),
            getDocs(collection(db, 'courses_catalog')),
            getDocs(collection(db, 'paper_requests'))
        ]);

        allPapers = papersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        allReports = reportsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        allSupportMessages = supportSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        catalogCourses = catalogSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        allRequests = requestsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

        buildGroupedBySubject();
        currentSearchLevel = 'subject';
        currentPage = 1;

        renderReportedPapers();
        renderSupportMessages();
        renderSubjects();
        renderRequests();
    } catch (error) {
        console.error('Admin load failed', error);
        reportedList.innerHTML = '<p>Failed to load reported papers.</p>';
        supportList.innerHTML = '<p>Failed to load support messages.</p>';
        allPapersList.innerHTML = '<p>Failed to load papers.</p>';
        if (adminRequestsList) adminRequestsList.innerHTML = '<p>Failed to load requests.</p>';
    }
}

adminTabReported?.addEventListener('click', () => setActiveTab('reported'));
adminTabMessages?.addEventListener('click', () => setActiveTab('messages'));
adminTabPapers?.addEventListener('click', () => {
    setActiveTab('papers');
    currentSearchLevel = 'subject';
    currentSelectedSubject = null;
    currentSelectedExam = null;
    currentPage = 1;
    renderSubjects((adminSearchInput?.value || '').toLowerCase());
});

adminTabRequests?.addEventListener('click', () => {
    setActiveTab('requests');
    renderRequests();
});

adminSearchInput?.addEventListener('input', (e) => {
    if (currentSearchLevel === 'subject') {
        currentPage = 1;
        renderSubjects((e.target.value || '').toLowerCase());
    }
});

adminSearchBackBtn?.addEventListener('click', () => {
    if (currentSearchLevel === 'paper') {
        currentSearchLevel = 'exam';
        renderExamTypes();
    } else if (currentSearchLevel === 'exam') {
        currentSearchLevel = 'subject';
        renderSubjects((adminSearchInput?.value || '').toLowerCase());
    }
});

adminLogoutBtn?.addEventListener('click', async () => {
    setButtonLoading(adminLogoutBtn, true, 'Signing out...');
    try {
        await signOut(auth);
    } finally {
        window.location.href = '/admin';
    }
});

adminAddCourseBtn?.addEventListener('click', async () => {
    await addCourseToCatalog();
});

if (!auth) {
    showMessage('Firebase auth is not configured.', 'error');
} else {
    setActiveTab('reported');
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = '/admin';
            return;
        }
        try {
            const admin = await isAdminUid(user.uid);
            if (!admin) {
                window.location.href = '/admin';
                return;
            }
            loadAllData();
        } catch {
            window.location.href = '/admin';
        }
    });
}
