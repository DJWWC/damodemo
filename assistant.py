"""Plain-English prompt -> knob changes.

The assistant is given ONLY: the user's request, the current settings, and
numeric descriptors of each layer (loudness, band balance, timing/pitch
accuracy). It never receives audio. It can only call `adjust` on the
existing, range-limited parameters - it cannot generate or replace sound.

If ANTHROPIC_API_KEY is set, Claude does the interpretation via tool use.
Otherwise a simple offline keyword interpreter is used, so the prototype
works with no account and no network.
"""
import json
import os
import re

from chain import PARAMS, clamp

MODEL = os.environ.get("DAMODEMO_MODEL", "claude-haiku-5-5")

SYSTEM = (
    "You are a mixing engineer inside a tool that polishes a musician's own recordings. "
    "You can ONLY change the processing parameters exposed by the `adjust` tool, within their ranges. "
    "You cannot generate, replace or re-record audio. You never receive the audio itself - only "
    "measurements. Make small, musical changes that answer the request; prefer 1-4 adjustments. "
    "Then reply with one short sentence explaining what you changed."
)


def _tool_schema(layers):
    return [{
        "name": "adjust",
        "description": "Change one processing parameter on one layer. Values outside the range are clamped.",
        "input_schema": {
            "type": "object",
            "properties": {
                "layer": {"type": "string", "enum": list(layers)},
                "param": {"type": "string", "enum": list(PARAMS),
                          "description": "; ".join(f"{k}: {v[2]} [{v[0]}..{v[1]}]" for k, v in PARAMS.items())},
                "value": {"type": "number", "description": "new absolute value"},
            },
            "required": ["layer", "param", "value"],
        },
    }]


def _apply(settings, layer, param, value, log):
    if layer not in settings or param not in PARAMS:
        return
    old = settings[layer][param]
    new = clamp(param, value)
    settings[layer][param] = new
    log.append({"layer": layer, "param": param, "from": round(old, 2), "to": round(new, 2)})


def ask_claude(prompt, settings, descriptors):
    import anthropic
    client = anthropic.Anthropic()
    context = {"current_settings": settings, "measurements": descriptors}
    resp = client.messages.create(
        model=MODEL, max_tokens=1024, system=SYSTEM, tools=_tool_schema(settings),
        messages=[{"role": "user", "content": f"Request: {prompt}\n\nSession data (JSON):\n{json.dumps(context)}"}],
    )
    log, note = [], ""
    for block in resp.content:
        if block.type == "tool_use" and block.name == "adjust":
            _apply(settings, block.input["layer"], block.input["param"], block.input["value"], log)
        elif block.type == "text":
            note += block.text
    return log, note.strip() or "Adjusted by Claude."


# ---------- offline fallback ----------
# phrase -> list of (param, delta)
RULES = [
    (r"warm(er)?|fuller|thicker", [("warmth_db", 2), ("air_db", -1)]),
    (r"thin(ner)?|less boomy|less muddy|cleaner|clearer", [("mud_db", -2), ("warmth_db", -1)]),
    (r"bright(er)?|sparkl|airy|more air", [("air_db", 2), ("presence_db", 1)]),
    (r"dark(er)?|duller|mellow", [("air_db", -2), ("presence_db", -1)]),
    (r"harsh|sibilan|smooth(er)?|less (sharp|shrill)", [("harshness_db", -3)]),
    (r"forward|upfront|cut through|more present", [("presence_db", 2)]),
    (r"punch(y|ier)?|tighter dynamics|more even|controlled", [("comp_ratio", 1.5), ("comp_threshold_db", -4)]),
    (r"more dynamic|less compress|breath(e|ier)|open up", [("comp_ratio", -1.5), ("comp_threshold_db", 4)]),
    (r"tight(er)?|in time|on the beat|quantis|quantiz", [("timing_strength", 0.3)]),
    (r"loose(r)?|human|as played|natural feel", [("timing_strength", -0.3)]),
    (r"in tune|more tuned|pitch correct|autotune", [("tuning_strength", 0.3)]),
    (r"less tuned|natural voice|less robotic", [("tuning_strength", -0.3)]),
    (r"reverb|spacious|bigger room|wetter|more space", [("reverb_mix", 0.08), ("reverb_size", 0.15)]),
    (r"dry(er)?|intimate|close|less reverb", [("reverb_mix", -0.08)]),
    (r"cleaner noise|hiss|noisy|less noise", [("denoise", 0.25)]),
    (r"grit|drive|saturat|analog", [("saturation_db", 3)]),
    (r"\bleft\b", [("pan", -0.3)]),
    (r"\bright\b", [("pan", 0.3)]),
]


def ask_offline(prompt, settings):
    log = []
    # split "vocal: warmer; guitar: tighter" into per-layer clauses
    clauses = [c.strip() for c in re.split(r"[;\n]|\band\b(?=\s+\w+\s*:)", prompt) if c.strip()]
    for clause in clauses:
        low = clause.lower()
        targets = [l for l in settings if l.replace("_", " ") in low or l.split("_")[0] in low]
        targets = targets or list(settings)
        for pattern, changes in RULES:
            if re.search(pattern, low):
                for layer in targets:
                    for param, delta in changes:
                        _apply(settings, layer, param, settings[layer][param] + delta, log)
    note = "Applied keyword rules (offline mode)." if log else "No matching adjustment found (offline mode)."
    return log, note


def interpret(prompt, settings, descriptors):
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return ask_claude(prompt, settings, descriptors) + ("claude",)
        except Exception as e:  # network blocked, bad key, etc.
            print(f"  [assistant] Claude unavailable ({type(e).__name__}); using offline rules")
    return ask_offline(prompt, settings) + ("offline",)
