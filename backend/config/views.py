from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response

API_VERSION = "0.1.0"


@api_view(["GET"])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        database = "ok"
    except Exception as exc:  # pragma: no cover - only hit when the DB is actually down
        database = f"error: {exc}"
    return Response({"status": "ok", "version": API_VERSION, "database": database})
