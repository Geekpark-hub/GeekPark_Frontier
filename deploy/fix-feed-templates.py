from pathlib import Path

p = Path(r"C:\Users\86152\Desktop\小程序----前沿社\miniprogram\pages\feed\index.js")
t = p.read_text(encoding="utf-8")

repls = [
    ("key: event-,", "key: `event-${event.id}`,"),
    ("key: poll-,", "key: `poll-${poll.id}`,"),
    ("key: d-event-,", "key: `d-event-${next.id}`,"),
    ("key: d-,", "key: `d-${post.id}`,"),
    ("key: p-,", "key: `p-${post.id}`,"),
]

for old, new in repls:
    if old not in t:
        # maybe already fixed?
        if new in t:
            print("already", new)
            continue
        raise SystemExit(f"missing: {old!r}")
    t = t.replace(old, new, 1)
    print("fixed", old)

p.write_text(t, encoding="utf-8", newline="\n")
print("done")
