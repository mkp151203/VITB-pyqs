import { db, collection, getDocs, doc, setDoc, deleteDoc, query, where, orderBy, getDoc, increment } from './firebase.js';
import { getCurrentUser, logoutUser, updateUserName, getUserProfile, updateAnonymousSetting, onAuthChange } from './auth.js';

let isInitialized = false;

export function refreshAccountView() {
    if (!document.getElementById('account-view').classList.contains('hidden')) {
        const subView = sessionStorage.getItem('accountSubView');
        if (subView === 'uploads') {
            document.getElementById('btn-show-uploads')?.click();
        } else {
            // default to collections
            document.getElementById('btn-show-collections')?.click();
        }
    }
}

export function initAccount() {
    if (isInitialized) return;
    isInitialized = true;

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await logoutUser();
    });

    document.getElementById('btn-show-collections')?.addEventListener('click', () => {
        document.getElementById('btn-show-collections').classList.replace('btn-secondary', 'btn-primary');
        document.getElementById('btn-show-uploads').classList.replace('btn-primary', 'btn-secondary');
        document.getElementById('collections-container').classList.remove('hidden');
        document.getElementById('uploads-container').classList.add('hidden');
        document.getElementById('collection-details-container').classList.add('hidden');
        sessionStorage.setItem('accountSubView', 'collections');
        loadMyCollections();
    });

    document.getElementById('btn-show-uploads')?.addEventListener('click', () => {
        document.getElementById('btn-show-uploads').classList.replace('btn-secondary', 'btn-primary');
        document.getElementById('btn-show-collections').classList.replace('btn-primary', 'btn-secondary');
        document.getElementById('uploads-container').classList.remove('hidden');
        document.getElementById('collections-container').classList.add('hidden');
        document.getElementById('collection-details-container').classList.add('hidden');
        sessionStorage.setItem('accountSubView', 'uploads');
        loadMyUploads();
    });

    document.getElementById('btn-back-collections')?.addEventListener('click', () => {
        document.getElementById('collection-details-container').classList.add('hidden');
        document.getElementById('collections-container').classList.remove('hidden');
        loadMyCollections();
    });

    document.getElementById('btn-create-collection')?.addEventListener('click', async () => {
        let name = prompt('Enter a name for the new collection (max 30 chars):');
        if (name && name.trim()) {
            name = name.trim().slice(0, 30);
            await createCollection(name);
            loadMyCollections();
        }
    });

    document.getElementById('btn-edit-username')?.addEventListener('click', () => {
        const user = getCurrentUser();
        if (!user) return;
        document.getElementById('input-edit-username').value = user.displayName || '';
        document.getElementById('edit-username-container').classList.remove('hidden');
        document.getElementById('account-name').classList.add('hidden');
        document.getElementById('btn-edit-username').classList.add('hidden');
    });

    document.getElementById('btn-cancel-username')?.addEventListener('click', () => {
        document.getElementById('edit-username-container').classList.add('hidden');
        document.getElementById('account-name').classList.remove('hidden');
        document.getElementById('btn-edit-username').classList.remove('hidden');
    });

    document.getElementById('btn-save-username')?.addEventListener('click', async () => {
        const newName = document.getElementById('input-edit-username').value.trim().slice(0, 20);
        if (newName) {
            try {
                document.getElementById('btn-save-username').disabled = true;
                document.getElementById('btn-save-username').innerText = '...';
                await updateUserName(newName);
            } catch(e) {
                console.error(e);
                alert('Failed to update username');
            } finally {
                document.getElementById('btn-save-username').disabled = false;
                document.getElementById('btn-save-username').innerText = 'Save';
                document.getElementById('edit-username-container').classList.add('hidden');
                document.getElementById('account-name').classList.remove('hidden');
                document.getElementById('btn-edit-username').classList.remove('hidden');
            }
        }
    });

    document.getElementById('btn-account-upload')?.addEventListener('click', () => {
        document.getElementById('tab-upload').click();
        document.getElementById('file-upload-input').click();
    });

    document.getElementById('btn-account-search')?.addEventListener('click', () => {
        document.getElementById('tab-search').click();
    });

    document.getElementById('btn-search-from-collection')?.addEventListener('click', () => {
        document.getElementById('tab-search').click();
    });

    document.getElementById('checkbox-anonymous')?.addEventListener('change', async (e) => {
        const isAnon = e.target.checked;
        e.target.disabled = true;
        try {
            await updateAnonymousSetting(isAnon);
        } catch (err) {
            console.error('Failed to update anonymity setting', err);
            e.target.checked = !isAnon; // revert
            alert('Failed to save anonymous preference.');
        } finally {
            e.target.disabled = false;
        }
    });

    // Listen to Auth State
    onAuthChange(async (user) => {
        const unauthEl = document.getElementById('account-unauthenticated');
        const authEl = document.getElementById('account-authenticated');
        const authText = document.getElementById('auth-text');
        
        if (user) {
            unauthEl?.classList.add('hidden');
            authEl?.classList.remove('hidden');
            if (authText) authText.innerText = 'My Account';
            
            document.getElementById('account-name').innerText = user.displayName || 'User';
            document.getElementById('account-email').innerText = user.email || '';
            document.getElementById('account-avatar').src = user.photoURL || '/static/logo.png';
            
            // Fetch dynamic profile properties
            const profile = await getUserProfile();
            const anonCheckbox = document.getElementById('checkbox-anonymous');
            if (anonCheckbox) {
                anonCheckbox.checked = profile?.isAnonymous === true;
            }

            // Default to remembering user's last tab config
            if (!document.getElementById('account-view').classList.contains('hidden')) {
                refreshAccountView();
            }
        } else {
            unauthEl?.classList.remove('hidden');
            authEl?.classList.add('hidden');
            if (authText) authText.innerText = 'Login';
        }
    });

    // Modal logic for adding paper to collection
    const closeModalBtns = document.querySelectorAll('[data-close-modal="collection"]');
    closeModalBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('save-collection-modal').classList.add('hidden');
            window.currentPaperToSave = null;
        });
    });

    document.getElementById('btn-quick-create-collection')?.addEventListener('click', async () => {
        const input = document.getElementById('new-collection-name');
        const name = input.value.trim();
        if (name) {
            await createCollection(name);
            input.value = '';
            // Reload modal list
            openCollectionModal(window.currentPaperToSave);
        }
    });
}

