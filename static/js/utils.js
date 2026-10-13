/**
 * Common security, sanitization, and input validation utilities
 */

export function escapeHtml(input = '') {
    if (input === null || input === undefined) return '';
    return String(input)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function sanitizeUrl(url = '') {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('/')) {
        return escapeHtml(trimmed);
    }
    return '';
}

/**
 * Checks if a string contains potential script injection, event handlers, or HTML tags
 */
export function hasInjection(str = '') {
    if (!str) return false;
    return /[<>]|javascript:|onload=|onerror=|onclick=|<script/i.test(String(str));
}

/**
 * Validates course code format (e.g. CSE1001, MAT2001, STS3001)
 */
export function isValidCourseCode(code = '') {
    if (!code) return false;
    const trimmed = String(code).trim().toUpperCase();
    return /^[A-Z0-9\-_]{2,12}$/.test(trimmed) && !hasInjection(trimmed);
}

/**
 * Validates course title
 */
export function isValidCourseTitle(title = '') {
    if (!title) return false;
    const trimmed = String(title).trim();
    return trimmed.length >= 2 && trimmed.length <= 100 && !hasInjection(trimmed);
}

/**
 * Validates slot string (e.g. A11, A11+B12)
 */
export function isValidSlot(slot = '') {
    if (!slot) return true; // Optional
    const trimmed = String(slot).trim().toUpperCase();
    if (trimmed.length > 30) return false;
    return /^[A-Za-z]\d{2}(\+[A-Za-z]\d{2})*$/.test(trimmed) && !hasInjection(trimmed);
}

/**
 * Validates exam name against allowed enum
 */
export function isValidExamName(exam = '') {
    const allowed = ['CAT-1', 'CAT-2', 'FAT', 'Midterm'];
    return allowed.includes(String(exam).trim());
}

/**
 * Validates usernames (alphanumeric, spaces, basic punctuation)
 */
export function isValidUsername(name = '') {
    if (!name) return false;
    const trimmed = String(name).trim();
    return trimmed.length >= 2 && trimmed.length <= 30 && /^[a-zA-Z0-9 _.-]{2,30}$/.test(trimmed) && !hasInjection(trimmed);
}

/**
 * Validates collection name
 */
export function isValidCollectionName(name = '') {
    if (!name) return false;
    const trimmed = String(name).trim();
    return trimmed.length >= 1 && trimmed.length <= 50 && !hasInjection(trimmed);
}
