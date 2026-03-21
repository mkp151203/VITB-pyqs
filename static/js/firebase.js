// firebase.js — Firebase initialization and exports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, query, where, doc, updateDoc, increment, arrayUnion, deleteDoc, orderBy, writeBatch, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js";
import { getAuth, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

let app, db, storage, auth;

async function initFirebase() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (config.apiKey && config.apiKey !== "YOUR_API_KEY") {
            app = initializeApp(config);
            db = getFirestore(app);
            storage = getStorage(app);
            auth = getAuth(app);
        } else {
            console.warn("Firebase not configured properly.");
        }
    } catch (e) {
        console.error("Firebase fetch error", e);
    }
}

await initFirebase();

export {
    db,
    storage,
    auth,
    collection,
    addDoc,
    getDocs,
    getDoc,
    query,
    where,
    doc,
    updateDoc,
    increment,
    arrayUnion,
    deleteDoc,
    orderBy,
    writeBatch,
    setDoc,
    serverTimestamp,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    signOut,
    onAuthStateChanged
};