function buildPaperFileNameLocal(paper, index) {
    const ext = (paper.fileType || '').toLowerCase() === 'image' ? 'webp' : 'pdf';
    return `paper_${index + 1}.${ext}`;
}

async function loadMyUploads() {
    const user = getCurrentUser();
    if (!user) return;

    const listEl = document.getElementById('uploads-list');
    listEl.innerHTML = '<div class="loader" style="margin: 20px auto;"></div>';

    try {
        const q = query(collection(db, "question_papers_multi"), where("uploadedBy", "==", user.uid));
        const snapshot = await getDocs(q);
        
        const papers = [];
        snapshot.forEach(doc => papers.push({ id: doc.id, ...doc.data() }));
        papers.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        if (papers.length === 0) {
            listEl.innerHTML = '<p class="text-center" style="grid-column: 1/-1; padding: 40px; color: #888;">You have not uploaded any papers yet.</p>';
            return;
        }

        renderPapers(papers, listEl, 'uploads');
    } catch (e) {
        console.error(e);
        listEl.innerHTML = '<p style="color:red;">Failed to load uploads.</p>';
    }
}

async function loadMyCollections() {
    const user = getCurrentUser();
    if (!user) return;

    const listEl = document.getElementById('collections-list');
    listEl.innerHTML = '<div class="loader" style="margin: 20px auto;"></div>';

    try {
        const q = query(collection(db, "user_collections"), where("userId", "==", user.uid));
        const snapshot = await getDocs(q);
        
        const myCollections = [];
        snapshot.forEach(doc => myCollections.push({ id: doc.id, ...doc.data() }));
        myCollections.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        if (myCollections.length === 0) {
            listEl.innerHTML = '<p class="text-center" style="grid-column: 1/-1; padding: 40px; color: #888;">You have no collections.</p>';
            return;
        }

        listEl.innerHTML = '';
        myCollections.forEach(c => {
            const papersCount = (c.paperIds || []).length;
            const div = document.createElement('div');
            div.className = 'paper-card';
            div.style.cursor = 'pointer';
            div.innerHTML = `
                <div class="paper-details" style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h3>${c.name}</h3>
                        <p style="margin: 4px 0 0; color:#888; font-size: 0.82rem;">${papersCount} paper${papersCount !== 1 ? 's' : ''} saved</p>
                    </div>
                     <span class="material-symbols-outlined" style="font-size:1.4rem; color:#ccc;">chevron_right</span>
                </div>
            `;
            div.addEventListener('click', () => {
                openCollectionDetails(c);
            });
            listEl.appendChild(div);
        });

    } catch (e) {
        console.error(e);
        listEl.innerHTML = '<p style="color:red;">Failed to load collections.</p>';
    }
}

