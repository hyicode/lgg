"""Convert a downloaded Supabase plain SQL gzip backup to an LGG local backup.

Only public application tables are included. The original gzip is kept intact.
Usage: py -3 scripts/convert-supabase-backup.py input.backup.gz output.json
"""
import argparse
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import re

TABLES = {"players", "matches", "riot_accounts", "profiles", "player_stats", "opgg_daily_snapshots"}
NUMBERS = {"default_cost", "duration_seconds", "games", "wins", "losses", "kills", "deaths", "assists"}
ESCAPES = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}

def decode_copy(value):
    if value == r"\N":
        return None
    def replace(match):
        token = match.group(1)
        if re.fullmatch(r"[0-7]{1,3}", token):
            return chr(int(token, 8))
        if re.fullmatch(r"x[0-9a-fA-F]{1,2}", token):
            return chr(int(token[1:], 16))
        return ESCAPES.get(token, token)
    return re.sub(r"\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)", replace, value)

def convert(source):
    raw = source.read_bytes()
    sql = gzip.decompress(raw).decode("utf-8")
    tables = {}
    for name, columns, body in re.findall(r"^COPY public\.([\w]+) \(([^\n]+)\) FROM stdin;\n(.*?)^\\\.$", sql, re.M | re.S):
        if name not in TABLES:
            continue
        rows = []
        columns = columns.split(", ")
        for line in body.splitlines():
            values = line.split("\t")
            if len(values) != len(columns):
                raise ValueError(f"Invalid COPY column count in {name}")
            row = {}
            for column, raw_value in zip(columns, values):
                value = decode_copy(raw_value)
                if value is not None:
                    if column in {"participants", "payload"}:
                        value = json.loads(value)
                    elif column == "active":
                        if value not in {"t", "f"}:
                            raise ValueError("Invalid boolean")
                        value = value == "t"
                    elif column in NUMBERS:
                        value = float(value) if column == "default_cost" else int(value)
                row[column] = value
            rows.append(row)
        tables[name] = rows
    for required in ("players", "matches", "riot_accounts"):
        if required not in tables:
            raise ValueError(f"Missing application table {required}")
    return {
        "format": "lgg-backup", "version": 1,
        "exportedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": {"project": "gsswdsuiytprekjgrjqs", "file": source.name, "sha256": hashlib.sha256(raw).hexdigest()},
        "tables": tables,
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    backup = convert(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(backup, out, ensure_ascii=False, indent=2, allow_nan=False)
        out.write("\n")
    print(json.dumps({name: len(rows) for name, rows in backup["tables"].items()}, ensure_ascii=False))
