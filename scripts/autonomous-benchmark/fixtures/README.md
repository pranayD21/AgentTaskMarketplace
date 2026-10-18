# HumanEval evaluation fixtures

These eight Python function tasks come from [OpenAI HumanEval](https://github.com/openai/human-eval/tree/b9453e8f1865df0a0057a1383767caa400acfbcf), revision `b9453e8f1865df0a0057a1383767caa400acfbcf`. They were fixed before candidate generation: 0, 12, 20, 32, 40, 53, 57 and 63. `manifest.json` records the upstream download URL, SHA-256 and selected IDs. The upstream MIT license is in `LICENSE.human-eval`.

`problems.json` contains the original task ID, prompt, entry point and functional tests. The model receives only `task_id`, `prompt` and `entry_point`. Keep `test` out of agent prompts and tool results. `canonical-for-grader-tests.json` contains reference completions solely to verify the grader; never load it into the agent's context. The model must return full Python source, including imports and any helper functions in the original prompt.

The result is the number of these eight final candidates that pass the upstream assertions. It is a small fixed-subset measurement, not a full HumanEval result. Existing model familiarity with this public dataset may affect scores. The tests check functional behavior on their supplied cases; passing does not prove correctness on every input. Grade after each timed arm, without returning hidden-test feedback to the model.

## Grading

```sh
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 scripts/autonomous-benchmark/grade.py --task-id HumanEval/0 --candidate /absolute/path/candidate.py
```

The grader prints one JSON object with `passed`, `reason` and `duration_ms`. `--strip-markdown-fences` explicitly permits removal of one surrounding Python code fence. No other answer repair occurs. `--timeout-s` defaults to 3 seconds and accepts values from 0.1 to 30. Grading time is measured separately from generation time.

The grader requires macOS `/usr/bin/sandbox-exec` and fails closed when the sandbox or memory monitor is unavailable. It launches Python with an empty user environment apart from temporary-directory and locale settings, and disables site packages. The child can read public Python/system runtime files and its own temporary directory. It cannot read the repository or home directory, connect to the network, or spawn child processes. CPU time, output file size and open file counts are limited. A parent watchdog terminates execution after the wall-time limit plus 0.5 seconds of startup allowance. macOS refuses Python's address-space limit, so the parent samples resident memory every 5 milliseconds and kills the child above 256 MiB; brief allocation overshoot is possible. This sandbox protects host access. It is not a proof against deliberately adversarial attempts to manipulate in-process test logic.

```sh
node --test scripts/autonomous-benchmark/grade.test.mjs
```

The self-tests check all eight reference solutions, incorrect answers, explicit fence handling, time/memory limits, early exits and harmless attempts to access host files, environment variables, network sockets and child processes. A host that is already sandboxed may need permission to create this independent sandbox; there is no unsandboxed fallback.