async function openCollectionDetails(collectionItem) {
    document.getElementById('collections-container').classList.add('hidden');
    document.getElementById('collection-details-container').classList.remove('hidden');
    document.getElementById('current-collection-name').innerText = collectionItem.name;
    
    const listEl = document.getElementById('collection-papers-list');
    listEl.innerHTML = '<div class="loader" style="margin: 20px auto;"></div>';

    // Handle delete button
    const delBtn = document.getElementById('btn-delete-collection');
    const newDelBtn = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(newDelBtn, delBtn);
    newDelBtn.addEventListener('click', async () => {
        if(confirm(`Are you sure you want to delete collection "${collectionItem.name}"?`)){
            await deleteDoc(doc(db, "user_collections", collectionItem.id));
            document.getElementById('btn-back-collections').click();
        }
    });

    try {
        const paperIds = collectionItem.paperIds || [];
        if (paperIds.length === 0) {
            listEl.innerHTML = '<p class="text-center" style="grid-column: 1/-1; padding: 40px; color: #888;">This collection is empty.</p>';
            return;
        }

        const papers = [];
        // Firestore batch limits (in operator max 10) means we fetch individually or in chunks.
        // For simplicity, fetch all concurrently
        const fetches = paperIds.map(id => getDoc(doc(db, "question_papers_multi", id)));
        const docs = await Promise.all(fetches);
        docs.forEach((docSnap) => {
            if (docSnap.exists()) {
                papers.push({ id: docSnap.id, ...docSnap.data() });
            }
        });

        if (papers.length === 0) {
            listEl.innerHTML = '<p class="text-center" style="grid-column: 1/-1; color: #888;">All papers in this collection have been deleted.</p>';
            return;
        }

        renderPapers(papers, listEl, 'collections', collectionItem);

    } catch(e) {
        console.error(e);
        listEl.innerHTML = '<p style="color:red;">Failed to load papers.</p>';
    }
}

// Basic paper renderer to reuse card UI from search
function renderPapers(papers, container, context = 'collections', parentCollection = null) {
    container.innerHTML = '';
    papers.forEach(p => {
        const div = document.createElement('div');
        div.className = 'paper-card';
        
        const fileUrl = p.fileUrl || '';
        const explicitType = (p.fileType || '').toLowerCase();
        const isPdf = explicitType ? explicitType === 'pdf' : fileUrl.toLowerCase().includes('.pdf');
        const isSingleImage = explicitType === 'image' || (!isPdf && (p.pageCount || 1) === 1);
        
        let previewHtml = '';
        if (fileUrl) {
            if (isPdf) {
                previewHtml = `
                <div style="position:relative;height:120px;overflow:hidden;border-radius:8px;margin-top:10px;border:1px solid #e0e0e0;background:#f0f0f0;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="window.open('${fileUrl}', '_blank')">
                    <span class="material-symbols-outlined" style="font-size:32px;color:#aaa;">picture_as_pdf</span>
                </div>`;
            } else {
                previewHtml = `
                <div onclick="window.open('${fileUrl}', '_blank')" style="margin-top:10px;height:120px;border-radius:8px;overflow:hidden;cursor:pointer;">
                    <img src="${fileUrl}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">
                </div>`;
            }
        }

        let actionHtml = '';
        if (context === 'collections') {
            actionHtml = `<button class="btn-remove-col btn-report" style="margin-top: 8px; width: 100%;">Remove from Collection</button>`;
        } else if (context === 'uploads') {
            actionHtml = `
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button class="btn-save-collection btn-secondary" style="flex:1; display:flex; align-items:center; justify-content:center; gap:4px; padding: 6px; font-size:0.85rem; border:none; border-radius:6px; cursor:pointer; color:#333; background:#eef0f2;">
                    <span class="material-symbols-outlined" style="font-size:1.1rem;">bookmark</span> Save
                </button>
                <button class="btn-delete-upload btn-report" style="flex:1; padding: 6px; font-size:0.85rem;">Delete</button>
            </div>`;
        }

        let displayTitle = p.courseTitle || p.courseCombined || 'Unknown Course';
        if (displayTitle.includes(' - ')) {
            displayTitle = displayTitle.split(' - ').slice(1).join(' - ').trim();
        }
        
        div.innerHTML = `
            <div class="paper-details">
                <h4 style="margin:0 0 4px;">${displayTitle}</h4>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem; color:#555;">${p.examName || 'Exam'}</span>
                    <span style="font-size:0.8rem; color:#999;">${new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                ${previewHtml}
            </div>
            <div class="paper-actions" style="display:flex; flex-direction:column;">
                <a href="${fileUrl}" target="_blank" class="btn-dl" style="width:100%; text-align:center; padding:9px;">
                    <span class="material-symbols-outlined" style="font-size:1rem; vertical-align:middle;">open_in_new</span> Open Paper
                </a>
                ${actionHtml}
            </div>
        `;
        
        if (context === 'collections') {
            div.querySelector('.btn-remove-col')?.addEventListener('click', async () => {
                div.style.opacity = 0.5;
                const newIds = parentCollection.paperIds.filter(id => id !== p.id);
                try {
                    await setDoc(doc(db, "user_collections", parentCollection.id), { paperIds: newIds }, { merge: true });
                    parentCollection.paperIds = newIds;
                    div.remove();
                    if(parentCollection.paperIds.length === 0) {
                        openCollectionDetails(parentCollection); // re-trigger to show empty state
                    }
                } catch(e) {
                    console.error("Failed to remove paper", e);
                    div.style.opacity = 1;
                }
            });
        } else if (context === 'uploads') {
            div.querySelector('.btn-save-collection')?.addEventListener('click', () => {
                openCollectionModal(p);
            });
            div.querySelector('.btn-delete-upload')?.addEventListener('click', async () => {
                if (confirm('Are you sure you want to permanently delete this paper?')) {
                    div.style.opacity = 0.5;
                    try {
                        const user = getCurrentUser();
                        await deleteDoc(doc(db, "question_papers_multi", p.id));
                        // Decrement the user's leaderboard count
                        if (user) {
                            try {
                                await setDoc(doc(db, 'user_profiles', user.uid), { uploadCount: increment(-1) }, { merge: true });
                            } catch (e) {
                                console.warn('Failed to decrement upload count', e);
                            }
                        }
                        div.remove();
                        if (container.children.length === 0) {
                            container.innerHTML = '<p class="text-center" style="grid-column: 1/-1; padding: 40px; color: #888;">You have not uploaded any papers yet.</p>';
                        }
                    } catch(e) {
                        console.error("Failed to delete", e);
                        div.style.opacity = 1;
                        alert('Failed to delete paper. Ensure you are signed in.');
                    }
                }
            });
        }
        
        container.appendChild(div);
    });
}

