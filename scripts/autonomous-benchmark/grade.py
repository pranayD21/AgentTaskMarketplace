#!/usr/bin/env python3
"""Grade one full-source HumanEval answer inside a macOS sandbox."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
MAX_CANDIDATE_BYTES = 1_048_576
MAX_OUTPUT_BYTES = 65_536
MAX_RESIDENT_BYTES = 268_435_456


class RUsageInfoV0(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_ubyte * 16)] + [(name, ctypes.c_uint64) for name in (
        "user_time", "system_time", "pkg_idle_wkups", "interrupt_wkups", "pageins",
        "wired_size", "resident_size", "phys_footprint", "proc_start_abstime", "proc_exit_abstime",
    )]


def memory_reader():
    library = ctypes.CDLL("/usr/lib/libproc.dylib")
    read_usage = library.proc_pid_rusage
    read_usage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    read_usage.restype = ctypes.c_int

    def resident_bytes(pid):
        usage = RUsageInfoV0()
        if read_usage(pid, 0, ctypes.byref(usage)) != 0:
            return None
        return usage.resident_size

    if resident_bytes(os.getpid()) is None:
        raise OSError("memory accounting unavailable")
    return resident_bytes


def answer(passed: bool, reason: str, start: float) -> dict:
    return {
        "passed": passed,
        "reason": reason,
        "duration_ms": round((time.monotonic() - start) * 1000),
    }


def load_problem(task_id: str) -> dict:
    manifest = json.loads((FIXTURES / "manifest.json").read_text())
    data = (FIXTURES / "problems.json").read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest["problems_sha256"]:
        raise ValueError("fixture_integrity_error")
    for problem in json.loads(data):
        if problem["task_id"] == task_id:
            return problem
    raise ValueError("unknown_task")


def strip_outer_fence(source: str) -> str:
    match = re.fullmatch(r"\s*```(?:python|py)?\s*\n(.*?)\n```\s*", source, re.DOTALL)
    return match.group(1) + "\n" if match else source


def sandbox_profile(python: Path, work: Path) -> str:
    # Python's framework and system libraries are public runtime files.
    quote = json.dumps
    parents = set(python.parents) | set(work.parents)
    parent_rules = " ".join(f"(literal {quote(str(path))})" for path in sorted(parents))
    return f"""(version 1)
(deny default)
(allow process-exec (literal {quote(str(python))}))
(allow signal (target self))
(allow sysctl-read)
(allow file-read* {parent_rules})
(allow file-read*
    (subpath {quote(str(Path(sys.base_prefix).resolve()))})
    (subpath "/System/Library")
    (subpath "/usr/lib")
    (literal "/dev/null")
    (literal "/dev/urandom")
    (literal "/dev/random")
    (subpath {quote(str(work))}))
(allow file-write* (subpath {quote(str(work))}) (literal "/dev/null"))
"""


def harness(source: str, problem: dict, token: str, timeout_s: float) -> str:
    payload = json.dumps({"source": source, "test": problem["test"], "entry_point": problem["entry_point"]})
    return f"""import builtins, json, math, os, random, resource, sys
resource.setrlimit(resource.RLIMIT_CPU, ({math.ceil(timeout_s)}, {math.ceil(timeout_s) + 1}))
resource.setrlimit(resource.RLIMIT_FSIZE, ({MAX_OUTPUT_BYTES}, {MAX_OUTPUT_BYTES}))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
random.seed(0)
payload = json.loads({payload!r})
execute = builtins.exec
compile_code = builtins.compile
write = os.write
encode = str.encode
exit_process = os._exit
namespace = {{"__name__": "candidate"}}
status = "execution_error"
try:
    execute(compile_code(payload["source"], "candidate.py", "exec"), namespace)
    candidate = namespace.get(payload["entry_point"])
    if not callable(candidate):
        status = "missing_entry_point"
    else:
        test_namespace = dict(namespace)
        execute(compile_code(payload["test"], "tests.py", "exec"), test_namespace)
        test_namespace["check"](candidate)
        status = "passed"
except AssertionError:
    status = "failed_tests"
except SyntaxError:
    status = "invalid_python"
except MemoryError:
    status = "memory_limit"
except BaseException:
    status = "execution_error"
