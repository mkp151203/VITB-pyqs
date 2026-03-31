// courses.js — Course dropdown management
import { db, collection, getDocs } from './firebase.js';

let allCoursesList = [];
const OTHER_COURSE_VALUE = '__other__';

function toggleCustomCourseFields(show) {
    const wrapper = document.getElementById('custom-course-fields');
    const codeInput = document.getElementById('custom-course-code');
    const titleInput = document.getElementById('custom-course-title');
    if (!wrapper || !codeInput || !titleInput) return;

    if (show) {
        wrapper.classList.remove('hidden');
        codeInput.required = true;
        titleInput.required = true;
    } else {
        wrapper.classList.add('hidden');
        codeInput.required = false;
        titleInput.required = false;
        codeInput.value = '';
        titleInput.value = '';
    }
}

function selectCourse(value, label = value) {
    const courseTitleInput = document.getElementById('course-title');
    const courseText = document.getElementById('course-select-text');
    const dropdown = document.getElementById('course-select-dropdown');
    if (!courseTitleInput || !courseText) return;

    courseTitleInput.value = value;
    courseText.innerText = label;
    dropdown?.classList.add('hidden');
    toggleCustomCourseFields(value === OTHER_COURSE_VALUE);

    const ev = new Event('change');
    courseTitleInput.dispatchEvent(ev);
}

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
    // Load from both sources and merge (Firestore primary, CSV fallback)
    let firestoreCourses = [];
    let apiCourses = [];

    try {
        firestoreCourses = await loadCoursesFromFirestore();
    } catch (e) {
        console.warn('Firestore courses_catalog unavailable:', e.message || e);
    }

    try {
        apiCourses = await loadCoursesFromApi();
    } catch (e) {
        console.warn('API courses fallback unavailable:', e.message || e);
    }

    // Merge both lists — Firestore entries take priority via deduplication
    return dedupeAndSortCourses([...firestoreCourses, ...apiCourses]);
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

    const otherLi = document.createElement('li');
    otherLi.textContent = 'Other';
    otherLi.dataset.value = OTHER_COURSE_VALUE;
    otherLi.addEventListener('click', () => {
        selectCourse(OTHER_COURSE_VALUE, 'Other');
    });
    listEl.appendChild(otherLi);

    courses.forEach(c => {
        const li = document.createElement('li');
        li.textContent = c;
        li.dataset.value = c;
        li.addEventListener('click', () => {
            selectCourse(c, c);
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
