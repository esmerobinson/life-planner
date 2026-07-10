"""Turn plain text into the fancy unicode fonts Esme uses for headers, e.g.
bold serif  (𝐓𝐨 𝐝𝐨 𝐭𝐨𝐝𝐚𝐲) and bold-italic serif (𝑮𝒐𝒐𝒅 𝒎𝒐𝒓𝒏𝒊𝒏𝒈). These are
real unicode code points, so they render styled in WhatsApp everywhere.
"""


def _map(s, upper, lower, digit=None):
    out = []
    for ch in s:
        if "A" <= ch <= "Z":
            out.append(chr(upper + ord(ch) - ord("A")))
        elif "a" <= ch <= "z":
            out.append(chr(lower + ord(ch) - ord("a")))
        elif digit and "0" <= ch <= "9":
            out.append(chr(digit + ord(ch) - ord("0")))
        else:
            out.append(ch)
    return "".join(out)


def bold(s):
    """𝐁𝐨𝐥𝐝 serif (mathematical bold)."""
    return _map(s, 0x1D400, 0x1D41A, 0x1D7CE)


def bold_italic(s):
    """𝑩𝒐𝒍𝒅 𝒊𝒕𝒂𝒍𝒊𝒄 serif (digits stay plain, that style has none)."""
    return _map(s, 0x1D468, 0x1D482)


def italic(s):
    """𝑖𝑡𝑎𝑙𝑖𝑐 serif. Unicode reserves italic small 'h', so patch it to ℎ."""
    return _map(s, 0x1D434, 0x1D44E).replace(chr(0x1D455), "ℎ")
