# Linux orchestrator for the official SWE-bench harness (CH-034). Running the harness from a Windows
# host CRLF-corrupts its eval.sh/patch files inside the per-instance Linux containers; running the
# ORCHESTRATOR itself in Linux makes every file LF-native, has the Unix `resource` module, and reaches
# the host docker daemon via socket passthrough (validated) to spin per-instance grading containers.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "swebench==4.1.0"
WORKDIR /work
