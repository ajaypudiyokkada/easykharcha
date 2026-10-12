import re

from rest_framework import serializers

PIN_PATTERN = re.compile(r"^\d{4,6}$")


def validate_pin(value: str) -> str:
    """4-6 digits, not all the same digit, not a simple run (1234, 4321, 234567, ...)."""
    if not PIN_PATTERN.match(value):
        raise serializers.ValidationError("PIN must be 4 to 6 digits.")
    if len(set(value)) == 1:
        raise serializers.ValidationError("Choose a less predictable PIN.")
    digits = [int(d) for d in value]
    ascending = all(b - a == 1 for a, b in zip(digits, digits[1:], strict=False))
    descending = all(a - b == 1 for a, b in zip(digits, digits[1:], strict=False))
    if ascending or descending:
        raise serializers.ValidationError("Choose a less predictable PIN.")
    return value
