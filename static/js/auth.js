import { auth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, updateProfile, db, setDoc, doc, getDoc } from './firebase.js';

let currentUser = null;
const authCallbacks = [];

async function syncUserProfile(user) {
    if (!user || !user.uid) return;
    try {
        const profileRef = doc(db, 'user_profiles', user.uid);
        // First check if fields exist; only set defaults for brand-new profiles
        const existing = await getDoc(profileRef);
        const data = existing.exists() ? existing.data() : {};
        const isAnon = data.isAnonymous === true;

        await setDoc(profileRef, {
            displayName: user.displayName || 'Anonymous',
            photoURL: user.photoURL || '',
            lastActive: new Date().toISOString(),
            // Only set defaults if not already present (don't overwrite real counts)
            uploadCount: data.uploadCount ?? 0,
            helpedCount: data.helpedCount ?? 0,
        }, { merge: true });

        // Sync ONLY public, safe display fields to public_leaderboard
        await setDoc(doc(db, 'public_leaderboard', user.uid), {
            displayName: isAnon ? 'Anonymous User' : (user.displayName || 'Contributor'),
            photoURL: isAnon ? '/static/logo.png' : (user.photoURL || '/static/logo.png'),
            uploadCount: data.uploadCount ?? 0,
            isAnonymous: isAnon
        }, { merge: true });
    } catch (e) {
        console.warn('Failed to sync user profile to DB', e);
    }
}

// Listen for auth state changes globally
onAuthStateChanged(auth, async (user) => {
    if (user && user.email && !user.email.endsWith('@vitbhopal.ac.in')) {
        await signOut(auth);
        currentUser = null;
    } else {
        currentUser = user;
        if (user) {
            syncUserProfile(user);
        }
    }
    authCallbacks.forEach(cb => cb(currentUser));
});

export function onAuthChange(callback) {
    authCallbacks.push(callback);
    // immediately trigger with current state if already resolved
    callback(currentUser); 
}

export function getCurrentUser() {
    return currentUser;
}

export async function loginWithGoogle() {
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(auth, provider);
        
        if (result.user && result.user.email && !result.user.email.endsWith('@vitbhopal.ac.in')) {
            await logoutUser();
            throw new Error('Only @vitbhopal.ac.in emails are allowed.');
        }

        return result.user;
    } catch (error) {
        console.error("Login failed", error);
        throw error;
    }
}

export async function logoutUser() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Logout failed", error);
        throw error;
    }
}

export async function updateUserName(newName) {
    if (!currentUser) throw new Error('No user signed in');
    await updateProfile(currentUser, { displayName: newName });
    await syncUserProfile({ uid: currentUser.uid, displayName: newName, photoURL: currentUser.photoURL });
    authCallbacks.forEach(cb => cb(currentUser));
}

export async function getUserProfile() {
    if (!currentUser) return null;
    const snap = await getDoc(doc(db, 'user_profiles', currentUser.uid));
    return snap.exists() ? snap.data() : null;
}

export async function updateAnonymousSetting(isAnon) {
    if (!currentUser) throw new Error('No user signed in');
    await setDoc(doc(db, 'user_profiles', currentUser.uid), { isAnonymous: isAnon }, { merge: true });
    await setDoc(doc(db, 'public_leaderboard', currentUser.uid), {
        displayName: isAnon ? 'Anonymous User' : (currentUser.displayName || 'Contributor'),
        photoURL: isAnon ? '/static/logo.png' : (currentUser.photoURL || '/static/logo.png'),
        isAnonymous: isAnon
    }, { merge: true });
}
