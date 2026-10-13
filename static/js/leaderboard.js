import { db, collection, getDocs, query, orderBy, limit } from './firebase.js';
import { escapeHtml } from './utils.js';

export async function initLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align: center; color: #888; padding: 40px;">Loading top contributors...</div>';

    try {
        const q = query(
            collection(db, 'public_leaderboard'),
            orderBy('uploadCount', 'desc'),
            limit(50)
        );
        const snapshot = await getDocs(q);
        
        listEl.innerHTML = '';
        if (snapshot.empty) {
            listEl.innerHTML = '<div style="text-align: center; color: #888; padding: 40px;">No contributors yet! Be the first to upload.</div>';
            return;
        }

        let rank = 1;
        snapshot.forEach((doc) => {
            const data = doc.data();
            let { displayName, photoURL, uploadCount, isAnonymous } = data;
            
            if (!uploadCount || uploadCount < 1) return;

            if (isAnonymous === true) {
                displayName = 'Anonymous User';
                photoURL = '/static/logo.png';
            }

            const card = document.createElement('div');
            card.className = 'paper-card';
            card.style.display = 'flex';
            card.style.flexDirection = 'row';
            card.style.alignItems = 'center';
            card.style.padding = '16px';
            card.style.gap = '16px';
            card.style.marginBottom = '12px';
            
            let rankColor = '#666';
            if (rank === 1) rankColor = '#f59e0b'; // Gold
            else if (rank === 2) rankColor = '#94a3b8'; // Silver
            else if (rank === 3) rankColor = '#b45309'; // Bronze
            
            const rankStyle = rank <= 3 ? `font-size: 1.6rem; font-weight: 800; color: ${rankColor}; width: 36px; text-align: center;` : `font-size: 1.2rem; font-weight: 600; color: #888; width: 36px; text-align: center;`;

            const safePhoto = (photoURL && (photoURL.startsWith('https://') || photoURL.startsWith('http://') || photoURL.startsWith('/')))
                ? escapeHtml(photoURL)
                : '/static/logo.png';
            const safeDisplayName = escapeHtml(displayName || 'Anonymous User');
            const safeUploadCount = Number(uploadCount) || 0;

            card.innerHTML = `
                <div style="${rankStyle}">#${rank}</div>
                <img src="${safePhoto}" alt="Avatar" style="width: 50px; height: 50px; border-radius: 50%; object-fit: contain; border: 2px solid #eee;">
                <div style="flex: 1; min-width:0; text-align: left;">
                    <h3 style="margin: 0; font-size: 1.05rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${safeDisplayName}
                    </h3>
                    <p style="margin: 4px 0 0; color: #666; font-size: 0.9rem;"><strong>${safeUploadCount}</strong> ${safeUploadCount === 1 ? 'paper' : 'papers'} uploaded</p>
                </div>
            `;
            listEl.appendChild(card);
            rank++;
        });
        
        if (listEl.children.length === 0) {
             listEl.innerHTML = '<div style="text-align: center; color: #888; padding: 40px;">No contributors have uploaded papers yet!</div>';
        }

    } catch (e) {
        console.error("Failed to load leaderboard", e);
        if (e?.code === 'permission-denied') {
            listEl.innerHTML = '<div style="text-align: center; color: #888; padding: 40px;">Leaderboard unavailable. Please ensure the latest rules are published in Firebase Console.</div>';
        } else if (e?.message && e.message.toLowerCase().includes('index')) {
            listEl.innerHTML = '<div style="text-align: center; color: #888; padding: 40px;">Firestore is configuring an index. Please try again in 5 minutes!</div>';
        } else {
            listEl.innerHTML = '<div style="text-align: center; color: #888; padding: 40px;">No contributors yet! Be the first to upload.</div>';
        }
    }
}
