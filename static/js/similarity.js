// similarity.js — Duplicate detection using TF-IDF Cosine + Jaccard similarity
import { db, collection, getDocs, query, where } from './firebase.js';

function getTokens(str) {
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

function calculateJaccard(str1, str2) {
    const set1 = new Set(getTokens(str1));
    const set2 = new Set(getTokens(str2));
    if(set1.size===0 || set2.size===0) return 0;
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
}

function calculateCosine(str1, str2) {
    const toks1 = getTokens(str1);
    const toks2 = getTokens(str2);
    if (!toks1.length || !toks2.length) return 0;
    
    const termFreqs1 = {}, termFreqs2 = {};
    const allTokens = new Set([...toks1, ...toks2]);
    
    toks1.forEach(t => termFreqs1[t] = (termFreqs1[t] || 0) + 1);
    toks2.forEach(t => termFreqs2[t] = (termFreqs2[t] || 0) + 1);
    
    const idf = {};
    for (let t of allTokens) {
        let docsWithTerm = (termFreqs1[t] ? 1 : 0) + (termFreqs2[t] ? 1 : 0);
        idf[t] = Math.log( 3 / (1 + docsWithTerm) ) + 1;
    }
    
    let vec1 = [], vec2 = [];
    for (let t of allTokens) {
        vec1.push((termFreqs1[t] || 0) * idf[t]);
        vec2.push((termFreqs2[t] || 0) * idf[t]);
    }
    
    const norm1 = Math.sqrt(vec1.reduce((sum, v) => sum + v*v, 0));
    const norm2 = Math.sqrt(vec2.reduce((sum, v) => sum + v*v, 0));
    if (norm1 === 0 || norm2 === 0) return 0;
    
    let dot = 0;
    for (let i = 0; i < vec1.length; i++) dot += (vec1[i] / norm1) * (vec2[i] / norm2);
    return dot;
}

function getSimilarityScore(str1, str2) {
    const cosine = calculateCosine(str1, str2);
    const jaccard = calculateJaccard(str1, str2);
    return (cosine * 0.7 + jaccard * 0.3) * 100;
}

export async function checkSimilarityWithDatabase(courseCombined, extractedText) {
    if (!db || !courseCombined || courseCombined === "Not Found" || !extractedText.trim()) return;
    
    let searchCode = courseCombined;
    if (courseCombined.includes("-")) searchCode = courseCombined.split("-")[0].trim();
    else searchCode = courseCombined.substring(0, 10).replace(/[^A-Za-z0-9]/g, '');

    const warningEl = document.getElementById('duplicate-warning');
    warningEl.classList.add('hidden');
    warningEl.innerHTML = '';

    try {
        const q = query(collection(db, "question_papers_multi"), where("courseCode", "==", searchCode));
        const querySnapshot = await getDocs(q);
        
        let maxSim = 0;
        let bestMatch = null;
        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (data.fullExtractedText) {
                const sim = getSimilarityScore(extractedText, data.fullExtractedText);
                if (sim > maxSim) {
                    maxSim = sim;
                    bestMatch = { ...data, sim };
                }
            }
        });
        
        if (maxSim > 45 && bestMatch) {
            const fileUrl = bestMatch.fileUrl || bestMatch.zipUrl || '';
            const explicitType = (bestMatch.fileType || '').toLowerCase();
            const isPdf = explicitType ? explicitType === 'pdf' : fileUrl.toLowerCase().includes('.pdf');
            const isImage = explicitType === 'image' || (!isPdf && !!fileUrl);
            const thumbUrl = bestMatch.thumbnailUrl || (isImage ? fileUrl : '');
            
            warningEl.className = 'dup-warning';
            warningEl.innerHTML = `
                <strong>⚠️ Possible Duplicate Detected (${maxSim.toFixed(1)}% similarity)</strong>
                <p>A previously uploaded <em>${bestMatch.examName}</em> paper for this course appears to be similar. Do not upload duplicate paper</p>
                ${ thumbUrl ? `
                    <div class="dup-thumb-wrap" data-open-url="${fileUrl}">
                        <img src="${thumbUrl}" alt="Similar paper">
                        <span class="dup-thumb-label">View Full →</span>
                    </div>` : isPdf && fileUrl ? `
                    <div class="dup-thumb-wrap" data-open-url="${fileUrl}" style="display:flex;align-items:center;justify-content:center;background:#f7f7f7;">
                        <div style="text-align:center;color:#666;display:flex;flex-direction:column;gap:6px;align-items:center;">
                            <span class="material-symbols-outlined" style="font-size:2rem;color:#d32f2f;">picture_as_pdf</span>
                            <span style="font-size:0.75rem;font-weight:600;">Open Similar PDF</span>
                        </div>
                        <span class="dup-thumb-label">View Full →</span>
                    </div>` : fileUrl ? `<a href="${fileUrl}" target="_blank" class="dl-btn" style="display:inline-block;margin-top:0">View Archived Paper</a>` : '' }
            `;

            const previewEl = warningEl.querySelector('[data-open-url]');
            if (previewEl) {
                previewEl.addEventListener('click', () => {
                    window.open(fileUrl, '_blank');
                });
            }
        }
    } catch (e) { console.error("Similarity Check Error", e); }
}
