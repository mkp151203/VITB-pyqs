import csv
import re
import os
import difflib
import html
import json
from urllib.parse import quote
import requests as http_req
import base64
import io
from google import genai
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context, redirect
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

# Serve static files from the parent directory relative to 'api'
app = Flask(__name__, static_folder="../static", template_folder="../")
CORS(app)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# ── Firestore course loading via REST API ──
def load_courses_from_firestore():
    """Try to load courses from Firestore courses_catalog collection via REST API."""
    loaded = {}
    try:
        project_id = os.environ.get('FIREBASE_PROJECT_ID', '').strip()
        if not project_id:
            return loaded

        url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/courses_catalog?pageSize=1000"
        
        response = http_req.get(url, timeout=7)
        if response.status_code == 200:
            data = response.json()
            documents = data.get('documents', [])
            for doc in documents:
                fields = doc.get('fields', {})
                
                code_field = fields.get('courseCode') or fields.get('code')
                title_field = fields.get('courseTitle') or fields.get('title')
                
                if code_field and title_field:
                    code_val = code_field.get('stringValue', '')
                    title_val = title_field.get('stringValue', '')
                    
                    code = code_val.strip().upper()
                    title = title_val.strip()
                    
                    if code and title:
                        loaded[code] = title
                        
            if loaded:
                print(f"Loaded {len(loaded)} courses from Firestore (Client REST API)")
        else:
            print(f"Firestore REST API load skipped: Status {response.status_code}")
    except Exception as e:
        print(f"Firestore course load skipped (REST Client Error): {e}")
    return loaded


