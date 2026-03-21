// courses.js — Course dropdown management
import { db, collection, getDocs } from './firebase.js';

let allCoursesList = [];

function normalizeCourseString(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function dedupeAndSortCourses(values) {
    const normalized = values
        .map(normalizeCourseString)
        .filter(Boolean);
    return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

async function loadCoursesFromApi() {
    const res = await fetch('/api/courses');
    if (!res.ok) throw new Error(`API failed with ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('Invalid /api/courses response');
    return dedupeAndSortCourses(list);
}

async function loadCoursesFromFirestore() {
    if (!db) return [];
    const snapshot = await getDocs(collection(db, 'courses_catalog'));
    const list = [];
    snapshot.forEach((docItem) => {
        const data = docItem.data() || {};
        const combined = data.courseCombined || data.course || data.name;
        if (combined) {
            list.push(combined);
            return;
        }

        const code = (data.courseCode || data.code || '').toString().trim();
        const title = (data.courseTitle || data.title || '').toString().trim();
        if (code && title) {
            list.push(`${code} - ${title}`);
        } else if (code) {
            list.push(code);
        } else if (title) {
            list.push(title);
        }
    });
    return dedupeAndSortCourses(list);
}

export async function loadCourseCatalog() {
    try {
        const firestoreCourses = await loadCoursesFromFirestore();
        if (firestoreCourses.length) return firestoreCourses;
    } catch (e) {
        console.warn('Firestore courses_catalog unavailable, trying API fallback:', e.message || e);
    }

    try {
        return await loadCoursesFromApi();
    } catch (e) {
        console.error('API course fallback failed:', e);
        return [];
    }
}

export async function fetchCourses() {
    try {
        allCoursesList = await loadCourseCatalog();
        renderCourseOptions(allCoursesList);
    } catch (e) {
        console.error(e);
        allCoursesList = [];
        renderCourseOptions(allCoursesList);
    }
}

function renderCourseOptions(courses) {
    const listEl = document.getElementById('course-options-list');
    if(!listEl) return;
    listEl.innerHTML = '';
    courses.forEach(c => {
        const li = document.createElement('li');
        li.textContent = c;
        li.dataset.value = c;
        li.addEventListener('click', () => {
            document.getElementById('course-title').value = c;
            document.getElementById('course-select-text').innerText = c;
            document.getElementById('course-select-dropdown').classList.add('hidden');
            
            // Trigger change for similarity checking
            const ev = new Event('change');
            document.getElementById('course-title').dispatchEvent(ev);
        });
        listEl.appendChild(li);
    });
}

// Toggle dropdown
document.getElementById('course-select-header')?.addEventListener('click', () => {
    const dropdown = document.getElementById('course-select-dropdown');
    dropdown.classList.toggle('hidden');
    if (!dropdown.classList.contains('hidden')) {
        document.getElementById('course-search-input').focus();
    }
});

// Filter courses on search
document.getElementById('course-search-input')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allCoursesList.filter(c => c.toLowerCase().includes(term));
    renderCourseOptions(filtered);
});

// Close dropdown if clicked outside
document.addEventListener('click', (e) => {
    const container = document.getElementById('course-select-container');
    if (container && !container.contains(e.target)) {
        document.getElementById('course-select-dropdown')?.classList.add('hidden');
    }
});