write(1, encode("\\n{token}:" + status + "\\n"))
exit_process(0)
"""


def grade(task_id: str, candidate_path: Path, timeout_s: float = 3.0, strip_fences: bool = False) -> dict:
    start = time.monotonic()
    if sys.platform != "darwin" or not Path("/usr/bin/sandbox-exec").is_file():
        return answer(False, "sandbox_unavailable", start)
    try:
        problem = load_problem(task_id)
        with candidate_path.open("rb") as candidate_file:
            raw = candidate_file.read(MAX_CANDIDATE_BYTES + 1)
        if len(raw) > MAX_CANDIDATE_BYTES:
            return answer(False, "candidate_too_large", start)
        source = raw.decode("utf-8")
    except ValueError as error:
        reason = str(error) if str(error) in {"unknown_task", "fixture_integrity_error"} else "invalid_candidate"
        return answer(False, reason, start)
    except OSError:
        return answer(False, "candidate_unreadable", start)
    if strip_fences:
        source = strip_outer_fence(source)
    if not source.strip():
        return answer(False, "empty_candidate", start)
    python = Path(sys.executable).resolve()
    framework_interpreter = Path(sys.base_prefix) / "Resources/Python.app/Contents/MacOS/Python"
    if framework_interpreter.is_file():
        python = framework_interpreter.resolve()
    try:
        resident_bytes = memory_reader()
    except (OSError, AttributeError):
        return answer(False, "memory_monitor_unavailable", start)
    token = secrets.token_hex(24)
    with tempfile.TemporaryDirectory(prefix="atm-grade-") as directory:
        work = Path(directory).resolve()
        (work / "runner.py").write_text(harness(source, problem, token, timeout_s))
        (work / "policy.sb").write_text(sandbox_profile(python, work))
        env = {"PATH": "/usr/bin:/bin", "HOME": str(work), "TMPDIR": str(work), "LANG": "C", "LC_ALL": "C"}
        command = ["/usr/bin/sandbox-exec", "-f", str(work / "policy.sb"), str(python), "-I", "-S", "-B", str(work / "runner.py")]
        with (work / "stdout").open("w+b") as output, (work / "stderr").open("w+b") as errors:
            try:
                process = subprocess.Popen(command, cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=errors, start_new_session=True)
                deadline = time.monotonic() + timeout_s + 0.5
                while process.poll() is None:
                    memory = resident_bytes(process.pid)
                    reason = "memory_limit" if memory is not None and memory > MAX_RESIDENT_BYTES else None
                    if time.monotonic() > deadline:
                        reason = "timeout"
                    if reason:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait()
                        return answer(False, reason, start)
                    time.sleep(0.005)
            except OSError:
                return answer(False, "sandbox_unavailable", start)
            output.seek(0)
            captured = output.read(MAX_OUTPUT_BYTES + 1)
            errors.seek(0)
            diagnostic = errors.read(MAX_OUTPUT_BYTES + 1)
        if b"sandbox-exec:" in diagnostic or b"sandbox_apply:" in diagnostic:
            return answer(False, "sandbox_unavailable", start)
        if process.returncode in {-signal.SIGXCPU, -signal.SIGKILL}:
            return answer(False, "timeout", start)
        if process.returncode == -signal.SIGXFSZ or len(captured) > MAX_OUTPUT_BYTES:
            return answer(False, "output_limit", start)
        if process.returncode != 0:
            return answer(False, "execution_error", start)
        marker = re.search(rb"\n" + token.encode() + rb":([a-z_]+)\n\Z", captured)
        if not marker:
            return answer(False, "incomplete_execution", start)
        reason = marker.group(1).decode("ascii")
        if reason not in {"passed", "failed_tests", "missing_entry_point", "invalid_python", "memory_limit", "execution_error"}:
            return answer(False, "incomplete_execution", start)
        return answer(reason == "passed", reason, start)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--timeout-s", type=float, default=3.0)
    parser.add_argument("--strip-markdown-fences", action="store_true")
    arguments = parser.parse_args()
    if not math.isfinite(arguments.timeout_s) or not 0.1 <= arguments.timeout_s <= 30:
        parser.error("--timeout-s must be between 0.1 and 30 seconds")
    print(json.dumps(grade(arguments.task_id, arguments.candidate, arguments.timeout_s, arguments.strip_markdown_fences), separators=(",", ":")))


if __name__ == "__main__":
    main()
