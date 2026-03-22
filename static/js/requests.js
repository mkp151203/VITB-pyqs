import { db, collection, addDoc, getDocs, deleteDoc, doc } from './firebase.js';
import { loadCourseCatalog } from './courses.js';

const GLOBAL_OPEN_REQUEST_LIMIT = 30;
const MAX_FULFILLED_REQUESTS = 30;
const REQUEST_RETENTION_DAYS = 60;
const REQUEST_USER_KEY = 'pyq_request_user_id';
const PENDING_REQUEST_KEY = 'pyq_pending_request';

function getOrCreateRequesterId() {
    let requesterId = localStorage.getItem(REQUEST_USER_KEY);
    if (!requesterId) {
        requesterId = `req_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
        localStorage.setItem(REQUEST_USER_KEY, requesterId);
    }
    return requesterId;
}

function showMessage(message, type = 'success') {
    const el = document.getElementById('global-message');
    if (!el) return;
    el.innerText = message;
    el.className = type;
    setTimeout(() => {
        el.innerText = '';
        el.className = '';
    }, 4000);
}

function openModal(modal) {
    modal?.classList.remove('hidden');
}

function closeModal(modal) {
    modal?.classList.add('hidden');
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

function formatRequestDate(value) {
    if (!value) return 'unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown time';
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function sortRequestsByDateDesc(requests) {
    return [...requests].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function getValidTime(value) {
    const date = new Date(value || 0);
    const time = date.getTime();
    return Number.isNaN(time) ? 0 : time;
}

function getPrimaryRequestTime(item) {
    return getValidTime(item.fulfilledAt || item.createdAt);
}

async function loadAndCleanupRequests() {
    if (!db) return [];
    const snapshot = await getDocs(collection(db, 'paper_requests'));
    const allRequests = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));

    const retentionMs = REQUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const oldRequestIds = allRequests
        .filter((item) => {
            const time = getPrimaryRequestTime(item);
            return time > 0 && (now - time) > retentionMs;
        })
        .map((item) => item.id);

    const fulfilledSorted = allRequests
        .filter((item) => (item.status || 'open') === 'fulfilled')
        .sort((a, b) => getPrimaryRequestTime(b) - getPrimaryRequestTime(a));

    const overflowFulfilledIds = fulfilledSorted
        .slice(MAX_FULFILLED_REQUESTS)
        .map((item) => item.id);

    const idsToDelete = [...new Set([...oldRequestIds, ...overflowFulfilledIds])];
    if (idsToDelete.length) {
        await Promise.all(idsToDelete.map((requestId) => deleteDoc(doc(db, 'paper_requests', requestId))));
    }

    const deletedSet = new Set(idsToDelete);
    return allRequests.filter((item) => !deletedSet.has(item.id));
}

async function loadOpenRequests() {
    const all = await loadAndCleanupRequests();
    return sortRequestsByDateDesc(all).filter((item) => (item.status || 'open') === 'open');
}

async function loadFulfilledRequests() {
    const all = await loadAndCleanupRequests();
    return all
        .filter((item) => (item.status || 'open') === 'fulfilled')
        .sort((a, b) => getPrimaryRequestTime(b) - getPrimaryRequestTime(a))
        .slice(0, MAX_FULFILLED_REQUESTS);
}

function savePendingRequest(requestItem) {
    const payload = {
        id: requestItem.id,
        courseCombined: requestItem.courseCombined || '',
        examName: requestItem.examName || '',
        slot: String(requestItem.slot || '').trim().toUpperCase()
    };
    localStorage.setItem(PENDING_REQUEST_KEY, JSON.stringify(payload));
}

function renderHelpRequests(requests, container, helpModal) {
    container.innerHTML = '';

    if (!requests.length) {
        container.innerHTML = '<p>No open requests right now.</p>';
        return;
    }

    requests.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'paper-card';
        card.innerHTML = `
            <div class="paper-details">
                <h3>${item.courseCombined || 'Course not specified'}</h3>
                <p style="margin:4px 0 0;color:#777;font-size:0.84rem;">${item.examName || 'Exam type not specified'} · ${formatRequestDate(item.createdAt)}</p>
                <p style="margin:8px 0 0;color:#666;font-size:0.84rem;">Slot: <strong>${String(item.slot || 'NA').trim() || 'NA'}</strong></p>
            </div>
            <div class="paper-actions">
                <button class="btn btn-primary btn-sm" type="button" data-upload-request="${item.id}">Upload for this request</button>
            </div>
        `;
        container.appendChild(card);

        const uploadBtn = card.querySelector('[data-upload-request]');
        uploadBtn?.addEventListener('click', () => {
            savePendingRequest(item);
            closeModal(helpModal);

            const tabUpload = document.getElementById('tab-upload');
            tabUpload?.click();

            showMessage('Request selected. Please upload the paper now.', 'success');
        });
    });
}

function renderFulfilledRequests(requests, container) {
    container.innerHTML = '';

    if (!requests.length) {
        container.innerHTML = '<p>No fulfilled requests yet.</p>';
        return;
    }

    requests.forEach((item) => {
        const slotValue = String(item.slot || 'NA').trim() || 'NA';
        const card = document.createElement('div');
        card.className = 'paper-card';
        card.innerHTML = `
            <div class="paper-details">
                <h3>${item.courseCombined || 'Course not specified'}</h3>
                <p style="margin:4px 0 0;color:#777;font-size:0.84rem;">${item.examName || 'Exam type not specified'}</p>
                <p style="margin:8px 0 0;color:#666;font-size:0.84rem;">Slot: <strong>${slotValue}</strong></p>
                <p style="margin:8px 0 0;color:#888;font-size:0.82rem;">Fulfilled: ${formatRequestDate(item.fulfilledAt || item.createdAt)}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

export function initRequests() {
    const requestModal = document.getElementById('request-modal');
    const helpModal = document.getElementById('help-modal');
    const fulfilledModal = document.getElementById('fulfilled-modal');

    const btnOpenRequest = document.getElementById('btn-open-request');
    const btnOpenHelp = document.getElementById('btn-open-help');
    const btnOpenFulfilled = document.getElementById('btn-open-fulfilled');
    const btnSendRequest = document.getElementById('btn-send-request');

    const requestCourse = document.getElementById('request-course');
    const requestCourseOptions = document.getElementById('request-course-options');
    const requestExam = document.getElementById('request-exam');
    const requestSlot = document.getElementById('request-slot');
    const helpRequestsList = document.getElementById('help-requests-list');
    const fulfilledRequestsList = document.getElementById('fulfilled-requests-list');

    if (!requestModal || !helpModal || !fulfilledModal || !btnOpenRequest || !btnOpenHelp || !btnOpenFulfilled || !btnSendRequest || !requestCourse || !requestCourseOptions || !requestExam || !requestSlot || !helpRequestsList || !fulfilledRequestsList) {
        return;
    }

    (async () => {
        try {
            const courses = await loadCourseCatalog();
            requestCourseOptions.innerHTML = '';
            (courses || []).forEach((course) => {
                const value = String(course || '').trim();
                if (!value) return;
                const option = document.createElement('option');
                option.value = value;
                requestCourseOptions.appendChild(option);
            });
        } catch (error) {
            console.warn('Unable to load request course suggestions:', error);
        }
    })();

    const closeButtons = document.querySelectorAll('[data-close-modal="request"], [data-close-modal="help"], [data-close-modal="fulfilled"]');
    closeButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-close-modal');
            if (target === 'request') closeModal(requestModal);
            if (target === 'help') closeModal(helpModal);
            if (target === 'fulfilled') closeModal(fulfilledModal);
        });
    });

    requestModal.addEventListener('click', (event) => {
        if (event.target === requestModal) closeModal(requestModal);
    });

    helpModal.addEventListener('click', (event) => {
        if (event.target === helpModal) closeModal(helpModal);
    });

    fulfilledModal.addEventListener('click', (event) => {
        if (event.target === fulfilledModal) closeModal(fulfilledModal);
    });

    btnOpenRequest.addEventListener('click', () => {
        requestCourse.value = '';
        requestExam.value = '';
        requestSlot.value = '';
        openModal(requestModal);
    });

    btnOpenHelp.addEventListener('click', async () => {
        if (!db) {
            showMessage('Requests are unavailable right now.', 'error');
            return;
        }

        helpRequestsList.innerHTML = '<div class="loader"></div>';
        openModal(helpModal);

        try {
            const requests = await loadOpenRequests();
            renderHelpRequests(requests, helpRequestsList, helpModal);
        } catch (error) {
            console.error('Failed to load requests', error);
            helpRequestsList.innerHTML = '<p>Failed to load requests.</p>';
        }
    });

    btnOpenFulfilled.addEventListener('click', async () => {
        if (!db) {
            showMessage('Requests are unavailable right now.', 'error');
            return;
        }

        fulfilledRequestsList.innerHTML = '<div class="loader"></div>';
        openModal(fulfilledModal);

        try {
            const fulfilledRequests = await loadFulfilledRequests();
            renderFulfilledRequests(fulfilledRequests, fulfilledRequestsList);
        } catch (error) {
            console.error('Failed to load fulfilled requests', error);
            fulfilledRequestsList.innerHTML = '<p>Failed to load fulfilled requests.</p>';
        }
    });

    btnSendRequest.addEventListener('click', async () => {
        if (!db) {
            showMessage('Requests are unavailable right now.', 'error');
            return;
        }

        const courseCombined = (requestCourse.value || '').trim();
        const examName = (requestExam.value || '').trim();
        const slot = (requestSlot.value || '').trim().toUpperCase();

        if (!courseCombined) {
            showMessage('Course is required for request.', 'error');
            return;
        }

        setButtonLoading(btnSendRequest, true, 'Posting...');
        try {
            const openRequests = await loadOpenRequests();
            if (openRequests.length >= GLOBAL_OPEN_REQUEST_LIMIT) {
                showMessage(`Open request limit reached (${GLOBAL_OPEN_REQUEST_LIMIT}). Please try later.`, 'error');
                return;
            }

            await addDoc(collection(db, 'paper_requests'), {
                requesterId: getOrCreateRequesterId(),
                courseCombined,
                examName,
                slot,
                status: 'open',
                createdAt: new Date().toISOString()
            });

            closeModal(requestModal);
            showMessage(`Request posted (${openRequests.length + 1}/${GLOBAL_OPEN_REQUEST_LIMIT} open).`, 'success');
        } catch (error) {
            console.error('Request post failed', error);
            showMessage('Failed to post request.', 'error');
        } finally {
            setButtonLoading(btnSendRequest, false);
        }
    });
}
