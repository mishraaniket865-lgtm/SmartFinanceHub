import unittest
from unittest.mock import patch
from app import app, normalize_phone_number, mask_phone_number
from werkzeug.security import generate_password_hash

class TestAuthSuite(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.username = 'test_pilot'
        self.password = 'Pass@2026Strong'
        self.phone = '+919876543210'

    def test_phone_masking(self):
        self.assertEqual(mask_phone_number('+919876543210'), '+91 ******3210')
        self.assertEqual(mask_phone_number('+15551234567'), '+1 ******4567')
        self.assertEqual(normalize_phone_number('9876543210'), '+919876543210')
        self.assertEqual(normalize_phone_number('+15551234567'), '+15551234567')

    @patch('app.get_user_row')
    def test_wrong_password_rejected(self, mock_get_user):
        mock_get_user.return_value = {
            'username': self.username,
            'password_hash': generate_password_hash(self.password),
            'phoneNumber': self.phone,
            'name': 'Test Pilot',
            'email': 'pilot@test.com'
        }
        res = self.client.post('/api/auth/login', json={'username': self.username, 'password': 'WrongPassword123!'})
        self.assertEqual(res.status_code, 401)
        data = res.get_json()
        self.assertFalse(data['ok'])

    @patch('app.get_user_row')
    @patch('app.get_user_data')
    def test_correct_credentials_authenticates_directly(self, mock_data, mock_get_user):
        mock_get_user.return_value = {
            'username': self.username,
            'password_hash': generate_password_hash(self.password),
            'phoneNumber': self.phone,
            'name': 'Test Pilot',
            'email': 'pilot@test.com'
        }
        mock_data.return_value = {
            'profile': {'name': 'Test Pilot', 'email': 'pilot@test.com', 'phone': self.phone, 'authProvider': 'password', 'emailVerified': False}
        }

        res = self.client.post('/api/auth/login', json={'username': self.username, 'password': self.password})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data['ok'])
        self.assertEqual(data['user']['username'], self.username)

        # Authenticated user can access /api/auth/me directly
        me_res = self.client.get('/api/auth/me')
        self.assertEqual(me_res.status_code, 200)
        self.assertTrue(me_res.get_json()['ok'])

    @patch('app.get_user_row')
    @patch('app.get_user_data')
    @patch('app.save_user_data')
    def test_google_oauth_verification(self, mock_save, mock_data, mock_get_user):
        mock_get_user.return_value = {
            'username': 'pilot_google',
            'password_hash': 'managed',
            'name': 'Google Pilot',
            'email': 'pilot.google@gmail.com'
        }
        mock_data.return_value = {
            'profile': {'name': 'Google Pilot', 'email': 'pilot.google@gmail.com', 'authProvider': 'google', 'emailVerified': True}
        }

        res = self.client.post('/api/auth/oauth/google', json={
            'email': 'pilot.google@gmail.com',
            'name': 'Google Pilot'
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data['ok'])
        self.assertEqual(data['user']['email'], 'pilot.google@gmail.com')
        self.assertEqual(data['user']['authProvider'], 'google')
        self.assertTrue(data['user']['emailVerified'])

    def test_logout_destroys_session(self):
        res = self.client.post('/api/auth/logout')
        self.assertEqual(res.status_code, 200)
        me_res = self.client.get('/api/auth/me')
        self.assertEqual(me_res.status_code, 401)

if __name__ == '__main__':
    unittest.main()
