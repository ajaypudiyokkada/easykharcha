from rest_framework import serializers


class AlertCheckSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=160)
