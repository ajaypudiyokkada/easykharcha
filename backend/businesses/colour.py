"""WCAG contrast math — the server-side half of the same check mobile/src/theme/brand.ts does on the
client. The client tries to never submit a colour that would fail this; the server enforces it
regardless, since the brand colour can also be set by any other API caller."""

WHITE = "#FFFFFF"


def _srgb_to_linear(channel: int) -> float:
    c = channel / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _relative_luminance(hex_colour: str) -> float:
    value = int(hex_colour.lstrip("#"), 16)
    r, g, b = (value >> 16) & 255, (value >> 8) & 255, value & 255
    return 0.2126 * _srgb_to_linear(r) + 0.7152 * _srgb_to_linear(g) + 0.0722 * _srgb_to_linear(b)


def contrast_ratio(hex_a: str, hex_b: str) -> float:
    lum_a = _relative_luminance(hex_a) + 0.05
    lum_b = _relative_luminance(hex_b) + 0.05
    return lum_a / lum_b if lum_a > lum_b else lum_b / lum_a


def white_text_contrast(hex_colour: str) -> float:
    return contrast_ratio(hex_colour, WHITE)
