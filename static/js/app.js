// app.js — Thin orchestrator that imports all modules and wires up the view state machine

import { fetchCourses } from './courses.js';
import { init as initUpload, getPagesArray } from './upload.js';
import { loadAllSearchablePapers, restoreSearchStateFromHistory } from './search.js';
import { initFeedback } from './feedback.js';
import { initRequests } from './requests.js';
import { loginWithGoogle } from './auth.js';
import { initAccount, refreshAccountView } from './account.js';
import { initLeaderboard } from './leaderboard.js';

// === View State Machine ===
const views = {
    "upload": document.getElementById('upload-view'),
    "arrange": document.getElementById('arrange-view'),
    "crop": document.getElementById('crop-view'),
    "metadata": document.getElementById('metadata-view'),
    "processing": document.getElementById('processing-view'),
    "search": document.getElementById('search-view'),
    "account": document.getElementById('account-view'),
    "leaderboard": document.getElementById('leaderboard-view')
};

function showView(viewId) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewId].classList.remove('hidden');
}

function setActiveTab(tab) {
    const uploadTab = document.getElementById('tab-upload');
    const searchTab = document.getElementById('tab-search');
    const authTab = document.getElementById('tab-auth');
    const leaderboardTab = document.getElementById('tab-leaderboard');
    
    uploadTab?.classList.toggle('active', tab === 'upload');
    searchTab?.classList.toggle('active', tab === 'search');
    authTab?.classList.toggle('active', tab === 'account');
    leaderboardTab?.classList.toggle('active', tab === 'leaderboard');
}

function openUploadTab() {
    setActiveTab('upload');
    showView('upload');
    sessionStorage.setItem('activeTab', 'upload');
}

function openSearchTab(initialFilter = '') {
    setActiveTab('search');
    showView('search');
    sessionStorage.setItem('activeTab', 'search');
    loadAllSearchablePapers(initialFilter);
}

function openAccountTab() {
    setActiveTab('account');
    showView('account');
    sessionStorage.setItem('activeTab', 'account');
    refreshAccountView();
}

function openLeaderboardTab() {
    setActiveTab('leaderboard');
    showView('leaderboard');
    sessionStorage.setItem('activeTab', 'leaderboard');
    initLeaderboard();
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
initAccount();

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

document.getElementById('tab-auth')?.addEventListener('click', (e) => {
    e.preventDefault();
    openAccountTab();
    pushTabState('account');
});

document.getElementById('tab-leaderboard')?.addEventListener('click', (e) => {
    e.preventDefault();
    openLeaderboardTab();
    pushTabState('leaderboard');
});

document.getElementById('btn-login-main')?.addEventListener('click', async () => {
    try {
        await loginWithGoogle();
    } catch (e) {
        console.warn("Login flow exception", e);
        const el = document.getElementById('global-message');
        if (el) {
            el.innerText = e.message || 'Login failed';
            el.className = 'error';
            setTimeout(() => el.innerText='', 4000);
        }
    }
});

const initialQuery = new URLSearchParams(window.location.search).get('q');
if (initialQuery && initialQuery.trim()) {
    const query = initialQuery.trim();
    openSearchTab();
    document.getElementById('search-input').value = query;
    // this timeout handles the lazy-loading of courses array.
    setTimeout(() => {
        window.dispatchEvent(new Event('load-search'));
    }, 500);
} else {
    // Restore tab from Session Storage
    const activeTab = sessionStorage.getItem('activeTab');
    if (activeTab === 'account') {
        openAccountTab();
    } else if (activeTab === 'search') {
        openSearchTab();
    } else if (activeTab === 'leaderboard') {
        openLeaderboardTab();
    } else {
        openUploadTab();
    }
}

// History API popstate handler (used for Search deep links)
window.addEventListener('popstate', (e) => {
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

    if (state.tab === 'account') {
        openAccountTab();
        return;
    }

    if (state.tab === 'leaderboard') {
        openLeaderboardTab();
        return;
    }

    openUploadTab();
});
