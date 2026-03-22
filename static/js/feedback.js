import { db, collection, addDoc, doc, updateDoc, increment } from './firebase.js';

const SUPPORT_MESSAGE_MAX = 500;
const REPORT_RATE_KEY = 'pyq_report_timestamps';
const SUPPORT_RATE_KEY = 'pyq_support_timestamps';

function pruneTimestamps(timestamps, windowMs) {
    const now = Date.now();
    return timestamps.filter((ts) => now - ts < windowMs);
}

function getRateData(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
        return [];
    }
}

function canProceedWithRateLimit(key, maxActions, windowMs) {
    const existing = pruneTimestamps(getRateData(key), windowMs);
    if (existing.length >= maxActions) {
        return { allowed: false, count: existing.length };
    }
    existing.push(Date.now());
    localStorage.setItem(key, JSON.stringify(existing));
    return { allowed: true, count: existing.length };
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

function closeModal(modal) {
    modal?.classList.add('hidden');
}

function openModal(modal) {
    modal?.classList.remove('hidden');
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

export function initFeedback() {
    const reportModal = document.getElementById('report-modal');
    const supportModal = document.getElementById('support-modal');

    const reportSendBtn = document.getElementById('btn-send-report');

    const supportTextarea = document.getElementById('support-message');
    const supportCounter = document.getElementById('support-char-count');
    const supportSendBtn = document.getElementById('btn-send-support');

    const supportOpenBtn = document.getElementById('btn-support');

    let activePaper = null;

    window.openReportModal = (paper) => {
        activePaper = paper;
        openModal(reportModal);
    };

    supportTextarea?.addEventListener('input', () => {
        if (supportTextarea.value.length > SUPPORT_MESSAGE_MAX) {
            supportTextarea.value = supportTextarea.value.slice(0, SUPPORT_MESSAGE_MAX);
        }
        supportCounter.innerText = `${supportTextarea.value.length}/${SUPPORT_MESSAGE_MAX}`;
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-close-modal');
            if (target === 'report') closeModal(reportModal);
            if (target === 'support') closeModal(supportModal);
        });
    });

    reportModal?.addEventListener('click', (e) => {
        if (e.target === reportModal) closeModal(reportModal);
    });

    supportModal?.addEventListener('click', (e) => {
        if (e.target === supportModal) closeModal(supportModal);
    });

    supportOpenBtn?.addEventListener('click', () => {
        if (supportTextarea) {
            supportTextarea.value = '';
            supportCounter.innerText = `0/${SUPPORT_MESSAGE_MAX}`;
        }
        openModal(supportModal);
    });

    reportSendBtn?.addEventListener('click', async () => {
        setButtonLoading(reportSendBtn, true, 'Reporting...');
        if (!db) {
            showMessage('Reports are unavailable right now.', 'error');
            setButtonLoading(reportSendBtn, false);
            return;
        }
        if (!activePaper || !activePaper.id) {
            showMessage('Invalid paper selected for reporting.', 'error');
            setButtonLoading(reportSendBtn, false);
            return;
        }

        const rate = canProceedWithRateLimit(REPORT_RATE_KEY, 5, 60 * 60 * 1000);
        if (!rate.allowed) {
            showMessage('Report limit reached. Please try again in some time.', 'error');
            setButtonLoading(reportSendBtn, false);
            return;
        }

        try {
            await addDoc(collection(db, 'paper_reports'), {
                paperId: activePaper.id,
                courseTitle: activePaper.courseTitle || '',
                examName: activePaper.examName || '',
                fileUrl: activePaper.fileUrl || '',
                reason: 'User confirmed report',
                createdAt: new Date().toISOString()
            });

            await updateDoc(doc(db, 'question_papers_multi', activePaper.id), {
                reportedCount: increment(1),
                lastReportedAt: new Date().toISOString()
            });

            closeModal(reportModal);
            showMessage('Report submitted. Thank you.', 'success');
            setButtonLoading(reportSendBtn, false);
        } catch (error) {
            console.error('Report submit failed', error);
            showMessage('Failed to send report. Please try again.', 'error');
            setButtonLoading(reportSendBtn, false);
        }
    });

    supportSendBtn?.addEventListener('click', async () => {
        setButtonLoading(supportSendBtn, true, 'Sending...');
        if (!db) {
            showMessage('Support is unavailable right now.', 'error');
            setButtonLoading(supportSendBtn, false);
            return;
        }

        const message = (supportTextarea?.value || '').trim();
        if (message.length < 10) {
            showMessage('Please enter at least 10 characters.', 'error');
            setButtonLoading(supportSendBtn, false);
            return;
        }

        const rate = canProceedWithRateLimit(SUPPORT_RATE_KEY, 3, 24 * 60 * 60 * 1000);
        if (!rate.allowed) {
            showMessage('Daily support message limit reached.', 'error');
            setButtonLoading(supportSendBtn, false);
            return;
        }

        try {
            await addDoc(collection(db, 'support_messages'), {
                message,
                createdAt: new Date().toISOString(),
                userAgent: navigator.userAgent || 'unknown'
            });
            closeModal(supportModal);
            showMessage('Support message sent.', 'success');
            setButtonLoading(supportSendBtn, false);
        } catch (error) {
            console.error('Support send failed', error);
            showMessage('Failed to send support message.', 'error');
            setButtonLoading(supportSendBtn, false);
        }
    });
}
