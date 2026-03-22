// app.js — Thin orchestrator that imports all modules and wires up the view state machine

import { fetchCourses } from './courses.js';
import { init as initUpload, getPagesArray } from './upload.js';
import { loadAllSearchablePapers, restoreSearchStateFromHistory } from './search.js';
import { initFeedback } from './feedback.js';
import { initRequests } from './requests.js';

// === View State Machine ===
const views = {
    "upload": document.getElementById('upload-view'),
    "arrange": document.getElementById('arrange-view'),
    "crop": document.getElementById('crop-view'),
    "metadata": document.getElementById('metadata-view'),
    "processing": document.getElementById('processing-view'),
    "search": document.getElementById('search-view')
};

function showView(viewId) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewId].classList.remove('hidden');
}

function setActiveTab(tab) {
    const uploadTab = document.getElementById('tab-upload');
    const searchTab = document.getElementById('tab-search');
    const isSearch = tab === 'search';
    searchTab?.classList.toggle('active', isSearch);
    uploadTab?.classList.toggle('active', !isSearch);
}

function openUploadTab() {
    setActiveTab('upload');
    showView(getPagesArray().length > 0 ? 'arrange' : 'upload');
}

function openSearchTab(initialFilter = '') {
    setActiveTab('search');
    showView('search');
    loadAllSearchablePapers(initialFilter);
}

function pushTabState(tab, extra = {}) {
    const nextState = { appNav: true, tab, ...extra };
    window.history.pushState(nextState, '', window.location.href);
}

function replaceTabState(tab, extra = {}) {
    const nextState = { appNav: true, tab, ...extra };
    window.history.replaceState(nextState, '', window.location.href);
}

// Initialize modules with shared dependencies
initUpload(showView);
fetchCourses();
initFeedback();
initRequests();

document.getElementById('opencv-status').innerText = 'Ready to adjust corners.';

// === Tab Navigation ===
document.getElementById('tab-upload').addEventListener('click', (e) => {
    e.preventDefault();
    openUploadTab();
    pushTabState('upload');
});

document.getElementById('tab-search').addEventListener('click', (e) => {
    e.preventDefault();
    openSearchTab();
    pushTabState('search', { searchLevel: 'subject' });
});

const initialQuery = new URLSearchParams(window.location.search).get('q');
if (initialQuery && initialQuery.trim()) {
    const query = initialQuery.trim();
    openSearchTab(query);
    replaceTabState('search', { q: query, searchLevel: 'subject', filter: query });
} else {
    openUploadTab();
    replaceTabState('upload');
}

window.addEventListener('popstate', (event) => {
    const state = event.state;
    if (!state || !state.appNav) return;

    if (state.tab === 'search') {
        setActiveTab('search');
        showView('search');
        if (state.searchLevel) {
            restoreSearchStateFromHistory(state);
            return;
        }
        openSearchTab(state.q || '');
        return;
    }

    openUploadTab();
});