def load_courses_dict():
    """Load courses from CSV (fallback source)."""
    loaded = {}
    current_dir = os.path.dirname(os.path.abspath(__file__))
    candidate_paths = [
        os.path.join(current_dir, 'courses.csv'),
        os.path.join(current_dir, '../api/courses.csv'),
        os.path.join(os.getcwd(), 'api', 'courses.csv'),
    ]

    csv_path = None
    for candidate in candidate_paths:
        normalized = os.path.abspath(candidate)
        if os.path.exists(normalized):
            csv_path = normalized
            break

    if not csv_path:
        print("Error loading courses: courses.csv not found in expected paths")
        return loaded

    try:
        with open(csv_path, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if 'Course Code' in row and 'Course Title' in row:
                    code = (row.get('Course Code') or '').strip().upper()
                    title = (row.get('Course Title') or '').strip()
                    if code and title:
                        loaded[code] = title
    except Exception as e:
        print(f"Error loading courses from {csv_path}: {e}")

    return loaded


def load_all_courses():
    """Load courses from Firestore first, then merge with CSV as fallback."""
    # Firestore = primary
    firestore_courses = load_courses_from_firestore()
    # CSV = fallback
    csv_courses = load_courses_dict()
    # Merge: CSV first, then Firestore overwrites (Firestore takes priority)
    merged = {**csv_courses, **firestore_courses}
    print(f"Total courses loaded: {len(merged)} (Firestore: {len(firestore_courses)}, CSV: {len(csv_courses)})")
    return merged


courses_dict = load_all_courses()

HEADER_STOP_REGEX = re.compile(
    r'\b(?:questions?|answer(?:\s+all)?|marks?|question\s*description|part\s*[a-z]|section\s*[a-z])\b',
    re.IGNORECASE
)
HEADER_MAX_CHARS = 900


def extract_header_text(text):
    cleaned = re.sub(r'\s+', ' ', (text or '')).strip()
    if not cleaned:
        return ''

    marker = HEADER_STOP_REGEX.search(cleaned)
    if marker:
        cleaned = cleaned[:marker.start()].strip()

    return cleaned[:HEADER_MAX_CHARS].strip()


def get_site_url():
    return os.environ.get('SITE_URL', 'https://vitbhopal-pyq.vercel.app').rstrip('/')


def get_sorted_courses():
    global courses_dict
    if not courses_dict:
        courses_dict = load_all_courses()
    return sorted(courses_dict.items(), key=lambda item: item[0])


def slugify_course_title(title):
    slug = re.sub(r'[^a-z0-9]+', '-', (title or '').lower()).strip('-')
    return slug or 'course'


def get_course_slug_maps():
    code_to_slug = {}
    slug_to_code = {}
    seen_slug_counts = {}

    for code, title in get_sorted_courses():
        base_slug = slugify_course_title(title)
        count = seen_slug_counts.get(base_slug, 0)
        if count == 0:
            slug = base_slug
        else:
            slug = f"{base_slug}-{count + 1}"
        seen_slug_counts[base_slug] = count + 1
        code_to_slug[code] = slug
        slug_to_code[slug] = code

    return code_to_slug, slug_to_code


def build_page(title, description, canonical_path, heading, intro, links_html, enable_filter=False):
    site_url = get_site_url()
    canonical_url = f"{site_url}{canonical_path}"
    safe_title = html.escape(title)
    safe_description = html.escape(description)
    safe_heading = html.escape(heading)
    safe_intro = html.escape(intro)
    filter_html = ''
    filter_script = ''
    if enable_filter:
        filter_html = """
            <div class=\"form-group search-bar-group\" id=\"seo-search-bar\" style=\"margin-bottom:14px;\">
                <input id=\"seo-course-search\" type=\"text\" placeholder=\"Search by course code or title...\" style=\"padding-left:14px;\">
            </div>
        """
        filter_script = """
    <script>
        (function () {
            const input = document.getElementById('seo-course-search');
            const cards = Array.from(document.querySelectorAll('.seo-course-card'));
            if (!input || !cards.length) return;

            input.addEventListener('input', function () {
                const q = (input.value || '').toLowerCase().trim();
                cards.forEach((card) => {
                    const text = (card.getAttribute('data-search') || '').toLowerCase();
                    card.style.display = !q || text.includes(q) ? '' : 'none';
                });
            });
        })();
    </script>
        """

    return f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
    <meta charset=\"UTF-8\">
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
    <title>{safe_title}</title>
    <meta name=\"description\" content=\"{safe_description}\">
    <meta name=\"robots\" content=\"index, follow\">
    <link rel=\"canonical\" href=\"{canonical_url}\">
    <link rel=\"icon\" type=\"image/png\" href=\"/static/logo.png\">
    <link rel=\"stylesheet\" href=\"/static/css/style.css\">
</head>
<body>
    <div class=\"container\" style=\"max-width:900px;margin-top:20px;\">
        <main>
            <h1 style=\"margin:0 0 10px;\">{safe_heading}</h1>
            <p class=\"section-desc\" style=\"margin-bottom:16px;\">{safe_intro}</p>
            {filter_html}
            <div class=\"results-grid\">{links_html}</div>
            <div style=\"margin-top:18px;\">
                <a class=\"btn btn-primary\" href=\"/\">Go to VIT Bhopal PYQ App</a>
            </div>
        </main>
    </div>
    {filter_script}
</body>
</html>"""

def get_course_details_from_csv(extracted_code, extracted_title, full_text):
    if not courses_dict:
        return extracted_code, extracted_title

    # 1. Fuzzy match for Course Code
    if extracted_code != "Not Found":
        cleaned_code = extracted_code.replace('O', '0').replace('I', '1').replace('l', '1').replace('S', '5').upper()
        matches = difflib.get_close_matches(cleaned_code, courses_dict.keys(), n=1, cutoff=0.7)
        if matches:
            return matches[0], courses_dict[matches[0]]
            
    # 2. Case-insensitive Fuzzy match for Course Title (Fixing "&" vs "AND")
    if extracted_title != "Not Found":
        extracted_title_norm = extracted_title.upper().replace('&', 'AND')
        
        # Build dictionary mapping normalized uppercase titles to their original format
        title_map = {}
        for c, t in courses_dict.items():
            norm_t = t.upper().replace('&', 'AND')
            title_map[norm_t] = (c, t)
            
        matches = difflib.get_close_matches(extracted_title_norm, list(title_map.keys()), n=1, cutoff=0.6)
        if matches:
            return title_map[matches[0]]
                    
    # 3. Brute-force substring search on the entire extracted header text
    text_upper = full_text.upper().replace('&', 'AND')
    text_letters_digits = re.sub(r'[^A-Z0-9]', '', text_upper)
    
    # Mangle text (simulate common OCR errors uniformly)
    text_mangled = text_letters_digits.replace('O', '0').replace('I', '1').replace('L', '1').replace('S', '5')
    
    # 3a. Search for mangled code in mangled text
    for code, title in courses_dict.items():
        if code in text_mangled:
            return code, title
            
    # 3b. Search for mangled title in mangled text 
    for code, title in courses_dict.items():
        title_norm = re.sub(r'[^A-Z0-9]', '', title.upper().replace('&', 'AND'))
        if len(title_norm) > 10:
            title_mangled = title_norm.replace('O', '0').replace('I', '1').replace('L', '1').replace('S', '5')
            if title_mangled in text_mangled or title_norm in text_letters_digits:
                return code, title
            
    return "Not Found", "Not Found"

@app.route('/')
def index():
    return send_from_directory('../', 'index.html')

@app.route('/bulk-uploader')
def bulk_uploader_page():
    return send_from_directory('../', 'bulk_uploader.html')

@app.route('/robots.txt')
def robots_txt():
    return send_from_directory('../', 'robots.txt')

@app.route('/sitemap.xml')
def sitemap_xml():
    site_url = get_site_url()
    code_to_slug, _ = get_course_slug_maps()
    urls = [
        f"{site_url}/",
        f"{site_url}/courses",
        f"{site_url}/vit-bhopal-pyq",
        f"{site_url}/vitb-cse-pyq",
    ]
    for code, _title in get_sorted_courses():
        slug = code_to_slug.get(code, code.lower())
        urls.append(f"{site_url}/pyq/{slug}")

    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    ]
    for url in urls:
        xml_lines.append('  <url>')
        xml_lines.append(f'    <loc>{html.escape(url)}</loc>')
        xml_lines.append('    <changefreq>daily</changefreq>')
        xml_lines.append('    <priority>0.8</priority>')
        xml_lines.append('  </url>')
    xml_lines.append('</urlset>')

    return Response('\n'.join(xml_lines), mimetype='application/xml')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory('../static', 'logo.png')


@app.route('/courses')
@app.route('/vit-bhopal-pyq')
def courses_landing():
    code_to_slug, _ = get_course_slug_maps()
    cards = []
    for code, title in get_sorted_courses():
        safe_code = html.escape(code)
        safe_title = html.escape(title)
        slug = code_to_slug.get(code, code.lower())
        cards.append(
            f'<a class="paper-card seo-course-card" data-search="{safe_code} {safe_title}" href="/pyq/{slug}" style="text-decoration:none;color:inherit;">'
            f'<div class="paper-details"><h3>{safe_title}</h3><p style="margin:4px 0 0;color:#888;font-size:0.82rem;">{safe_code} PYQ · VIT Bhopal</p></div>'
            '</a>'
        )

    page_html = build_page(
        title='VIT Bhopal PYQ by Course | Previous Year Question Papers',
        description='Browse VIT Bhopal previous year question papers by course code and course title.',
        canonical_path='/vit-bhopal-pyq',
        heading='VIT Bhopal Previous Year Question Papers by Course',
        intro='Find VITB PYQ course pages for CSE, CSA, CSD and other departments.',
        links_html=''.join(cards),
        enable_filter=True
    )
    return Response(page_html, mimetype='text/html')


@app.route('/vitb-cse-pyq')
def cse_landing():
    code_to_slug, _ = get_course_slug_maps()
    cse_like = [(code, title) for code, title in get_sorted_courses() if code.startswith(('CSE', 'CSA', 'CSD'))]
    cards = []
    for code, title in cse_like:
        safe_code = html.escape(code)
        safe_title = html.escape(title)
        slug = code_to_slug.get(code, code.lower())
        cards.append(
            f'<a class="paper-card seo-course-card" data-search="{safe_code} {safe_title}" href="/pyq/{slug}" style="text-decoration:none;color:inherit;">'
            f'<div class="paper-details"><h3>{safe_title}</h3><p style="margin:4px 0 0;color:#888;font-size:0.82rem;">{safe_code} CSE/AI PYQ · VIT Bhopal</p></div>'
            '</a>'
        )

    page_html = build_page(
        title='VITB CSE PYQ | VIT Bhopal CSE Previous Year Papers',
        description='Course-wise VIT Bhopal CSE and AI previous year question papers.',
        canonical_path='/vitb-cse-pyq',
        heading='VIT Bhopal CSE and AI PYQ',
        intro='Browse CSE, CSA and related PYQ pages for VIT Bhopal students.',
        links_html=''.join(cards),
        enable_filter=True
    )
    return Response(page_html, mimetype='text/html')


@app.route('/pyq/<course_ref>')
def course_pyq_page(course_ref):
    ref = (course_ref or '').strip()
    ref_upper = ref.upper()
    code_to_slug, slug_to_code = get_course_slug_maps()

    code = None
    title = None

    # Legacy code-based URL support: /pyq/cse2001 -> redirect to slug URL
    if ref_upper in courses_dict:
        code = ref_upper
        title = courses_dict.get(code)
        slug = code_to_slug.get(code, code.lower())
        return redirect(f'/pyq/{slug}', code=301)

    mapped_code = slug_to_code.get(ref.lower())
    if mapped_code:
        code = mapped_code
        title = courses_dict.get(code)

    if not title:
        return Response(
            build_page(
                title='Course PYQ Not Found | VIT Bhopal PYQ',
                description='The requested VIT Bhopal course page was not found.',
                canonical_path=f'/pyq/{html.escape(course_code)}',
                heading='Course not found',
                intro='This course is not available in the current catalog.',
                links_html='<a class="paper-card" href="/courses" style="text-decoration:none;color:inherit;"><div class="paper-details"><h3>Go to all courses</h3></div></a>'
            ),
            status=404,
            mimetype='text/html'
        )

    safe_code = html.escape(code)
    safe_title = html.escape(title)
    slug = code_to_slug.get(code, slugify_course_title(title))
    encoded_query = quote(title)
    combined = f'{safe_code} - {safe_title}'
    links_html = (
        f'<div class="paper-card"><div class="paper-details">'
        f'<h3>{combined}</h3>'
        '<p style="margin:4px 0 0;color:#666;font-size:0.9rem;">Find previous year question papers, midterm papers and term-end papers for this course.</p>'
        '</div></div>'
        f'<a class="paper-card" href="/?q={encoded_query}" style="text-decoration:none;color:inherit;">'
        '<div class="paper-details"><h3>Open search in app</h3><p style="margin:4px 0 0;color:#888;font-size:0.82rem;">Use the in-app search to browse all uploaded papers.</p></div>'
        '</a>'
        '<a class="paper-card" href="/vit-bhopal-pyq" style="text-decoration:none;color:inherit;">'
        '<div class="paper-details"><h3>Browse more courses</h3></div>'
        '</a>'
    )

    page_html = build_page(
        title=f'{safe_title} ({safe_code}) PYQ | VIT Bhopal Previous Year Questions',
        description=f'Download and browse {safe_title} ({safe_code}) previous year question papers for VIT Bhopal University.',
        canonical_path=f'/pyq/{slug}',
        heading=f'{safe_title} ({safe_code}) PYQ - VIT Bhopal',
        intro='Course page optimized for VITB PYQ search queries.',
        links_html=links_html
    )
    return Response(page_html, mimetype='text/html')

@app.route('/admin')
def admin_index():
    return send_from_directory('../', 'admin_login.html')

@app.route('/admin/dashboard')
def admin_dashboard():
    return send_from_directory('../', 'admin.html')

@app.route('/admin/')
def admin_index_slash():
    return redirect('/admin')

@app.route('/admin.html')
def admin_html_alias():
    return redirect('/admin/dashboard')

@app.route('/admin_login.html')
def admin_login_alias():
    return redirect('/admin')

@app.route('/admin/logout', methods=['GET', 'POST'])
def admin_logout():
    return redirect('/admin')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('../static', filename)

@app.route('/api/parse', methods=['POST'])
def parse_text():
    data = request.get_json()
    if not data:
         return jsonify({"error": "No data provided"}), 400
         
    text_raw = data.get('text', '')
    image_base64 = data.get('image_base64', '')
    
    course_combined = ""
    exam_name = ""
    extracted_slot = ""
    is_question_paper = True
    
    # --- GEMINI PRIMARY PATH ---
    gemini_success = False
    gemini_api_failed = False
    if image_base64 and GEMINI_API_KEY:
        try:
            # Clean base64 header (e.g. data:image/webp;base64,xxxx)
            if ',' in image_base64:
                b64_data = image_base64.split(',')[1]
            else:
                b64_data = image_base64
            img_bytes = base64.b64decode(b64_data)
            img = Image.open(io.BytesIO(img_bytes))
            
            client = genai.Client(api_key=GEMINI_API_KEY)
            prompt = """
Extract the following fields from this exam paper image and return ONLY JSON:

{
  "course_title": "",
  "course_code": "",
  "slot": "",
  "extracted text": "",
  "question paper(yes/no)": ""
}

Rules:
- Do NOT include any explanation
- Return only valid JSON
- give response question paper as "yes" only if it is a valid university exam question paper else give "no" as response
- extracted text field should only contain lowercase text with no spaces
- For 'extracted text', limit your transcription to ONLY the very first 650 characters of the document. Do not transcribe the entire page in order to save tokens!
"""
            from google.genai import types
            response = client.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=[prompt, img],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                )
            )
            resp_text = response.text.strip()
            print("--- GEMINI RAW RESPONSE ---", flush=True)
            print(resp_text, flush=True)
            print("---------------------------", flush=True)
            
            if resp_text.startswith("```json"):
                resp_text = resp_text[7:]
            if resp_text.startswith("```"):
                resp_text = resp_text[3:]
            if resp_text.endswith("```"):
                resp_text = resp_text[:-3]
                
            cleaned_resp = resp_text.strip()
            gemini_json = None
            
            while cleaned_resp:
                try:
                    gemini_json = json.loads(cleaned_resp)
                    break
                except json.JSONDecodeError:
                    if cleaned_resp.endswith('}'):
                        cleaned_resp = cleaned_resp[:-1].strip()
                    else:
                        break
            
            if gemini_json is None:
                raise ValueError("Failed to parse Gemini JSON output due to unrecoverable formatting")
            
            g_course_code = str(gemini_json.get("course_code") or "").strip()
            g_course_title = str(gemini_json.get("course_title") or "").strip()
            extracted_slot = str(gemini_json.get("slot") or "").strip()
            gemini_text = str(gemini_json.get("extracted text") or "")
            q_paper_val = str(gemini_json.get("question paper(yes/no)") or "yes").lower()
            
            if q_paper_val == "no":
                is_question_paper = False
                
            if gemini_text:
                # Merge the LLM dense text with existing raw text for regex parsing capability in fallback
                text_raw = gemini_text
            
            if g_course_code or g_course_title:
                code, title = get_course_details_from_csv(g_course_code or "Not Found", g_course_title or "Not Found", text_raw)
                
                if code != "Not Found" and title != "Not Found":
                    course_code = code
                    course_title = title
                    course_combined = f"{course_code} - {course_title}"
                    gemini_success = True
                else:
                    gemini_success = False
            else:
                gemini_success = False
                
        except Exception as e:
            print(f"Gemini Extraction Failed: {e}")
            gemini_success = False
            gemini_api_failed = True

    # --- REGEX FALLBACK PATH ---
    text_clean = text_raw.replace('\n', ' ')
    header_text = extract_header_text(text_clean)
    detection_text = header_text or text_clean[:HEADER_MAX_CHARS]
        
    if not gemini_success:
        course_code = "Not Found"
        fallback = re.search(r'Course\s*Cod[^a-zA-Z0-9]*\s*([a-zA-Z0-9OIl\+]{5,10})', detection_text, re.IGNORECASE)
        if fallback:
             course_code = fallback.group(1).upper()
        else:
             code_match = re.search(r'\b([A-Z]{3,4}\s*[0-9OIl\+]{3,4})\b', detection_text)
             if code_match:
                 course_code = code_match.group(1).upper()
             else:
                 fallback_before = re.search(r'\b([a-zA-Z0-9]{5,10})\s+(?:Programme|Course\s*Cod)', detection_text, re.IGNORECASE)
                 if fallback_before:
                     course_code = fallback_before.group(1).upper()

        if course_code != "Not Found":
            letters = re.sub(r'[^A-Z]', '', course_code[:3])
            if len(course_code) > 3:
                digits = course_code[3:].replace('O', '0').replace('I', '1').replace('l', '1').replace('S', '5').replace('+', '4')
                course_code = letters + digits

        course_title = "Not Found"
        title_match = re.search(r'(?:Title|Name)\s+(.*?)\s+(?:Course|Cod[ec]|Dute|Date|Session|Slot|Max\.|CIA|Time|Programme|Answer|Hrs)', detection_text, re.IGNORECASE)
        if title_match:
            course_title = title_match.group(1).strip()
        else:
            title_match2 = re.search(r'Cod[^a-zA-Z0-9]*.*?(?:Title|Name)\s+(.*?)\s+(?:Dute|Date|Session|Slot|Max\.|CIA|Time|Answer|Hrs)', detection_text, re.IGNORECASE)
            if title_match2:
                 course_title = title_match2.group(1).strip()
                 
        course_code, course_title = get_course_details_from_csv(course_code, course_title, detection_text)
                 
        if course_code == "Not Found": course_code = ""
        if course_title == "Not Found": course_title = ""
        
        if course_code and course_title:
            course_combined = f"{course_code} - {course_title}"
        elif course_code:
            course_combined = course_code
        elif course_title:
            course_combined = course_title

    # Exam Name Regex Verification (Required since prompt doesn't cover EXAM type)
    if re.search(r'MID\s*TERM|CAT\s*\d?', detection_text, re.IGNORECASE):
        exam_name = "Midterm"
    elif re.search(r'TERM\s*END|END\s*TERM|FAT', detection_text, re.IGNORECASE):
        exam_name = "Term End"

    return jsonify({
        "course_combined": course_combined,
        "exam_name": exam_name,
        "slot": extracted_slot,
        "is_question_paper": is_question_paper,
        "gemini_used": gemini_success,
        "gemini_api_failed": gemini_api_failed,
        "processed_text": text_raw
    })

@app.route('/api/courses', methods=['GET'])
def get_courses():
    global courses_dict
    if not courses_dict:
        courses_dict = load_all_courses()
    courses_list = [f"{code} - {title}" for code, title in courses_dict.items()]
    courses_list.sort()
    return jsonify(courses_list)

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify({
        "apiKey": os.environ.get("FIREBASE_API_KEY", "YOUR_API_KEY"),
        "authDomain": os.environ.get("FIREBASE_AUTH_DOMAIN", "YOUR_AUTH_DOMAIN"),
        "projectId": os.environ.get("FIREBASE_PROJECT_ID", "YOUR_PROJECT_ID"),
        "storageBucket": os.environ.get("FIREBASE_STORAGE_BUCKET", "YOUR_STORAGE_BUCKET"),
        "messagingSenderId": os.environ.get("FIREBASE_MESSAGING_SENDER_ID", "YOUR_SENDER_ID"),
        "appId": os.environ.get("FIREBASE_APP_ID", "YOUR_APP_ID")
    })

@app.route('/api/proxy-pdf')
def proxy_pdf():
    """Fetch a Firebase Storage PDF server-side and re-serve it.
    This sidesteps CORS restrictions so the browser's native PDF viewer works.
    """
    url = request.args.get('url', '')
    if not url or 'firebasestorage.googleapis.com' not in url:
        return 'Invalid or missing URL', 400
    try:
        r = http_req.get(url, stream=True, timeout=30)
        r.raise_for_status()
        headers = {
            'Content-Type': 'application/pdf',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
        }
        return Response(
            stream_with_context(r.iter_content(chunk_size=32768)),
            status=r.status_code,
            headers=headers
        )
    except Exception as e:
        return str(e), 502


@app.route('/api/proxy-file')
def proxy_file():
    url = request.args.get('url', '')
    if not url or 'firebasestorage.googleapis.com' not in url:
        return 'Invalid or missing URL', 400

    try:
        r = http_req.get(url, stream=True, timeout=30)
        r.raise_for_status()
        headers = {
            'Content-Type': r.headers.get('Content-Type', 'application/octet-stream'),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
        }
        return Response(
            stream_with_context(r.iter_content(chunk_size=32768)),
            status=r.status_code,
            headers=headers
        )
    except Exception as e:
        return str(e), 502

if __name__ == '__main__':
    app.run(port=5000, debug=True)
