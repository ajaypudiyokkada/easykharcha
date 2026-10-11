"""OTP provider interface. Step 3 adds this and the OTP_REQUIRED flag only — no OTP endpoint or
verification flow exists yet, so nothing in this file is called from anywhere yet."""

from abc import ABC, abstractmethod


class OtpProvider(ABC):
    @abstractmethod
    def send(self, mobile: str, code: str) -> None: ...


class ConsoleOtpProvider(OtpProvider):
    """Dev default: prints the code instead of sending an SMS. Swap for a real SMS provider once
    OTP_REQUIRED is turned on."""

    def send(self, mobile: str, code: str) -> None:
        print(f"[OTP] {mobile}: {code}")
