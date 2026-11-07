#!/usr/bin/env python3
"""Scan a git repository's whole history (every branch) for leaked secrets.

Prints masked hits only (first 4 characters, the length and a fingerprint), never a full
value. Exits 1 when a high-confidence secret or a sensitive file is found, so CI fails.

Usage: secret_scan.py [REPO_DIR ...]          (default: the current directory)
After you have rotated a leaked key, add its fingerprint (sha256:...) on its own line to
.github/secret-scan-ignore so old history stops failing the build.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

HIGH = [
    ("AWS access key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    ("Private key", r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"),
    ("GitHub token", r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})"),
    ("Stripe/Paystack key", r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}"),
    ("Stripe webhook secret", r"\bwhsec_[A-Za-z0-9]{24,}"),
    ("AI provider key", r"\bsk-(?:ant-[a-z0-9]+-|proj-)[A-Za-z0-9_-]{24,}"),
    ("Google API key", r"\bAIza[0-9A-Za-z_-]{35}"),
    ("Slack token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    ("SendGrid key", r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}"),
    ("Resend key", r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}"),
    ("JWT (e.g. Supabase service key)", r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    ("Database URL with password",
     r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?|libsql)://[^:\s/'\"@]+:[^@\s'\"]{6,}@[^\s'\"<>]+"),
]
LOW = [  # worth a look, but often a placeholder: reported without failing the build
    ("Secret-looking assignment",
     r"(?i)\b[A-Z0-9_]*(?:password|passwd|secret|api_?key|access_?key|private_?key|auth_?token)[A-Z0-9_]*"
     r"\s*[:=]\s*['\"]([^'\"\s]{12,})['\"]"),
]
RISKY_FILES = re.compile(
    r"(^|/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|ed25519|ecdsa)[^/]*|"
    r"[^/]*credentials?[^/]*\.json|[^/]*service[-_]?account[^/]*\.json|\.npmrc|\.pypirc|"
    r"[^/]*\.(sqlite3?|db)|[^/]*dump[^/]*\.sql)$", re.I)
SAFE_FILES = re.compile(r"(^|/)\.env\.(example|sample|template)$|(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$", re.I)
TEST_FILES = re.compile(r"(^|/)(tests?|__tests__|spec|fixtures?|mocks?)/|\.(test|spec)\.[a-z]+$", re.I)
PLACEHOLDER = re.compile(
    r"(?i)(x{4,}|\*{4,}|your[-_]|change[-_]?me|example|placeholder|dummy|redacted|sample|"
    r"not[-_]a[-_]real|fake|test|\$\{|process\.env|<[a-z_]+>)")
REGEXISH = re.compile(r"[\[\](){}\\^$|?+]")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True,
                          errors="replace", check=True).stdout


def fingerprint(value):
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()[:16]


def scan(repo):
    ignore_file = Path(repo) / ".github" / "secret-scan-ignore"
    ignored = set(ignore_file.read_text().split()) if ignore_file.exists() else set()
    hits, commit, path = {}, "", ""
    log = git(repo, "log", "-p", "--all", "--no-color", "--no-ext-diff",
              "--format=commit %h %ad", "--date=short")
    for line in log.splitlines():
        if line.startswith("commit "):
            commit = " ".join(line.split()[1:3])
        elif line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else line[4:]
        elif line.startswith("+") and not line.startswith("+++") and not SAFE_FILES.search(path):
            in_test = bool(TEST_FILES.search(path))
            for level, patterns in (("high", HIGH), ("low", LOW)):
                if level == "low" and in_test:
                    continue
                for name, rx in patterns:
                    for m in re.finditer(rx, line):
                        value = m.group(1) if m.groups() else m.group(0)
                        if level == "low" and (PLACEHOLDER.search(value) or REGEXISH.search(value)):
                            continue
                        fp = fingerprint(value)
                        if fp not in ignored and (name, fp) not in hits:
                            hits[(name, fp)] = {"name": name, "level": level, "file": path,
                                                "first": commit, "value": value, "fp": fp}
    tracked = set(git(repo, "ls-files").splitlines())
    for hit in hits.values():
        f = Path(repo) / hit["file"]
        hit["still_there"] = hit["file"] in tracked and f.is_file() and hit["value"] in f.read_text(errors="replace")
    added = git(repo, "log", "--all", "--diff-filter=A", "--name-only", "--format=").splitlines()
    risky = sorted({p for p in added if p and RISKY_FILES.search(p) and not SAFE_FILES.search(p)
                    and fingerprint("file:" + p) not in ignored})

    print(f"# Secret scan: {repo}")
    failed = False
    for hit in sorted(hits.values(), key=lambda h: (h["level"] != "high", h["file"])):
        failed |= hit["level"] == "high"
        where = "still in the code" if hit["still_there"] else "in history only"
        tag = "LEAK" if hit["level"] == "high" else "check"
        print(f"- [{tag}] {hit['name']}: {hit['value'][:4]}… ({len(hit['value'])} chars) in {hit['file']} "
              f"(first added {hit['first']}; {where}) {hit['fp']}")
    for p in risky:
        failed = True
        state = "still tracked" if p in tracked else "deleted, but still in history"
        print(f"- [LEAK] Sensitive file committed: {p} ({state}) {fingerprint('file:' + p)}")
    if not hits and not risky:
        print("No likely secrets in any commit on any branch.")
    return failed


if __name__ == "__main__":
    repos = sys.argv[1:] or ["."]
    failed = False
    for r in repos:
        failed |= scan(r)
        print()
    if failed:
        print("A secret in git history stays public even after you delete the file: rotate it at the "
              "provider first, then add its fingerprint to .github/secret-scan-ignore.")
    sys.exit(1 if failed else 0)
