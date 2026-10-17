"""Validate and import direct GPT-6 Astra annotations from a completed run directory."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_dir', type=Path)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    taxonomy = root / 'data/categories.csv'
    with taxonomy.open() as handle:
        slugs = {r['slug'] for r in csv.DictReader(handle)}
    inputs, answers = {}, {}
    for path in sorted(args.run_dir.glob('input_*.json')):
        for bill in json.loads(path.read_text()):
            key = bill['congress'], bill['bill_id']
            if key in inputs:
                raise ValueError(f'Duplicate input: {key}')
            inputs[key] = bill
    for path in sorted(args.run_dir.glob('output_*.jsonl')):
        for line in path.read_text().splitlines():
            answer = json.loads(line)
            key = answer['congress'], answer['bill_id']
            if key in answers or key not in inputs:
                raise ValueError(f'Duplicate or unknown result: {key}')
            if answer['input_sha256'] != inputs[key]['input_sha256']:
                raise ValueError(f'Input fingerprint mismatch: {key}')
            if answer['status'] not in {'categorized', 'needs_review'}:
                raise ValueError(f'Invalid status: {key}')
            if answer['status'] == 'needs_review' and not answer.get('reason', '').strip():
                raise ValueError(f'Missing review reason: {key}')
            scores = answer['scores']
            if not isinstance(scores, list):
                raise ValueError(f'Invalid scores: {key}')
            seen = set()
            for score in scores:
                slug = score['category']
                if slug not in slugs or slug in seen:
                    raise ValueError(f'Unknown/duplicate category: {key}')
                if type(score['score']) is not int or score['score'] not in {-2, -1, 1, 2}:
                    raise ValueError(f'Invalid score: {key}')
                if score['confidence'] not in {'low', 'medium', 'high'}:
                    raise ValueError(f'Invalid confidence: {key}')
                if not isinstance(score['rationale'], str) or not score['rationale'].strip():
                    raise ValueError(f'Missing rationale: {key}')
                seen.add(slug)
            if not (inputs[key]['summary'] or '').strip():
                if scores or answer['status'] != 'needs_review':
                    raise ValueError(f'Missing-summary result must require review: {key}')
            answers[key] = answer
    if not inputs or inputs.keys() != answers.keys():
        raise ValueError(f'Incomplete run: {len(answers)} answers for {len(inputs)} bills')
    db = os.environ.get('DATABASE_URL', 'dbname=dollarvote host=localhost')
    with psycopg.connect(db, connect_timeout=5) as conn:
        conn.execute("SET LOCAL lock_timeout='5s'")
        for key, answer in answers.items():
            original = inputs[key]
            row = conn.execute('SELECT title,policy_area,summary,exclude_reason '
                               'FROM bills WHERE congress=%s AND bill_id=%s', key).fetchone()
            expected = tuple(original[k] for k in ('title', 'policy_area', 'summary', 'exclude_reason'))
            if row != expected:
                raise ValueError(f'Bill changed since annotation: {key}')
            if args.check_only:
                continue
            stored = {k: v for k, v in answer.items() if k not in {'congress', 'bill_id'}}
            stored.update(model='gpt-6-astra', method='direct_agent_annotation',
                          schema_version=1, categorized_at=datetime.now(timezone.utc).isoformat(),
                          taxonomy_sha256=hashlib.sha256(taxonomy.read_bytes()).hexdigest(),
                          input_summary_chars=len(original['summary'] or ''))
            result = conn.execute('UPDATE bills SET gpt_6_astra_categorization=%s '
                                  'WHERE congress=%s AND bill_id=%s AND gpt_6_astra_categorization IS NULL '
                                  'AND title IS NOT DISTINCT FROM %s AND policy_area IS NOT DISTINCT FROM %s '
                                  'AND summary IS NOT DISTINCT FROM %s AND exclude_reason IS NOT DISTINCT FROM %s',
                                  (Jsonb(stored), *key, *expected))
            if result.rowcount != 1:
                raise ValueError(f'Refusing to overwrite existing or changed annotation: {key}')
    print(json.dumps({'validated': len(answers), 'imported': 0 if args.check_only else len(answers),
                      'needs_review': sum(a['status'] == 'needs_review' for a in answers.values()),
                      'category_scores': sum(len(a['scores']) for a in answers.values())}))


if __name__ == '__main__':
    main()
