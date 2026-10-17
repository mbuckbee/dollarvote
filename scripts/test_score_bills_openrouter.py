"""Offline regression tests: .venv/bin/python -I scripts/test_score_bills_openrouter.py"""
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

spec = importlib.util.spec_from_file_location('scorer', Path(__file__).with_name('score_bills_openrouter.py'))
scorer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorer)

CATEGORIES = [{'slug': 'housing', 'positive_means': 'More homes', 'negative_means': 'Fewer homes'}]
BILL = ('HR1', 'Housing', 'Housing', 'Funds new housing.')
ANSWER = {'scores': [{'category': 'housing', 'score': 2, 'confidence': 'high', 'rationale': 'Funds new housing.'}]}


def response(answer=ANSWER, finish='stop', model=scorer.DEFAULT_MODEL):
    return io.BytesIO(json.dumps({'model': model, 'provider': 'test', 'id': 'id1',
        'choices': [{'finish_reason': finish, 'message': {'content': json.dumps(answer)}}],
        'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'cost': 0.001}}).encode())


class ScorerTests(unittest.TestCase):
    def test_validation_rejects_wrong_categories_duplicate_boolean_and_empty_rationale(self):
        for field, value in [('category', 'unknown'), ('score', True), ('score', 0),
                             ('confidence', 'sure'), ('rationale', ' ')]:
            answer = copy.deepcopy(ANSWER)
            answer['scores'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                scorer.validate_answer(answer, ['housing'])
        with self.assertRaises(ValueError):
            scorer.validate_answer({'scores': ANSWER['scores'] * 2}, ['housing'])
        self.assertEqual(scorer.validate_answer({'scores': []}, ['housing']), {'scores': []})

    def test_malformed_answer_structures(self):
        for answer in [None, [], {}, {'scores': {}}, {'scores': [None]},
                       {'scores': [], 'extra': True}, {'scores': [{'category': 'housing'}]}]:
            with self.subTest(answer=answer), self.assertRaises(ValueError):
                scorer.validate_answer(answer, ['housing'])

    def test_full_summary_and_structured_output(self):
        summary = 'A' * 291380
        payload = scorer.make_payload((*BILL[:3], summary), CATEGORIES, scorer.DEFAULT_MODEL)
        self.assertEqual(json.loads(payload['messages'][1]['content'])['bill']['summary'], summary)
        self.assertTrue(payload['response_format']['json_schema']['strict'])
        self.assertTrue(payload['provider']['require_parameters'])
        self.assertFalse(payload['reasoning']['enabled'])

    @patch.object(scorer.urllib.request, 'urlopen')
    def test_missing_summary_never_calls_api(self, request):
        for summary in [None, '', '  ']:
            answer = scorer.categorize((*BILL[:3], summary), CATEGORIES, scorer.DEFAULT_MODEL, 'dummy')
            self.assertEqual(answer['status'], 'needs_review')
            self.assertIsNone(answer['model'])
            self.assertEqual(answer['scores'], [])
        request.assert_not_called()

    @patch.object(scorer.time, 'sleep')
    @patch.object(scorer.urllib.request, 'urlopen')
    def test_retries_truncation_and_records_usage(self, request, sleep):
        request.side_effect = [response(finish='length'), response()]
        answer = scorer.categorize(BILL, CATEGORIES, scorer.DEFAULT_MODEL, 'dummy')
        self.assertEqual(answer['attempts'], 2)
        self.assertEqual(len(answer['attempt_usage']), 2)
        self.assertEqual(answer['status'], 'categorized')
        self.assertEqual(answer['input_tokens'], 100)
        self.assertEqual(answer['response_id'], 'id1')
        self.assertEqual(answer['scores'], ANSWER['scores'])

    @patch.object(scorer.time, 'sleep')
    @patch.object(scorer.urllib.request, 'urlopen')
    def test_wrong_model_is_not_accepted(self, request, sleep):
        request.side_effect = [response(model='wrong') for _ in range(3)]
        with self.assertRaises(RuntimeError):
            scorer.categorize(BILL, CATEGORIES, scorer.DEFAULT_MODEL, 'dummy')
        self.assertEqual(request.call_count, 3)

    @patch.object(scorer.time, 'sleep')
    @patch.object(scorer.urllib.request, 'urlopen')
    def test_auth_failure_not_retried_or_leaked(self, request, sleep):
        request.side_effect = urllib.error.HTTPError('url', 401, 'SECRET', {'Authorization': 'SECRET'}, None)
        with self.assertRaisesRegex(RuntimeError, '^OpenRouter HTTP 401$'):
            scorer.categorize(BILL, CATEGORIES, scorer.DEFAULT_MODEL, 'dummy')
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()

    @patch.object(scorer.time, 'sleep')
    @patch.object(scorer.urllib.request, 'urlopen')
    def test_rate_limit_retries_bounded(self, request, sleep):
        request.side_effect = urllib.error.HTTPError('url', 429, 'SECRET', {}, None)
        with self.assertRaisesRegex(RuntimeError, '429'):
            scorer.categorize(BILL, CATEGORIES, scorer.DEFAULT_MODEL, 'dummy')
        self.assertEqual(request.call_count, 3)

    def test_save_requires_unchanged_input_and_empty_result(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.rowcount = 0
        self.assertFalse(scorer.save_answer(conn, BILL, 118, ANSWER))
        sql, params = cursor.execute.call_args.args
        self.assertIn('gemma_categorization IS NULL', sql)
        for field in ['title', 'policy_area', 'summary']:
            self.assertIn(field + ' IS NOT DISTINCT FROM %s', sql)
        self.assertEqual(params[1:], (118, *BILL))
        self.assertNotIn('bill_category_scores', sql)


if __name__ == '__main__':
    unittest.main()
