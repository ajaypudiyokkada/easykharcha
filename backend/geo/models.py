from django.db import models


class Pincode(models.Model):
    """One row per (pincode, area) pair, straight from India Post's public pincode list — a pincode
    can map to several areas, and occasionally to more than one district (e.g. a post office serving
    a pocket of a neighbouring district)."""

    pincode = models.CharField(max_length=6, db_index=True)
    area = models.CharField(max_length=120)
    district = models.CharField(max_length=64)
    state = models.CharField(max_length=64)
    office_type = models.CharField(max_length=64)

    def __str__(self) -> str:
        return f"{self.pincode} — {self.area}"
