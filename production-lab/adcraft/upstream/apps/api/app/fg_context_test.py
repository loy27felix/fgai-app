"""A durable continuation retains the actor that authorised the original turn."""
import unittest
from unittest.mock import patch

from app.fg_context import continuation_context


class ContinuationIdentityTest(unittest.TestCase):
    def test_polling_collaborator_cannot_change_charge_attribution(self):
        stored = {'source': {'workspace': 'project', 'actor': 'original'}}

        def persist(resource, context):
            if context.get('actor'):
                stored[resource] = dict(context)
            return stored.get(resource, context)

        with patch('app.fg_context.work_context', side_effect=persist):
            accepted = continuation_context('source', 'next', {
                'workspace': 'project', 'actor': 'polling-collaborator'})
        self.assertEqual(accepted['actor'], 'original')
        self.assertEqual(stored['next']['actor'], 'original')
        self.assertEqual(stored['source']['actor'], 'original')

    def test_missing_identity_is_not_invented(self):
        with patch('app.fg_context.work_context', side_effect=lambda _, context: context):
            accepted = continuation_context('missing', 'next', {
                'workspace': 'project', 'actor': 'polling-collaborator'})
        self.assertNotIn('actor', accepted)


if __name__ == '__main__':
    unittest.main()
