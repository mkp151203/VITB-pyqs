const {setGlobalOptions} = require("firebase-functions/v2");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

function mapPaperToThinIndex(docSnapshot) {
  const data = docSnapshot.data() || {};
  const createdAt = data.createdAt ?? null;

  // Keep only thin fields required for search/catalog; exclude heavy OCR text.
  return {
    id: docSnapshot.id,

    // Current app-compatible fields for seamless Search tab integration.
    courseTitle: data.courseTitle ?? null,
    courseCode: data.courseCode ?? null,
    examName: data.examName ?? null,
    slot: data.slot ?? null,
    fileType: data.fileType ?? null,
    fileUrl: data.fileUrl ?? null,
    pageCount: data.pageCount ?? null,
    createdAt,
  };
}

exports.rebuildPapersSearchIndex = onDocumentWritten("question_papers_multi/{paperId}", async (event) => {
  logger.info("papers write detected; rebuilding papers_index.json", {
    eventId: event.id,
    path: event.document,
  });

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket(); // Default app bucket.

    const snapshot = await db.collection("question_papers_multi").get();
    const thinPapers = snapshot.docs
      .map(mapPaperToThinIndex)
      .sort((a, b) => {
        const codeA = String(a.courseCode || "").toLowerCase();
        const codeB = String(b.courseCode || "").toLowerCase();
        if (codeA !== codeB) return codeA.localeCompare(codeB);

        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        if (dateA !== dateB) return dateB - dateA;

        const titleA = String(a.courseTitle || "").toLowerCase();
        const titleB = String(b.courseTitle || "").toLowerCase();
        return titleA.localeCompare(titleB);
      });

    const jsonPayload = JSON.stringify(thinPapers);
    const indexFile = bucket.file("papers_index.json");

    await indexFile.save(jsonPayload, {
      resumable: false,
      contentType: "application/json; charset=utf-8",
      metadata: {
        cacheControl: "public, max-age=300",
      },
    });

    logger.info("papers_index.json updated", {
      bucket: bucket.name,
      count: thinPapers.length,
      bytes: Buffer.byteLength(jsonPayload, "utf8"),
    });
  } catch (error) {
    logger.error("Failed to rebuild papers_index.json", {
      message: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
});

exports.rebuildCoursesCatalogIndex = onDocumentWritten("courses_catalog/{courseId}", async (event) => {
  logger.info("courses_catalog write detected; rebuilding courses_catalog.json", {
    eventId: event.id,
    path: event.document,
  });

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket(); // Default app bucket.

    const snapshot = await db.collection("courses_catalog").get();
    const courses = snapshot.docs.map(doc => {
        const data = doc.data() || {};
        return {
            id: doc.id,
            courseCode: data.courseCode || data.code || null,
            courseTitle: data.courseTitle || data.title || null
        };
    });

    const jsonPayload = JSON.stringify(courses);
    const indexFile = bucket.file("courses_catalog.json");

    await indexFile.save(jsonPayload, {
      resumable: false,
      contentType: "application/json; charset=utf-8",
      metadata: {
        cacheControl: "public, max-age=300",
      },
    });

    logger.info("courses_catalog.json updated", {
      bucket: bucket.name,
      count: courses.length,
      bytes: Buffer.byteLength(jsonPayload, "utf8"),
    });
  } catch (error) {
    logger.error("Failed to rebuild courses_catalog.json", {
      message: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
});
