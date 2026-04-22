Static JSON Search Index Cloud Function

This Firebase Cloud Function listens to writes in the papers collection and rebuilds a thin JSON index file in the default Cloud Storage bucket.

Trigger
- Firestore onWrite style trigger via v2 onDocumentWritten: papers/{paperId}

Output file
- papers_index.json in the default Firebase Storage bucket

Included fields
- id
- title
- subject
- year
- download_url

Excluded fields
- Any heavy text fields such as extracted_ocr_text

Deploy
1) Install dependencies
   npm install
2) Deploy function
   npm run deploy

Notes
- This architecture removes Firestore read costs from client-side query and catalog browsing by serving search metadata from a single static JSON file.
- The function itself reads all papers documents only when content changes.
