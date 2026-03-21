import argparse
import csv
import json
import os
from pathlib import Path

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, firestore


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CSV_PATH = ROOT_DIR / 'api' / 'courses.csv'
DEFAULT_COLLECTION = 'courses_catalog'


def get_firebase_credential():
    service_account_path = os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY_PATH', '').strip()
    service_account_json = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON', '').strip()

    if service_account_path:
        return credentials.Certificate(service_account_path)

    if service_account_json:
        try:
            parsed_json = json.loads(service_account_json)
        except json.JSONDecodeError as exc:
            raise ValueError('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON') from exc
        return credentials.Certificate(parsed_json)

    raise ValueError(
        'Firebase service account missing. Set FIREBASE_SERVICE_ACCOUNT_KEY_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in environment.'
    )


def normalize_doc_id(course_code: str) -> str:
    return course_code.strip().upper().replace('/', '-').replace(' ', '')


def read_courses(csv_path: Path):
    if not csv_path.exists():
        raise FileNotFoundError(f'CSV not found: {csv_path}')

    rows = []
    with csv_path.open(mode='r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            course_code = (row.get('Course Code') or '').strip().upper()
            course_title = (row.get('Course Title') or '').strip()
            if not course_code or not course_title:
                continue
            rows.append({
                'courseCode': course_code,
                'courseTitle': course_title,
                'courseCombined': f'{course_code} - {course_title}'
            })
    return rows


def sync_courses(csv_path: Path, collection_name: str, dry_run: bool = False):
    load_dotenv()

    cred = get_firebase_credential()
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)

    db = firestore.client()
    courses = read_courses(csv_path)

    if not courses:
        print('No valid courses found in CSV.')
        return

    print(f'Found {len(courses)} courses in {csv_path}')

    if dry_run:
        print('Dry run enabled. No writes performed.')
        for item in courses[:10]:
            print(f"- {item['courseCombined']}")
        if len(courses) > 10:
            print(f'... and {len(courses) - 10} more')
        return

    batch = db.batch()
    batch_size = 0
    total_written = 0

    for item in courses:
        doc_id = normalize_doc_id(item['courseCode'])
        doc_ref = db.collection(collection_name).document(doc_id)
        batch.set(doc_ref, {
            **item,
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }, merge=True)
        batch_size += 1

        if batch_size == 500:
            batch.commit()
            total_written += batch_size
            batch = db.batch()
            batch_size = 0

    if batch_size > 0:
        batch.commit()
        total_written += batch_size

    print(f'Successfully upserted {total_written} course documents into "{collection_name}".')


def main():
    parser = argparse.ArgumentParser(description='Sync courses.csv to Firestore collection')
    parser.add_argument('--csv', default=str(DEFAULT_CSV_PATH), help='Path to courses CSV file')
    parser.add_argument('--collection', default=DEFAULT_COLLECTION, help='Firestore collection name')
    parser.add_argument('--dry-run', action='store_true', help='Print parsed entries without writing to Firestore')
    args = parser.parse_args()

    sync_courses(Path(args.csv), args.collection, args.dry_run)


if __name__ == '__main__':
    main()
