import csv
import re
import os
import difflib
import requests as http_req
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context, redirect
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

# Serve static files from the parent directory relative to 'api'
app = Flask(__name__, static_folder="../static", template_folder="../")
CORS(app)

def load_courses_dict():
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

courses_dict = load_courses_dict()

def get_course_details_from_csv(extracted_code, extracted_title, full_text):
    if not courses_dict:
        return extracted_code, extracted_title

    if extracted_code != "Not Found":
        cleaned_code = extracted_code.replace('O', '0').replace('I', '1').replace('l', '1').replace('S', '5')
        matches = difflib.get_close_matches(cleaned_code, courses_dict.keys(), n=1, cutoff=0.7)
        if matches:
            return matches[0], courses_dict[matches[0]]
            
    if extracted_title != "Not Found":
        matches = difflib.get_close_matches(extracted_title, list(courses_dict.values()), n=1, cutoff=0.6)
        if matches:
            matched_title = matches[0]
            for c, t in courses_dict.items():
                if t == matched_title:
                    return c, matched_title
                    
    text_upper = full_text.upper()
    text_letters_digits = re.sub(r'[^A-Z0-9]', '', text_upper)
    text_code_search = text_letters_digits.replace('O', '0').replace('I', '1').replace('L', '1').replace('S', '5')
    
    for code, title in courses_dict.items():
        if code in text_code_search:
            return code, title
            
    for code, title in courses_dict.items():
        title_norm = re.sub(r'[^A-Z0-9]', '', title.upper())
        if len(title_norm) > 10 and title_norm in text_letters_digits:
            return code, title
            
    return "Not Found", "Not Found"

@app.route('/')
def index():
    return send_from_directory('../', 'index.html')

@app.route('/robots.txt')
def robots_txt():
    return send_from_directory('../', 'robots.txt')

@app.route('/sitemap.xml')
def sitemap_xml():
    return send_from_directory('../', 'sitemap.xml')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory('../static', 'logo.png')

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
    if not data or 'text' not in data:
         return jsonify({"error": "No text provided"}), 400
         
    text_clean = data['text'].replace('\n', ' ')
    
    # 1. Exam Name
    exam_name = "Not Found"
    if re.search(r'MID\s*TERM|CAT\s*\d?', text_clean, re.IGNORECASE):
        exam_name = "Midterm"
    elif re.search(r'TERM\s*END|END\s*TERM|FAT', text_clean, re.IGNORECASE):
        exam_name = "Term End"
        
    # 2. Course Code Extraction
    course_code = "Not Found"
    fallback = re.search(r'Course\s*Cod[^a-zA-Z0-9]*\s*([a-zA-Z0-9OIl\+]{5,10})', text_clean, re.IGNORECASE)
    if fallback:
         course_code = fallback.group(1).upper()
    else:
         code_match = re.search(r'\b([A-Z]{3,4}\s*[0-9OIl\+]{3,4})\b', text_clean)
         if code_match:
             course_code = code_match.group(1).upper()
         else:
             fallback_before = re.search(r'\b([a-zA-Z0-9]{5,10})\s+(?:Programme|Course\s*Cod)', text_clean, re.IGNORECASE)
             if fallback_before:
                 course_code = fallback_before.group(1).upper()

    if course_code != "Not Found":
        letters = re.sub(r'[^A-Z]', '', course_code[:3])
        if len(course_code) > 3:
            digits = course_code[3:].replace('O', '0').replace('I', '1').replace('l', '1').replace('S', '5').replace('+', '4')
            course_code = letters + digits

    # 3. Course Title Regex Extraction
    course_title = "Not Found"
    title_match = re.search(r'(?:Title|Name)\s+(.*?)\s+(?:Course|Cod[ec]|Dute|Date|Session|Slot|Max\.|CIA|Time|Programme|Answer|Hrs)', text_clean, re.IGNORECASE)
    if title_match:
        course_title = title_match.group(1).strip()
    else:
        title_match2 = re.search(r'Cod[^a-zA-Z0-9]*.*?(?:Title|Name)\s+(.*?)\s+(?:Dute|Date|Session|Slot|Max\.|CIA|Time|Answer|Hrs)', text_clean, re.IGNORECASE)
        if title_match2:
             course_title = title_match2.group(1).strip()
             
    course_code, course_title = get_course_details_from_csv(course_code, course_title, text_clean)
             
    if course_code == "Not Found": course_code = ""
    if course_title == "Not Found": course_title = ""
    if exam_name == "Not Found": exam_name = ""
    
    course_combined = ""
    if course_code and course_title:
        course_combined = f"{course_code} - {course_title}"
    elif course_code:
        course_combined = course_code
    elif course_title:
        course_combined = course_title

    return jsonify({
        "course_combined": course_combined,
        "exam_name": exam_name
    })

@app.route('/api/courses', methods=['GET'])
def get_courses():
    global courses_dict
    if not courses_dict:
        courses_dict = load_courses_dict()
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

if __name__ == '__main__':
    app.run(port=5000, debug=True)