async function createCollection(name) {
    const user = getCurrentUser();
    if (!user) return;
    try {
        const docRef = doc(collection(db, "user_collections"));
        await setDoc(docRef, {
            userId: user.uid,
            name: name,
            paperIds: [],
            createdAt: new Date().toISOString()
        });
    } catch(e) {
        console.error("Collection create failed", e);
    }
}

// Exported to be called from search.js when "Save to collection" occurs
export async function openCollectionModal(paper) {
    const user = getCurrentUser();
    if (!user) {
        alert("Please login from 'My Account' tab to save papers.");
        return;
    }

    window.currentPaperToSave = paper;
    const modal = document.getElementById('save-collection-modal');
    modal.classList.remove('hidden');

    const listEl = document.getElementById('save-collection-list');
    listEl.innerHTML = '<div style="text-align: center; color: #888;">Loading...</div>';

    try {
        const q = query(collection(db, "user_collections"), where("userId", "==", user.uid));
        const snapshot = await getDocs(q);
        
        const collections = [];
        snapshot.forEach(doc => collections.push({ id: doc.id, ...doc.data() }));
        collections.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        if (collections.length === 0) {
            listEl.innerHTML = '<p class="text-center" style="color: #666;">You have no collections yet.</p>';
            return;
        }

        listEl.innerHTML = '';
        collections.forEach(c => {
            const isSaved = (c.paperIds || []).includes(paper.id);
            const div = document.createElement('div');
            div.style = "display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;";
            div.innerHTML = `
                <div style="font-weight: 500;">${c.name} <span style="font-size:0.8rem;color:#888;">(${(c.paperIds||[]).length})</span></div>
                <button class="btn btn-sm ${isSaved ? 'btn-secondary' : 'btn-primary'}" ${isSaved ? 'disabled' : ''}>
                    ${isSaved ? 'Saved' : 'Save'}
                </button>
            `;
            if (!isSaved) {
                const btn = div.querySelector('button');
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    btn.innerText = 'Saving...';
                    try {
                        const newIds = [...(c.paperIds||[]), paper.id];
                        await setDoc(doc(db, "user_collections", c.id), { paperIds: newIds }, { merge: true });
                        btn.classList.replace('btn-primary', 'btn-secondary');
                        btn.innerText = 'Saved';
                    } catch(e) {
                        btn.disabled = false;
                        btn.innerText = 'Save';
                        alert('Failed to save paper.');
                    }
                });
            }
            listEl.appendChild(div);
        });

    } catch (e) {
        listEl.innerHTML = '<p style="color:red;">Error loading collections.</p>';
        console.error(e);
    }
}
