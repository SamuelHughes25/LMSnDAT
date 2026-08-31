from rest_framework.test import APITestCase


class APIAuthTestCase(APITestCase):
    def auth(self, username, password):
        client = self.client_class()
        resp = client.post('/api/v1/auth/token/', {'username': username, 'password': password}, format='json')
        assert resp.status_code == 200, resp.content
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
        return client
