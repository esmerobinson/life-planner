"""The cute text headers Esme wants each message to open with. One is chosen at
random and prepended to every outgoing message. Stored verbatim, do not 'tidy'
the whitespace, the multi-line ones are ASCII art and depend on it.
"""

import random

HEADERS = [
    "⸜(｡˃ ᵕ ˂ )⸝♡",
    "⭑.ᐟ",
    "°❀⋆.ೃ࿔*:･°❀⋆.ೃ࿔*:･",
    "(˶>⩊<˶)",
    "⋆⊱༻𖥸༺⊰⋆",
    "⋆˚✿˖°",
    "⋆｡‧˚ʚ♡ɞ˚‧｡⋆",
    "ᯓ★",
    "૮ • ﻌ - ა",
    "૮₍ • ᴥ • ₎ა",
    "૮₍´｡ᵔ ꈊ ᵔ｡`₎ა",
    "ᕙ(  •̀ ᗜ •́  )ᕗ",
    "ദ്ദി(˵ •̀ ᴗ - ˵ ) ✧",
    "(๑ᵔ⤙ᵔ๑)",
    "ฅ^>⩊<^ ฅ",
    "(¬`‸´¬)",
    "ദ്ദി(｡•̀ ,<)~✩‧₊",
    # wide cat face
    "                 /\\____/\\\n               > •       •    <",
    # sitting cat with a flower
    (
        "　　　　　🌸＞　　フ\n"
        "　　　　　| 　_　 _ l\n"
        "　 　　　／` ミ＿xノ\n"
        "　　 　 /　　　 　 |\n"
        "　　　 /　 ヽ　　 ﾉ\n"
        "　 　 │　　|　|　|\n"
        "　／￣|　　 |　|　|\n"
        "　| (￣ヽ＿_ヽ_)__)\n"
        "　＼二つ"
    ),
    # little puppy with paws
    " /)   /)\n( ᵔ ᵕ ᵔ )\n/ づ  づ ~ ♡",
    # two animals under a star
    (
        "                              ★ ⁺.\n"
        "                        (\\_(\\    /)_/)\n"
        "                        (      )  (      )\n"
        "                       /     |     |      \\\n"
        "                      ( O   |    |    O )"
    ),
]


def random_header():
    return random.choice(HEADERS)
