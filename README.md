# 📚 VIT Bhopal PYQs — Question Paper Repository

A smart, community-driven question paper repository for VIT Bhopal University students. Upload photos of question papers, and the app **automatically detects** the course name and exam type using client-side **OCR + AI matching**, then archives the document to a searchable cloud database.

🔗 **Live:** [vitbhopal-pyq.vercel.app](https://vitbhopal-pyq.vercel.app)

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 📷 **Scan & Upload** | Capture or upload multi-page question paper images |
| 🤖 **AI Auto-Detect** | Tesseract.js OCR extracts course code, title & exam type from page 1 |
| ✂️ **Smart Crop** | Interactive perspective-warp transform to deskew tilted photos |
| 🔄 **Drag & Reorder** | Rearrange pages with drag-and-drop before generating the final PDF |
| 🔍 **Duplicate Detection** | TF-IDF Cosine + Jaccard similarity flags near-duplicate uploads |
| 📂 **3-Level Search** | Browse papers: Subject → Exam Type → Individual Papers |
| 📥 **Bulk Download** | Download all papers for a subject as a single ZIP |
| 📄 **PDF Preview** | In-app PDF rendering via PDF.js (no download needed) |
| 📋 **Paper Requests** | Request papers others can fulfill — community-powered |
| 🛡️ **Admin Dashboard** | Manage papers, view reports, moderate uploads |
| 🌐 **SEO Optimized** | Dynamic course landing pages, sitemap, schema.org markup |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Browser (Client)                   │
│                                                      │
│  upload.js ─→ crop.js ─→ Tesseract.js OCR            │
│      │            │              │                    │
│      │            │              ▼                    │
│      │            │      similarity.js (NLP)          │
│      │            │              │                    │
│      ▼            ▼              ▼                    │
│  jsPDF assembly ──────→ Firebase Storage              │
│                         Firebase Firestore            │
└──────────────────┬───────────────────────────────────┘
                   │  /api/parse, /api/config
                   ▼
┌──────────────────────────────────────────────────────┐
│           Flask Backend (api/index.py)                │
│                                                      │
│  • Regex + fuzzy matching (difflib) for metadata     │
│  • Course CSV database lookup                        │
│  • SEO landing pages (/courses, /pyq/<slug>)         │
│  • PDF/file proxy for CORS-free previews             │
└──────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **Firebase project** with Firestore & Cloud Storage enabled
- **Git**

### 1. Clone the Repository

```bash
git clone https://github.com/mkp151203/VITB-pyqs.git
cd VITB-pyqs
```

### 2. Create a Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Create a `.env` file in the project root with your Firebase credentials:

```env
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
```

### 5. Run Locally

```bash
python api/index.py
```

The app will be available at **http://localhost:5000**.

---

## 📖 How to Use

### Uploading a Question Paper

1. **Open the app** and go to the **Scan & Upload** tab.
2. **Capture or upload** — click **Take Photo** (uses device camera) or **Upload Images** (from gallery). You can add up to 10 pages.
3. **Arrange pages** — drag to reorder. Tap any page to open the **crop editor**.
4. **Crop & deskew** — drag the 4 corner handles to align with the document edges, then tap **Preview** → **Save Crop**. The app applies a perspective warp to flatten the image.
5. **Click Next** — the app runs OCR on page 1 and auto-detects the **course** and **exam type**.
6. **Verify metadata** — confirm or correct the detected course (searchable dropdown) and exam type.
7. **Upload** — the app compresses pages, generates a PDF (or stores a single image), uploads to Firebase, and saves metadata to Firestore.

### Searching for Papers

1. Switch to the **Search Papers** tab.
2. **Browse subjects** — paginated list of all available courses.
3. **Search** — type a course code or name in the search bar.
4. **Drill down** — click a subject → choose **Midterm** or **Term End** → view individual papers with preview.
5. **Download** — click **Download PDF** for individual papers, or **Download ZIP** for all papers in a subject.

### Requesting a Paper

1. Click **Request Paper** on the upload tab.
2. Select the course and exam type you need.
3. Your request appears in the **Help Others** section for other students to fulfill.

### Admin Dashboard

Navigate to `/admin` to access the admin login. Admins can:
- View and delete uploaded papers
- Manage reported papers
- Monitor upload activity

---

## 📁 Project Structure

```
firebase_app/
├── api/
│   ├── index.py              # Flask backend — routes, OCR parsing, SEO pages
│   └── courses.csv           # Master course database (code → title mapping)
├── static/
│   ├── css/
│   │   └── style.css         # Complete UI stylesheet
│   ├── js/
│   │   ├── app.js            # App initialization, tab/view management
│   │   ├── upload.js          # Image handling, OCR, PDF generation, upload
│   │   ├── crop.js            # Perspective-warp crop engine with rotation
│   │   ├── similarity.js      # TF-IDF + Jaccard duplicate detection
│   │   ├── search.js          # 3-level search navigation + ZIP download
│   │   ├── courses.js         # Course catalog loader
│   │   ├── firebase.js        # Firebase SDK initialization & exports
│   │   ├── feedback.js        # Support/report messaging
│   │   ├── requests.js        # Paper request system
│   │   ├── admin.js           # Admin dashboard logic
│   │   ├── admin_login.js     # Admin authentication
│   │   └── bulk_uploader.js   # Bulk upload interface
│   └── logo.png
├── index.html                 # Main SPA — upload + search interface
├── admin.html                 # Admin dashboard page
├── admin_login.html           # Admin login page
├── bulk_uploader.html         # Bulk upload page
├── vercel.json                # Vercel deployment config
├── requirements.txt           # Python dependencies
├── robots.txt                 # Search engine directives
├── sitemap.xml                # Dynamic sitemap
└── .env                       # Firebase credentials (not committed)
```

---

## 🔧 Technical Details

### Computer Vision Pipeline

| Step | Technique | Implementation |
|---|---|---|
| **Resizing** | Proportional downscale to max 1600px | `upload.js` |
| **Compression** | Adaptive WebP (quality 0.85 → 0.30, then dimension reduction) | `upload.js` |
| **Deskewing** | Perspective warp via 3×3 homography (Gaussian elimination) | `crop.js` |
| **OCR** | Tesseract.js v5 (LSTM-based, English model) | `upload.js` |
| **Text Parsing** | Multi-tier regex + difflib fuzzy matching | `api/index.py` |

### NLP Similarity Engine

- **Tokenization:** Character-level trigrams (robust to OCR errors)
- **Cosine Similarity:** TF-IDF weighted vectors with IDF = ln(3/(1+df)) + 1
- **Jaccard Similarity:** Set intersection/union of trigram tokens
- **Combined Score:** `(Cosine × 0.7 + Jaccard × 0.3) × 100`
- **Threshold:** >50% triggers duplicate warning

### OCR Error Correction

Common misread characters are auto-corrected before course code matching:

| OCR Output | Corrected To |
|---|---|
| `O` | `0` |
| `I` or `l` | `1` |
| `S` | `5` |
| `+` | `4` |

---

## 🌐 Deployment (Vercel)

The app is configured for one-click Vercel deployment:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

The `vercel.json` routes all requests through the Flask backend (`api/index.py`), which also serves static files and HTML pages.

**Environment variables** must be set in the Vercel dashboard under Project Settings → Environment Variables.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML/CSS/JS, Material Symbols, Inter font |
| **Backend** | Python Flask, flask-cors, python-dotenv |
| **OCR** | Tesseract.js v5 (client-side) |
| **Database** | Firebase Firestore |
| **Storage** | Firebase Cloud Storage |
| **Auth** | Firebase Authentication (Google Sign-In for admin) |
| **PDF** | jsPDF (generation), PDF.js (preview) |
| **Deployment** | Vercel (serverless Python) |

---

## 📄 License

This project is open source and available for educational use.

---

<p align="center">
  Made with ❤️ for VIT Bhopal students
</p>
