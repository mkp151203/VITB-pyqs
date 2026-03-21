import {
    auth,
    db,
    getDoc,
    doc,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    onAuthStateChanged,
    signOut
} from './firebase.js';

const googleSigninBtn = document.getElementById('google-signin-btn');

function showMessage(message, type = 'error') {
    const el = document.getElementById('global-message');
    if (!el) return;
    el.innerText = message;
    el.className = type;
}

function getReadableAuthError(error) {
    const code = error?.code || 'unknown';
    if (code === 'auth/unauthorized-domain') {
        return 'This domain is not authorized in Firebase Auth. Add current host in Authentication > Settings > Authorized domains.';
    }
    if (code === 'auth/operation-not-allowed') {
        return 'Google Sign-In is disabled in Firebase Authentication. Enable Google provider in Sign-in method.';
    }
    if (code === 'auth/popup-blocked') {
        return 'Popup was blocked by browser. Trying redirect login...';
    }
    if (code === 'auth/popup-closed-by-user') {
        return 'Sign-in popup was closed before completion.';
    }
    if (code === 'auth/cancelled-popup-request') {
        return 'Popup request was cancelled. Trying redirect login...';
    }
    return `Google sign-in failed (${code}).`;
}

async function isAdminUid(uid) {
    if (!db || !uid) return false;
    const adminDoc = await getDoc(doc(db, 'admin_users', uid));
    return adminDoc.exists();
}

async function handleSignedInUser(user) {
    if (!user) return;
    try {
        const admin = await isAdminUid(user.uid);
        if (admin) {
            window.location.href = '/admin/dashboard';
            return;
        }
        await signOut(auth);
        showMessage('This Google account is not allowed for admin access.');
        if (googleSigninBtn) googleSigninBtn.disabled = false;
    } catch (error) {
        console.error('Admin verification failed', error);
        await signOut(auth);
        showMessage('Failed to verify admin access.');
        if (googleSigninBtn) googleSigninBtn.disabled = false;
    }
}

async function setupGoogleSignIn() {
    if (!auth) {
        showMessage('Firebase auth is not configured.');
        return;
    }

    try {
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult?.user) {
            await handleSignedInUser(redirectResult.user);
            return;
        }
    } catch (error) {
        console.error('Redirect sign-in failed', error);
        showMessage(getReadableAuthError(error));
    }

    onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        await handleSignedInUser(user);
    });

    googleSigninBtn?.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        googleSigninBtn.disabled = true;
        showMessage('Opening Google sign-in...', 'success');

        try {
            const result = await signInWithPopup(auth, provider);
            await handleSignedInUser(result.user);
        } catch (error) {
            const popupBlocked = error?.code === 'auth/popup-blocked' || error?.code === 'auth/cancelled-popup-request';
            if (popupBlocked) {
                showMessage(getReadableAuthError(error), 'success');
                await signInWithRedirect(auth, provider);
                return;
            }
            console.error('Popup sign-in failed', error);
            showMessage(getReadableAuthError(error));
            googleSigninBtn.disabled = false;
        }
    });
}

setupGoogleSignIn();
