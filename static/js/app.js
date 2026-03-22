// app.js — Thin orchestrator that imports all modules and wires up the view state machine

import { fetchCourses } from './courses.js';
import { init as initUpload, getPagesArray } from './upload.js';
import { loadAllSearchablePapers } from './search.js';
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

// Initialize modules with shared dependencies
initUpload(showView);
fetchCourses();
initFeedback();
initRequests();

document.getElementById('opencv-status').innerText = 'Ready to adjust corners.';

// === Tab Navigation ===
document.getElementById('tab-upload').addEventListener('click', (e) => {
    e.target.classList.add('active');
    document.getElementById('tab-search').classList.remove('active');
    showView(getPagesArray().length > 0 ? 'arrange' : 'upload');
});

document.getElementById('tab-search').addEventListener('click', (e) => {
    e.target.classList.add('active');
    document.getElementById('tab-upload').classList.remove('active');
    showView('search');
    loadAllSearchablePapers();
});

const initialQuery = new URLSearchParams(window.location.search).get('q');
if (initialQuery && initialQuery.trim()) {
    document.getElementById('tab-search').classList.add('active');
    document.getElementById('tab-upload').classList.remove('active');
    showView('search');
    loadAllSearchablePapers(initialQuery.trim());
}
