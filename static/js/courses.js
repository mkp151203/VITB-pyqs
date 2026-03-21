// courses.js — Course dropdown management

let allCoursesList = [];

export async function fetchCourses() {
    try {
        const res = await fetch('/api/courses');
        allCoursesList = await res.json();
        renderCourseOptions(allCoursesList);
    } catch (e) { console.error(e); }
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
