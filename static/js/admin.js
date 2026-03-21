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
    writeBatch,
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

const adminSearchInput = document.getElementById('admin-search-input');
const adminLogoutBtn = document.getElementById('admin-logout-btn');
const adminSyncCoursesBtn = document.getElementById('admin-sync-courses-btn');
const adminTabReported = document.getElementById('admin-tab-reported');
const adminTabMessages = document.getElementById('admin-tab-messages');
const adminTabPapers = document.getElementById('admin-tab-papers');
const adminReportedView = document.getElementById('admin-reported-view');
const adminMessagesView = document.getElementById('admin-messages-view');
const adminPapersView = document.getElementById('admin-papers-view');
const adminSearchNav = document.getElementById('admin-search-navigation');
const adminSearchBarContainer = document.getElementById('admin-search-bar-container');
const adminSearchBreadcrumb = document.getElementById('admin-search-breadcrumb');
const adminSearchBackBtn = document.getElementById('admin-btn-search-back');

let allPapers = [];
let allReports = [];
let allSupportMessages = [];
let groupedBySubject = {};

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

async function syncCoursesCatalogFromApi() {
    if (!db) {
        showMessage('Firestore is not configured.', 'error');
        return;
    }

    adminSyncCoursesBtn.disabled = true;
    showMessage('Syncing course catalog...', 'success');

    try {
        const response = await fetch('/api/courses');
        if (!response.ok) {
            throw new Error(`API failed with ${response.status}`);
        }

        const courses = await response.json();
        if (!Array.isArray(courses) || !courses.length) {
            throw new Error('No courses returned by API');
        }

        const normalized = [];
        const seen = new Set();
        courses.forEach((entry) => {
            const item = normalizeCourseEntry(entry);
            if (!item || seen.has(item.courseCode)) return;
            seen.add(item.courseCode);
            normalized.push(item);
        });

        let batch = writeBatch(db);
        let count = 0;

        for (const item of normalized) {
            const docRef = doc(db, 'courses_catalog', item.courseCode.replace(/\//g, '-').replace(/\s+/g, ''));
            batch.set(docRef, {
                ...item,
                updatedAt: serverTimestamp()
            }, { merge: true });

            count++;
            if (count % 450 === 0) {
                await batch.commit();
                batch = writeBatch(db);
            }
        }

        if (count % 450 !== 0) {
            await batch.commit();
        }

        showMessage(`Course sync complete: ${count} course(s) upserted.`, 'success');
    } catch (error) {
        console.error('Course sync failed', error);
        showMessage('Course sync failed. Check /api/courses and Firestore rules.', 'error');
    } finally {
        adminSyncCoursesBtn.disabled = false;
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

    adminReportedView?.classList.toggle('hidden', tab !== 'reported');
    adminMessagesView?.classList.toggle('hidden', tab !== 'messages');
    adminPapersView?.classList.toggle('hidden', tab !== 'papers');
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
            </div>
        `;
        reportedList.appendChild(card);
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

    filteredKeys = Object.keys(groupedBySubject).filter((key) => {
        if (!filterQuery) return true;
        const data = groupedBySubject[key];
        return (`${data.courseTitle} ${key}`).toLowerCase().includes(filterQuery);
    });

    const totalPages = Math.max(1, Math.ceil(filteredKeys.length / SUBJECTS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageKeys = filteredKeys.slice((currentPage - 1) * SUBJECTS_PER_PAGE, currentPage * SUBJECTS_PER_PAGE);

    if (!filteredKeys.length) {
        allPapersList.innerHTML = '<p>No subjects found.</p>';
        return;
    }

    pageKeys.forEach((key) => {
        const data = groupedBySubject[key];
        const total = data.midterm.length + data.termEnd.length;
        const card = document.createElement('div');
        card.className = 'paper-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="paper-details" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h3>${escapeHtml(data.courseTitle)}</h3>
                    <p style="margin: 4px 0 0; color:#888; font-size: 0.82rem;">${total} paper${total !== 1 ? 's' : ''} available</p>
                </div>
                <span class="material-symbols-outlined" style="font-size:1.4rem; color:#ccc; flex-shrink:0;">chevron_right</span>
            </div>
        `;
        card.addEventListener('click', () => {
            currentSearchLevel = 'exam';
            currentSelectedSubject = data;
            renderExamTypes();
        });
        allPapersList.appendChild(card);
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

    if (triggerButton) triggerButton.disabled = true;

    try {
        if (paper.fileUrl && storage) {
            try {
                await deleteObject(ref(storage, paper.fileUrl));
            } catch (storageErr) {
                console.warn('Storage deletion warning:', storageErr);
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
        if (triggerButton) triggerButton.disabled = false;
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
        return;
    }

    reportedList.innerHTML = '<div class="loader"></div>';
    supportList.innerHTML = '<div class="loader"></div>';
    allPapersList.innerHTML = '<div class="loader"></div>';

    try {
        const [papersSnapshot, reportsSnapshot, supportSnapshot] = await Promise.all([
            getDocs(collection(db, 'question_papers_multi')),
            getDocs(collection(db, 'paper_reports')),
            getDocs(collection(db, 'support_messages'))
        ]);

        allPapers = papersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        allReports = reportsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        allSupportMessages = supportSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

        buildGroupedBySubject();
        currentSearchLevel = 'subject';
        currentPage = 1;

        renderReportedPapers();
        renderSupportMessages();
        renderSubjects();
    } catch (error) {
        console.error('Admin load failed', error);
        reportedList.innerHTML = '<p>Failed to load reported papers.</p>';
        supportList.innerHTML = '<p>Failed to load support messages.</p>';
        allPapersList.innerHTML = '<p>Failed to load papers.</p>';
    }
}

adminTabReported?.addEventListener('click', () => setActiveTab('reported'));
adminTabMessages?.addEventListener('click', () => setActiveTab('messages'));
adminTabPapers?.addEventListener('click', () => {
    setActiveTab('papers');
    if (currentSearchLevel === 'subject') {
        currentPage = 1;
        renderSubjects((adminSearchInput?.value || '').toLowerCase());
    }
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
    try {
        await signOut(auth);
    } finally {
        window.location.href = '/admin';
    }
});

adminSyncCoursesBtn?.addEventListener('click', async () => {
    await syncCoursesCatalogFromApi();
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
