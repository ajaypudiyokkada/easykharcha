import re

from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .exceptions import PincodeNotFound
from .models import Pincode

PINCODE_RE = re.compile(r"^[1-9][0-9]{5}$")


class PincodeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, code):
        if not PINCODE_RE.match(code):
            raise ValidationError({"pincode": "Enter a 6-digit PIN code starting with 1-9."})

        rows = list(Pincode.objects.filter(pincode=code).order_by("id"))
        if not rows:
            raise PincodeNotFound(f"We couldn't find pincode {code}.")

        districts = list(dict.fromkeys(row.district for row in rows))
        areas = sorted({row.area for row in rows})
        return Response(
            {"pincode": code, "state": rows[0].state, "districts": districts, "areas": areas}
        )
